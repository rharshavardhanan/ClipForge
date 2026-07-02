import { v4 as uuidv4 } from 'uuid';
import { basename, join } from 'node:path';
import { copyFile, mkdir, rename, rm, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ora from 'ora';
import Table from 'cli-table3';
import { parseVideoId, download } from '../../ingest/downloader.js';
import { isLocalInput, localJobId, ingestLocal } from '../../ingest/localFile.js';
import { extractMetadata } from '../../ingest/metadataExtractor.js';
import { getTranscript } from '../../transcript/transcriptManager.js';
import { detectTriggers } from '../../analysis/transcriptTriggers.js';
import { commentBoosts } from '../../analysis/commentSignals.js';
import { analyzeAudio } from '../../analysis/audioEnergy.js';
import { analyzeSemanticAuto, pickSemanticProvider } from '../../analysis/semanticEngine.js';
import { scoreWindows } from '../../clipDetection/windowScorer.js';
import { buildClips } from '../../clipDetection/merger.js';
import { rank, defaultMinScore } from '../../clipDetection/ranker.js';
import { buildCaptionWords } from '../../captions/captionWords.js';
import { sentimentColor } from '../../captions/sentimentColor.js';
import { writeSrt } from '../../captions/srtGenerator.js';
import { extractFullFrame } from '../../extraction/clipExtractor.js';
import { planFraming } from '../../extraction/faceTracker.js';
import { render } from '../../captions/remotionRenderer.js';
import { scanLibrary, pickTrack, sentimentToMood } from '../../music/library.js';
import { mixMusic } from '../../music/mixer.js';
import { writeExports } from '../../export/exporter.js';
import { buildSeoPack, type SeoPack } from '../../export/seo.js';
import { logger } from '../../utils/logger.js';
import type { RankedClip, TranscriptSegment, VideoAnalysis } from '../../types/index.js';
import type { CaptionStyle } from '../../captions/presets.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export function resolveJobId(url: string): string {
  if (isLocalInput(url)) return localJobId(url);
  return parseVideoId(url) ?? uuidv4();
}

/** PURE: truncate a hook moment to <=8 words for the hook card, appending an ellipsis if cut. */
export function hookCardText(s: string): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 8) return words.join(' ');
  return words.slice(0, 7).join(' ') + '…';
}

/** PURE: short, stable id for a batch of URLs (order-independent). */
export function batchId(urls: string[]): string {
  const sorted = [...urls].sort();
  const hash = createHash('sha1').update(sorted.join('\n')).digest('hex').slice(0, 10);
  return `batch_${hash}`;
}

export interface AllOpts {
  top: number;
  minScore?: number;
  /** Caption preset name (mrbeast|hormozi|gadzhi|gaming|podcast|cinematic|minimal|card|bold). */
  style: string;
  accent: string;
  perVideoCap?: number;
  /** Resolved caption style config; absent → renderer's legacy bold look. */
  caption?: CaptionStyle;
  /** Background music: true/undefined = auto (on when ./music has a matching track). */
  music?: boolean;
  musicVolume?: number;
  musicDir?: string;
  /** Punch zooms on emphasized moments. Default true. */
  zooms?: boolean;
  /** Delete the downloaded source video + clip intermediates after a successful export (frees disk). */
  deleteSource?: boolean;
}

/** PURE: files/dirs to remove when --delete-source is set — the big source download and the
 *  per-clip intermediate extracts, one set per distinct source video. */
export function cleanupTargets(analyses: { jobId: string; videoPath: string }[], wsDir: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of analyses) {
    if (seen.has(a.jobId)) continue;
    seen.add(a.jobId);
    out.push(a.videoPath);              // the downloaded source (multi-GB for long videos)
    out.push(join(wsDir, 'clips', a.jobId)); // full-frame intermediate extracts
  }
  return out;
}

async function pathSizeBytes(p: string): Promise<number> {
  try {
    const s = await stat(p);
    if (s.isFile()) return s.size;
    if (s.isDirectory()) {
      let total = 0;
      for (const f of await readdir(p)) total += await pathSizeBytes(join(p, f));
      return total;
    }
  } catch { /* missing — nothing to free */ }
  return 0;
}

/** PURE: coerce a preset name onto the legacy Remotion style prop (unknown → bold). */
export function legacyStyle(preset: string): 'minimal' | 'card' | 'bold' {
  return preset === 'minimal' || preset === 'card' ? preset : 'bold';
}

/** A RankedClip tagged with the VideoAnalysis it came from. */
export interface SourcedRankedClip {
  clip: RankedClip;
  source: VideoAnalysis;
}

/**
 * Analyze a single video end-to-end (ingest → metadata → transcript → triggers + audio +
 * semantic → score windows → build clip candidates). Does NOT rank or export.
 */
