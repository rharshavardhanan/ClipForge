/**
 * Montage pipeline — video(s) + music in, beat-synced montagem Short out. Ingest → resolve
 * music track → music map → harvest moments per video → plan → counter label → payoff image
 * → render → exports + manifest. STRUCTURAL MIRROR of src/rankrot/pipeline.ts (ora spinner
 * per stage, WORKSPACE_DIR-relative job dirs, generateThumbnail in a try/catch that never
 * fails the run).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import ora from 'ora';
import { probe } from '../utils/ffmpeg.js';
import { logger } from '../utils/logger.js';
import { download } from '../ingest/downloader.js';
import { ingestLocal, isLocalInput, localJobId } from '../ingest/localFile.js';
import { AUDIO_EXTS } from '../music/library.js';
import { buildMusicMap } from './musicMap.js';
import { harvestMoments } from './moments.js';
import { buildMontagePlan, mulberry32, remapCycleEvents } from './planner.js';
import { labelCounterForMoment } from './counter.js';
import { extractPeakFrame, generatePayoffImage } from './payoff.js';
import { renderMontage } from './render.js';
import { generateThumbnail } from '../export/thumbnail.js';
import type { CounterEvent, MontageMoment } from './types.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export interface MontageOpts {
  music?: string;        // explicit track file
  musicDir?: string;     // default './music'
  duration: number;      // default 25
  seed: string;          // default 'montage'
  counters: boolean;     // --no-counters
  payoffImage: boolean;  // --no-payoff-image
  nativeAudio: number;   // 0..1, default 0 (music volume stays 0.9)
}

/** PURE: filesystem-safe job slug for a set of inputs. */
export function montageSlug(inputs: string[]): string {
  return 'montage_' + createHash('sha1').update(inputs.join('|')).digest('hex').slice(0, 10);
}

/**
 * PURE: pick a music track for the montage — prefer tracks with `duration+10s` of headroom
 * over the target length (seeded pick among those via mulberry32, so re-runs with the same
 * seed choose the same track); none long enough → the single longest track; empty → null.
 */
export function pickMontageTrack(
  tracks: { path: string; duration: number }[], targetSec: number, seed: string,
): string | null {
  if (tracks.length === 0) return null;
  const longEnough = tracks.filter((t) => t.duration >= targetSec + 10);
  if (longEnough.length > 0) {
    const rng = mulberry32(seed);
    return longEnough[Math.floor(rng() * longEnough.length)].path;
  }
  return tracks.reduce((best, t) => (t.duration > best.duration ? t : best)).path;
}

/** PURE, no LLM: deterministic SEO texts from source titles + the (optional) counter label. */
export function buildMontageTexts(
  sourceTitles: string[], counterLabel: string | null,
): { title: string; description: string; hashtags: string[] } {
  const base = (sourceTitles[0] ?? 'MONTAGE').slice(0, 60);
  const title = `${base} 🔥 (INSANE EDIT)`;
  const description = `The hardest moments, cut to the beat.\n\nSources: ${sourceTitles.join(', ')}`;
  const hashtags = ['#shorts', '#montage', '#edit', ...(counterLabel ? ['#challenge'] : [])];
  return { title, description, hashtags };
}

