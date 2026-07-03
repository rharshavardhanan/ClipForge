/**
 * RankRot pipeline — topic in, brainrot countdown Short out.
 * search variations → harvest 30-50 → strongest 3-8s moment each → 5 scoring layers
 * (local signals + Gemini, NO Claude) → top-5 countdown 5→1 → render + SFX + SEO + thumbnail.
 */
import ora from 'ora';
import { join } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { probe } from '../utils/ffmpeg.js';
import { logger } from '../utils/logger.js';
import { queryVariants } from './queries.js';
import { searchAll, downloadAll, DEFAULT_RANKROT_CACHE, HARVEST_CAP, type HarvestedClip } from './harvest.js';
import { motionCurve, audioCurve, type CurvePoint } from './signals.js';
import { fuseCurves, momentWindow, extractMoment, MAX_MOMENT_SEC } from './moment.js';
import {
  poolNormalize, rawVisualImpact, rawAudioHype, reactionScore, frameHashes,
  collapseDupes, viralityScores, finalScore, pickCountdown, WEIGHTS,
  type LayerScores, type ScoredClip,
} from './score.js';
import { buildTitles } from './titles.js';
import { renderRankRot, buildRankRotSfxPlan, planRankRotSfx, type RankRotRenderItem } from './render.js';
import { scanSfxLibrary } from '../sfx/library.js';
import { mixSfx } from '../sfx/mixer.js';
import { generateThumbnail } from '../export/thumbnail.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';
const COMP_FPS = 30;

export interface RankRotOpts {
  top: number;
  harvest?: number;
  accent: string;
  sfx?: boolean;
  sfxVolume?: number;
  sfxDir?: string;
  cacheDir?: string;
  replays?: boolean;
}

/** PURE: filesystem-safe job slug for a topic. */
export function topicSlug(topic: string): string {
  const s = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `rankrot_${s || 'topic'}`;
}

interface Analyzed {
  clip: HarvestedClip;
  momentFile: string;
  start: number; end: number;
  peakRelSec: number;            // fused peak, relative to the moment start (thumbnail focus)
  rawVisual: number; rawAudio: number;
  reaction: number;
  hashes: bigint[];
  width: number; height: number;
}