export async function analyzeVideo(url: string, opts: AllOpts): Promise<VideoAnalysis> {
  const jobId = resolveJobId(url);
  const dirs = {
    downloads: join(WS, 'downloads', jobId),
    transcripts: join(WS, 'transcripts', jobId),
    analysis: join(WS, 'analysis', jobId),
  };

  let sp = ora('Ingesting video…').start();
  const dl = isLocalInput(url)
    ? await ingestLocal(url, dirs.downloads)
    : await download(url, dirs.downloads);
  const meta = await extractMetadata(dl.videoPath, dl.infoJsonPath, jobId, join(dirs.transcripts, 'metadata.json'));
  sp.succeed(`Downloaded: "${meta.title}" (${Math.round(meta.duration)}s)`);

  sp = ora('Extracting transcript…').start();
  const segments: TranscriptSegment[] = await getTranscript({
    jobId, videoPath: dl.videoPath, subtitlePath: dl.subtitlePath, outPath: join(dirs.transcripts, 'transcript.json'),
  });
  sp.succeed(`Transcript ready — ${segments.reduce((a, s) => a + s.words.length, 0)} words`);

  sp = ora('Analyzing (triggers + audio energy)…').start();
  const triggers = detectTriggers(segments);
  const audio = await analyzeAudio(dl.videoPath);
  sp.succeed(`Analysis done — ${triggers.length} trigger hits`);

  // Claude is the primary semantic brain (accuracy); Gemini Flash is the redundant fallback.
  // Cache per provider so switching keys doesn't reuse the other provider's scores.
  const chosen = pickSemanticProvider(process.env);
  sp = ora(`Analyzing semantics (${chosen})…`).start();
  const { windows: semantic, provider } = await analyzeSemanticAuto(segments, {
    geminiModel: process.env.GEMINI_MODEL,
    claudeModel: process.env.ANTHROPIC_MODEL,
    outPath: join(dirs.analysis, `layer_semantic_${chosen}.json`),
  });
  if (semantic.length > 0) sp.succeed(`semantic: ${semantic.length} windows (${provider})`);
  else sp.warn('semantic: unavailable → trigger+audio fallback');

  sp = ora('Detecting clips…').start();
  const boosts = commentBoosts(meta.topComments ?? [], 30, meta.duration);
  const windows = scoreWindows(meta.duration, triggers, audio, semantic, boosts);
  const threshold = opts.minScore ?? defaultMinScore(windows);
  const candidates = buildClips(windows, segments, audio, threshold, meta.duration);
  sp.succeed(`Found ${candidates.length} candidates${boosts.length ? ` (${boosts.length} viewer-flagged moments)` : ''}`);

  return { jobId, url, videoPath: dl.videoPath, meta, segments, triggers, audio, semantic, candidates };
}

/**
 * PURE: pool per-analysis RankedClips (already within-video deduped/ranked) and select the
 * global top-N by composite_score across all sources, optionally capped per source. Re-numbers
 * rank/clip_id 1..N over the selection. `pool` order is not assumed to be sorted.
 */
export function rankAcrossAnalyses(
  pool: SourcedRankedClip[],
  opts: { top: number; perVideoCap?: number },
): SourcedRankedClip[] {
  const sorted = [...pool].sort((a, b) => b.clip.composite_score - a.clip.composite_score);

  const selected: SourcedRankedClip[] = [];
  const perSourceCount = new Map<string, number>();
  for (const item of sorted) {
    if (selected.length >= opts.top) break;
    if (opts.perVideoCap) {
      const count = perSourceCount.get(item.source.jobId) ?? 0;
      if (count >= opts.perVideoCap) continue;
      perSourceCount.set(item.source.jobId, count + 1);
    }
    selected.push(item);
  }

  return selected.map(({ clip, source }, i) => ({
    source,
    clip: {
      ...clip,
      rank: i + 1,
      clip_id: `clip_${String(i + 1).padStart(3, '0')}`,
      source_video: source.jobId,
      source_url: source.url,
    },
  }));
}

/**
 * Rank candidates from one or more VideoAnalysis results GLOBALLY by composite score and export
 * the selected clips (extract + face-track reframe + caption render + raw copy + manifest).
 * Returns the exports directory.
 */