/** Resolve the music track path: explicit --music (must exist), else scan <musicDir>/montagem/. */
async function resolveMusicTrack(opts: MontageOpts): Promise<string> {
  if (opts.music) {
    if (!existsSync(opts.music)) throw new Error(`Music file not found: ${opts.music}`);
    return opts.music;
  }
  const dir = join(opts.musicDir ?? './music', 'montagem');
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    files = [];
  }
  const tracks: { path: string; duration: number }[] = [];
  for (const f of files.filter((f) => AUDIO_EXTS.has(extname(f).toLowerCase())).sort()) {
    const path = join(dir, f);
    try {
      tracks.push({ path, duration: (await probe(path)).duration });
    } catch (e) {
      logger.warn(`[montage] skipping unreadable track ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const pick = pickMontageTrack(tracks, opts.duration, opts.seed);
  if (!pick) {
    throw new Error('No music: pass --music <file> or drop tracks into ./music/montagem/ — a montage cannot exist without its track.');
  }
  return pick;
}

/** Best-effort title for an ingested input: video.info.json `title` when present, else basename. */
async function titleFor(input: string, infoJsonPath: string): Promise<string> {
  if (existsSync(infoJsonPath)) {
    try {
      const info = JSON.parse(await readFile(infoJsonPath, 'utf8'));
      if (typeof info?.title === 'string' && info.title.trim()) return info.title;
    } catch {
      // fall through to basename
    }
  }
  return basename(input);
}

export async function runMontage(inputs: string[], opts: MontageOpts): Promise<string> {
  const slug = montageSlug(inputs);
  const exportsDir = join(WS, 'exports', slug);
  const workDir = join(WS, 'montage', slug);
  await mkdir(exportsDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  // 1. Music: resolved before ingest so a missing track fails fast, before any download.
  let sp = ora('Resolving music track…').start();
  let musicPath: string;
  try {
    musicPath = await resolveMusicTrack(opts);
    sp.succeed(`Music: ${musicPath}`);
  } catch (e) {
    sp.fail('Music resolution failed');
    throw e;
  }

  // 2. Ingest every input sequentially (URL → download, local file → ingestLocal).
  const videoPaths: string[] = [];
  const titles: string[] = [];
  for (const [i, input] of inputs.entries()) {
    const isp = ora(`[${i + 1}/${inputs.length}] Ingesting ${input}…`).start();
    let videoPath: string, infoJsonPath: string;
    try {
      if (/^https?:/i.test(input)) {
        const dl = await download(input, join(WS, 'downloads', 'dl_' + createHash('sha1').update(input).digest('hex').slice(0, 10)));
        videoPath = dl.videoPath; infoJsonPath = dl.infoJsonPath;
      } else if (isLocalInput(input)) {
        const dl = await ingestLocal(input, join(WS, 'downloads', localJobId(input)));
        videoPath = dl.videoPath; infoJsonPath = dl.infoJsonPath;
      } else {
        throw new Error(`Not a URL or local video file: ${input}`);
      }
    } catch (e) {
      isp.fail(`[${i + 1}/${inputs.length}] ingest failed`);
      throw e;
    }
    const title = await titleFor(input, infoJsonPath);
    videoPaths.push(videoPath);
    titles.push(title);
    isp.succeed(`[${i + 1}/${inputs.length}] ${title}`);
  }

  // 3. Music map (tempo/beats/drops) — music-tempo throws a bare string on pathological/silent
  // audio, so wrap it into a clear Error rather than let a non-Error escape.
  sp = ora('Analyzing music…').start();
  let map;
  try {
    map = await buildMusicMap(musicPath);
    sp.succeed(`Music analyzed: ${Math.round(map.bpm)} BPM, ${map.drops.length} drop(s)`);
  } catch (e) {
    sp.fail('Music analysis failed');
    throw new Error(`Music analysis failed for ${musicPath}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Harvest moments per video (best-effort per video; the montage only needs enough total).
  const perVideo = Math.max(4, Math.ceil(12 / inputs.length));
  const allMoments: MontageMoment[] = [];
  for (const [i, videoPath] of videoPaths.entries()) {
    const hsp = ora(`[${i + 1}/${videoPaths.length}] Harvesting moments…`).start();
    try {
      const moments = await harvestMoments(videoPath, join(workDir, `moments_${i}`), perVideo);
      allMoments.push(...moments);
      hsp.succeed(`[${i + 1}/${videoPaths.length}] ${moments.length} moment(s) harvested`);
    } catch (e) {
      hsp.fail(`[${i + 1}/${videoPaths.length}] harvest failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (allMoments.length < 3) {
    throw new Error(`Only ${allMoments.length} moment(s) harvested across ${videoPaths.length} video(s) — need at least 3 for a montage.`);
  }

  // 5. Plan: beat-grid cuts filled with moment footage (pure + seeded).
  sp = ora('Building montage plan…').start();
  const plan = buildMontagePlan(map, allMoments, { targetSec: opts.duration, seed: opts.seed });
  const freezeSeg = plan.segments.find((s) => s.freeze);
  if (!freezeSeg) {
    sp.fail('Internal error');
    throw new Error('Internal: montage plan has no freeze (payoff) segment');
  }
  sp.succeed(`Plan: ${plan.segments.length} segment(s), ${plan.totalDur.toFixed(1)}s total`);

  // 6. Counter: only when enabled, some moment has cyclic reps, enough of them survive the
  // remap onto the final plan's wall clock, AND the one vision call confidently labels them.
  let counterLabel: string | null = null;
  let counterEvents: CounterEvent[] = [];
  if (opts.counters && allMoments.some((m) => m.cycleEvents.length > 0)) {
    const remapped = remapCycleEvents(plan, allMoments);
    if (remapped.length >= 3) {
      const best = allMoments.reduce((b, m) => (m.cycleEvents.length > b.cycleEvents.length ? m : b));
      const csp = ora('Labeling rep counter…').start();
      const label = await labelCounterForMoment(best.src, best.dur);
      if (label) {
        counterLabel = label;
        counterEvents = remapped;
        csp.succeed(`Counter: ${label} (${remapped.length} reps)`);
      } else {
        csp.info('Counter: no confident label — disabled');
      }
    }
  }

  // 7. Payoff: AI-stylized freeze frame. Extracted from the FREEZE segment's own src, at its
  // srcStart — never fails the run; a null payoff just means the comp shows the real freeze.
  let payoffPath: string | null = null;
  if (opts.payoffImage) {
    const psp = ora('Generating AI payoff frame…').start();
    try {
      const peakJpg = join(workDir, 'peak.jpg');
      await extractPeakFrame(freezeSeg.src, freezeSeg.srcStart, peakJpg);
      payoffPath = await generatePayoffImage(peakJpg, process.env.BROLL_DIR ?? './broll_cache');
      if (payoffPath) psp.succeed('AI payoff frame generated');
      else psp.info('Payoff frame: Gemini unavailable — using the real freeze frame');
    } catch (e) {
      psp.warn(`Payoff frame skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 8. Render. nativeAudio is reserved: Task 7's Remotion component hardcodes segments muted
  // (music is the timeline master), so wiring per-segment volume isn't trivial here — log and
  // continue rather than silently ignore the flag.
  if (opts.nativeAudio > 0) {
    logger.info('--native-audio not yet supported (segments stay muted this release) — continuing with music-only audio');
  }
  const finalPath = join(exportsDir, 'montage_final.mp4');
  sp = ora('Rendering montage…').start();
  try {
    await renderMontage(plan, counterEvents, counterLabel ?? '', musicPath, payoffPath ?? '', {
      outPath: finalPath, musicVolume: 0.9,
    });
    sp.succeed(`Rendered → ${finalPath}`);
  } catch (e) {
    sp.fail('Render failed');
    throw e;
  }

  // 9. Thumbnail (never fails the run) + SEO texts + manifest.
  const texts = buildMontageTexts(titles, counterLabel);
  try {
    await generateThumbnail(freezeSeg.src, freezeSeg.srcStart, texts.title, join(exportsDir, 'thumbnail.png'), { accent: '#FF2E2E' });
  } catch (e) {
    logger.warn(`thumbnail failed (run continues): ${e instanceof Error ? e.message : String(e)}`);
  }

  await writeFile(join(exportsDir, 'title.txt'), texts.title + '\n');
  await writeFile(join(exportsDir, 'description.txt'), texts.description + '\n');
  await writeFile(join(exportsDir, 'hashtags.txt'), texts.hashtags.join('\n') + '\n');
  await writeFile(join(exportsDir, 'montage_manifest.json'), JSON.stringify({
    inputs, slug,
    music: { path: musicPath, bpm: map.bpm, drops: map.drops },
    generated_at: new Date().toISOString(),
    moments: allMoments.length,
    segments: plan.segments.length,
    counter_label: counterLabel,
    payoff_image: payoffPath !== null,
    total_sec: plan.totalDur,
  }, null, 2));

  logger.info(`Montage complete → ${exportsDir}`);
  return exportsDir;
}