async function analyzeOne(clip: HarvestedClip, slug: string): Promise<Analyzed | null> {
  try {
    const p = await probe(clip.file);
    const motion = await motionCurve(clip.file);
    const [audio, bass] = [await audioCurve(clip.file), await audioCurve(clip.file, true)];
    const fused = fuseCurves(motion, audio);
    const { start, end } = momentWindow(fused, p.duration);

    const inWindow = (c: CurvePoint[]) => c.filter((pt) => pt.time >= start && pt.time <= end);
    const peak = fused.filter((pt) => pt.time >= start && pt.time <= end)
      .reduce((b, pt) => (pt.v > b.v ? pt : b), { time: start, v: -1 });

    const momentFile = join(WS, 'rankrot', slug, `m_${clip.candidate.id}.mp4`);
    await mkdir(join(WS, 'rankrot', slug), { recursive: true });
    await extractMoment(clip.file, start, end, momentFile);

    const reaction = await reactionScore(momentFile, p.width, p.height);
    const hashes = await frameHashes(momentFile, end - start);

    return {
      clip, momentFile, start, end,
      peakRelSec: Math.max(0, +(peak.time - start).toFixed(2)),
      rawVisual: rawVisualImpact(inWindow(motion)),
      rawAudio: rawAudioHype(inWindow(audio), inWindow(bass)),
      reaction, hashes,
      width: p.width, height: p.height,
    };
  } catch (e) {
    logger.warn(`[rankrot] ${clip.candidate.id} dropped in analysis: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function runRankRot(topic: string, opts: RankRotOpts): Promise<string> {
  const slug = topicSlug(topic);
  const exportsDir = join(WS, 'exports', slug);
  await mkdir(exportsDir, { recursive: true });

  // 1. queries + search + harvest
  let sp = ora(`Searching for "${topic}"…`).start();
  const queries = await queryVariants(topic);
  const candidates = (await searchAll(queries)).slice(0, opts.harvest ?? HARVEST_CAP);
  sp.succeed(`${candidates.length} candidates from ${queries.length} query variations`);
  if (candidates.length < opts.top) {
    throw new Error(`Only ${candidates.length} candidates found for "${topic}" — need at least ${opts.top}. Try a broader topic.`);
  }

  sp = ora(`Harvesting ${candidates.length} clips (cached in ${opts.cacheDir ?? DEFAULT_RANKROT_CACHE})…`).start();
  const harvested = await downloadAll(candidates, opts.cacheDir ?? DEFAULT_RANKROT_CACHE);
  sp.succeed(`${harvested.length}/${candidates.length} clips downloaded`);
  if (harvested.length < opts.top) {
    throw new Error(`Only ${harvested.length} clips survived download — need ${opts.top}.`);
  }

  // 2. per-clip moment + local layers (sequential: ffmpeg + face detection are the load)
  const analyzed: Analyzed[] = [];
  for (const [i, clip] of harvested.entries()) {
    sp = ora(`[${i + 1}/${harvested.length}] ${clip.candidate.id}: moment + signals…`).start();
    const a = await analyzeOne(clip, slug);
    if (a) { analyzed.push(a); sp.succeed(`[${i + 1}/${harvested.length}] ${clip.candidate.id}: ${a.start}-${a.end}s`); }
    else sp.fail(`[${i + 1}/${harvested.length}] ${clip.candidate.id}: dropped`);
  }
  if (analyzed.length < opts.top) throw new Error(`Only ${analyzed.length} clips analyzable — need ${opts.top}.`);

  // 3. pool-normalize local layers, collapse duplicates, Gemini virality, final score
  sp = ora('Ranking (5 layers)…').start();
  const visualN = poolNormalize(analyzed.map((a) => a.rawVisual));
  const audioN = poolNormalize(analyzed.map((a) => a.rawAudio));
  const withProvisional = analyzed.map((a, i) => ({
    ...a,
    title: a.clip.candidate.title,
    provisional: WEIGHTS.visual * visualN[i] + WEIGHTS.audio * audioN[i] + WEIGHTS.reaction * a.reaction,
    visualN: visualN[i], audioN: audioN[i],
  }));
  const { kept, novelty } = collapseDupes(withProvisional);
  const virality = await viralityScores(kept.map((k) => ({
    title: k.clip.candidate.title, channel: k.clip.candidate.channel,
    durationSec: k.end - k.start, viewCount: k.clip.candidate.viewCount,
  })), topic);

  const scored: ScoredClip[] = kept.map((k, i) => {
    const layers: LayerScores = {
      visual: k.visualN, audio: k.audioN, reaction: k.reaction,
      virality: virality[i], novelty: novelty[i],
    };
    return {
      candidate: k.clip.candidate, momentFile: k.momentFile,
      momentStart: k.start, momentEnd: k.end,
      layers, final: finalScore(layers),
    };
  });
  const picks = pickCountdown(scored, opts.top);
  sp.succeed(`${kept.length} unique clips scored → top ${picks.length} picked`);
  if (picks.length < opts.top) throw new Error(`Only ${picks.length} unique clips after dedupe — need ${opts.top}.`);

  // 4. titles + micro captions (+ replay flags for the 2 strongest)
  const titles = await buildTitles(topic, picks.map((c) => c.candidate.title), opts.top);
  const replayCut = [...picks].sort((a, b) => b.final - a.final)[Math.min(1, picks.length - 1)].final;
  const items: RankRotRenderItem[] = picks.map((c, i) => ({
    file: c.momentFile,
    rank: picks.length - i,
    durationSec: Math.min(MAX_MOMENT_SEC, c.momentEnd - c.momentStart),
    microTitle: titles.micros[i],
    replay: (opts.replays ?? true) && c.final >= replayCut,
  }));

  // 5. render + SFX + outputs
  const finalPath = join(exportsDir, 'ranking_final.mp4');
  await renderRankRot(items, {
    outPath: finalPath, topTitle: titles.top.title, subtext: titles.top.subtext, accent: opts.accent,
  });

  if (opts.sfx !== false) {
    const lib = await scanSfxLibrary(opts.sfxDir ?? process.env.SFX_DIR ?? './sfx');
    const events = planRankRotSfx(buildRankRotSfxPlan(items, COMP_FPS), lib, slug);
    if (events.length > 0) {
      const tmp = finalPath.replace(/\.mp4$/, '.sfx.mp4');
      await mixSfx(finalPath, events, tmp, { sfxVolume: opts.sfxVolume ?? 0.6 });
      await rename(tmp, finalPath);
      logger.info(`sfx: ${events.length} event(s) mixed under the countdown`);
    }
  }

  // thumbnail from the #1 moment at its fused peak (never fail the run over a PNG)
  const one = picks[picks.length - 1];
  const onePeak = analyzed.find((a) => a.momentFile === one.momentFile)?.peakRelSec ?? 0;
  try {
    await generateThumbnail(one.momentFile, onePeak, titles.top.title, join(exportsDir, 'thumbnail.png'), { accent: opts.accent });
  } catch (e) {
    logger.warn(`thumbnail failed (run continues): ${e instanceof Error ? e.message : String(e)}`);
  }

  await writeFile(join(exportsDir, 'title.txt'), titles.seo.title + '\n');
  await writeFile(join(exportsDir, 'description.txt'), titles.seo.description + '\n');
  await writeFile(join(exportsDir, 'hashtags.txt'), titles.seo.hashtags.join('\n') + '\n');
  await writeFile(join(exportsDir, 'rankrot_manifest.json'), JSON.stringify({
    topic, slug, generated_at: new Date().toISOString(),
    queries, candidates_considered: candidates.length, harvested: harvested.length,
    analyzed: analyzed.length, unique: kept.length,
    picks: picks.map((c, i) => ({
      rank: picks.length - i, id: c.candidate.id, title: c.candidate.title, url: c.candidate.url,
      moment: { start: c.momentStart, end: c.momentEnd }, layers: c.layers, final: c.final,
      micro_title: titles.micros[i], replay: items[i].replay,
    })),
  }, null, 2));

  logger.info(`RankRot complete → ${exportsDir}`);
  return exportsDir;
}