export async function rankAndExport(analyses: VideoAnalysis[], opts: AllOpts): Promise<string> {
  // Per-analysis rank (within-video dedup + semantic attachment), tag each with its source.
  const pool: SourcedRankedClip[] = [];
  for (const analysis of analyses) {
    const ranked = rank(analysis.candidates, analysis.segments, { top: Infinity, minScore: opts.minScore }, analysis.semantic);
    for (const clip of ranked) pool.push({ clip, source: analysis });
  }

  const selected = rankAcrossAnalyses(pool, { top: opts.top, perVideoCap: opts.perVideoCap });

  const id = analyses.length === 1 ? analyses[0].jobId : batchId(analyses.map((a) => a.url));
  const exportsDir = join(WS, 'exports', id);

  const musicLib = opts.music === false
    ? {}
    : await scanLibrary(opts.musicDir ?? process.env.MUSIC_DIR ?? './music');

  // Render each clip independently — a single clip that errors or hangs (killed by the render
  // stall-watchdog) is skipped so it can't lose the whole batch. Only clips that fully export
  // go into the manifest.
  const succeeded: SourcedRankedClip[] = [];
  const packs = new Map<string, SeoPack>();
  for (const { clip, source } of selected) {
    const sp2 = ora(`[${clip.clip_id}] (${source.jobId}) extract + caption…`).start();
    const finalPath = join(exportsDir, `${clip.clip_id}_final.mp4`);
    const clipsDir = join(WS, 'clips', source.jobId);

    try {
      // SEO pack from THIS clip's source metadata (batch runs mix creators).
      const pack = buildSeoPack(clip, source.meta);
      packs.set(clip.clip_id, pack);

      const clipWords = source.segments.flatMap((s) => s.words).filter((w) => w.end > clip.start && w.start < clip.end);
      const captionWords = buildCaptionWords(clipWords, clip.start, source.triggers.map((t) => t.phrase));
      await writeSrt(captionWords, join(exportsDir, `${clip.clip_id}.srt`));

      // Both modes render from the full 16:9 extract: 'crop' pans/zooms a face track over it,
      // 'blur' centers it over a blurred backdrop. Blur is the default (natural, no face cutting).
      const fullPath = join(clipsDir, `${clip.clip_id}_full.mp4`);
      await extractFullFrame(source.videoPath, clip.start, clip.end, fullPath);
      const { mode, track } = await planFraming(fullPath, source.meta.width, source.meta.height);

      const hookText = clip.hook_moment ? hookCardText(clip.hook_moment) : undefined;
      const accentColor = sentimentColor(clip.sentiment, opts.accent);

      await render({
        rawClipPath: fullPath, words: captionWords, outPath: finalPath, fps: source.meta.fps,
        accentColor, style: legacyStyle(opts.style), caption: opts.caption, zooms: opts.zooms,
        framing: mode,
        ...(mode === 'crop' ? { cropTrack: track, srcW: source.meta.width, srcH: source.meta.height } : {}),
        hookText,
      });
      logger.info(mode === 'crop'
        ? `[${clip.clip_id}] smart-crop (${track.length} face keyframes)`
        : `[${clip.clip_id}] blur-background framing`);

      // mood-matched background music, ducked under speech (skipped when no track fits)
      const mood = sentimentToMood(clip.sentiment);
      const musicTrack = pickTrack(musicLib, mood, `${source.jobId}_${clip.clip_id}`);
      if (musicTrack) {
        const tmpPath = finalPath.replace(/\.mp4$/, '.music.mp4');
        await mixMusic(finalPath, musicTrack, tmpPath, { musicVolume: opts.musicVolume ?? 0.25 });
        await rename(tmpPath, finalPath);
        logger.info(`[${clip.clip_id}] music: ${basename(musicTrack)} (${mood})`);
      }

      // copy raw into exports for completeness
      await mkdir(exportsDir, { recursive: true });
      await copyFile(fullPath, join(exportsDir, `${clip.clip_id}_raw.mp4`));
      succeeded.push({ clip, source });
      sp2.succeed(`[${clip.clip_id}] done`);
    } catch (e) {
      sp2.fail(`[${clip.clip_id}] skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const ranked = succeeded.map((s) => s.clip);
  const primary = analyses[0];
  if (ranked.length < selected.length) {
    logger.warn(`${selected.length - ranked.length}/${selected.length} clip(s) failed/skipped; manifest has the ${ranked.length} that exported.`);
  }
  await writeExports(exportsDir, id, primary.url, primary.meta, ranked, packs);

  const head = analyses.length === 1 ? ['Rank', 'Score', 'Dur', 'Excerpt'] : ['Rank', 'Score', 'Dur', 'Source', 'Excerpt'];
  const table = new Table({ head });
  ranked.forEach((c) => {
    const row = [c.rank, c.composite_score, `${Math.round(c.duration)}s`];
    if (analyses.length > 1) row.push(c.source_video ?? '');
    row.push(c.transcript_excerpt.slice(0, 40));
    table.push(row);
  });
  logger.info('\n' + table.toString());

  // Free the big source download(s) + intermediates once clips are safely exported.
  // Never delete the source if nothing exported — that would throw away recoverable work.
  if (opts.deleteSource && ranked.length > 0) {
    let freed = 0;
    for (const p of cleanupTargets(analyses, WS)) {
      freed += await pathSizeBytes(p);
      await rm(p, { recursive: true, force: true });
    }
    logger.info(`Deleted source video + intermediates — freed ~${(freed / 1e6).toFixed(0)} MB`);
  }

  logger.info(`Export complete → ${exportsDir}`);
  return exportsDir;
}

export async function runAll(url: string, opts: AllOpts): Promise<string> {
  const analysis = await analyzeVideo(url, opts);
  return rankAndExport([analysis], opts);
}

/** Analyze multiple videos SEQUENTIALLY (Gemini rate limits + memory) then rank+export globally. */
export async function runBatch(urls: string[], opts: AllOpts): Promise<string> {
  const analyses: VideoAnalysis[] = [];
  for (const [i, url] of urls.entries()) {
    logger.info(`\n— Video ${i + 1}/${urls.length}: ${url} —`);
    analyses.push(await analyzeVideo(url, opts));
  }
  return rankAndExport(analyses, opts);
}
