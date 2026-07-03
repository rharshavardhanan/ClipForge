import type { BrollSegment, RankedClip, VideoMetadata } from '../types/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildSeoPack, writeSeoFiles, type SeoPack } from './seo.js';
import { TICK } from '../avss/simulator.js';
import type { ScoredVariant } from '../avss/variants.js';
import type { EditDna } from '../avss/templates.js';

/** Everything the exporter needs to persist one clip's AVSS run. */
export interface AvssExport {
  winner: ScoredVariant;
  all: ScoredVariant[];
  dna: EditDna;
  policyVersion: number;
}

/** PURE: the five spec output files (name → JSON body) for one clip's AVSS result. */
export function buildAvssFiles(clipId: string, a: AvssExport): Record<string, unknown> {
  const s = a.winner.sim;
  return {
    [`${clipId}_attention_graph.json`]: { tick: TICK, attention: s.attention, dopamine: s.dopamine },
    [`${clipId}_retention_prediction.json`]: {
      curve: s.retention, avg_retention: s.avgRetention, completion: s.completion, dropoffs: s.dropoffs,
    },
    [`${clipId}_swipe_risk.json`]: {
      hazard: s.hazard, top_risks: s.dropoffs, overall_risk: +(1 - s.completion).toFixed(4),
    },
    [`${clipId}_rewatch_score.json`]: { score: s.rewatch, factors: s.rewatchFactors },
    [`${clipId}_edit_variant_scores.json`]: a.all.map(({ variant, sim }) => ({
      id: variant.id,
      changed: variant.changed,
      violations: variant.violations,
      predicted: {
        retention: +sim.avgRetention.toFixed(4), completion: +sim.completion.toFixed(4),
        rewatch: +sim.rewatch.toFixed(4), overall: +sim.overall.toFixed(4),
      },
      winner: variant.id === a.winner.variant.id,
    })),
  };
}

/** PURE: the `avss` block embedded in clip.json (what `clipforge stats` learns from). */
export function buildAvssBlock(a: AvssExport) {
  return {
    variant: a.winner.variant.id,
    changed: a.winner.variant.changed,
    dna: a.dna,
    predicted: {
      retention: a.winner.sim.avgRetention, completion: a.winner.sim.completion,
      rewatch: a.winner.sim.rewatch, overall: a.winner.sim.overall,
    },
    policy_version: a.policyVersion,
  };
}

/** PURE: one clip's B-roll entries for clip.json / broll_manifest.json. */
export function buildBrollEntries(broll: BrollSegment[]) {
  return broll.map((b) => ({
    entity: b.entity, kind: b.kind, query: b.query, source_url: b.sourceUrl,
    cache_file: basename(b.file), at_sec: b.atSec, duration_sec: b.durationSec,
  }));
}

/** PURE: the broll_manifest.json body — clip_id → narrative-overlay entries. */
export function buildBrollManifest(clips: RankedClip[], brollByClip?: Map<string, BrollSegment[]>) {
  const out: Record<string, ReturnType<typeof buildBrollEntries>> = {};
  for (const clip of clips) {
    const broll = brollByClip?.get(clip.clip_id);
    if (broll && broll.length > 0) out[clip.clip_id] = buildBrollEntries(broll);
  }
  return out;
}

export function buildClipJson(
  clip: RankedClip, jobId: string,
  files: { final: string; raw: string; srt: string; thumbnail?: string },
  seo?: SeoPack,
  broll?: BrollSegment[],
  avss?: AvssExport,
) {
  return {
    clip_id: clip.clip_id, rank: clip.rank, source_video: clip.source_video ?? jobId,
    start: clip.start, end: clip.end, duration: clip.duration,
    composite_score: clip.composite_score,
    layer_scores: {
      semantic: clip.semantic_score, audio: clip.audio_score, visual: clip.visual_score,
      trigger: clip.trigger_score, pacing: clip.pacing_score, metadata: clip.metadata_score,
    },
    hook_moment: clip.hook_moment, clip_titles: clip.clip_titles, is_standalone: clip.is_standalone,
    recommended_duration: clip.recommended_duration, reason: clip.reason, sentiment: clip.sentiment,
    transcript_excerpt: clip.transcript_excerpt, seo,
    ...(broll && broll.length > 0 ? { broll: buildBrollEntries(broll) } : {}),
    ...(avss ? { avss: buildAvssBlock(avss) } : {}),
    files,
  };
}

export function buildManifest(
  jobId: string, source: string, meta: VideoMetadata, clips: RankedClip[],
  avssByClip?: Map<string, AvssExport>,
) {
  const scores = clips.map((c) => c.composite_score);
  return {
    job_id: jobId, source, title: meta.title, processed_at: new Date().toISOString(),
    total_duration: meta.duration, clips_generated: clips.length,
    top_score: scores.length ? Math.max(...scores) : 0,
    avg_score: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0,
    clips: clips.map((c) => {
      const a = avssByClip?.get(c.clip_id);
      return a ? { ...c, predicted_retention: +a.winner.sim.avgRetention.toFixed(4) } : c;
    }),
  };
}

export async function writeExports(
  dir: string, jobId: string, source: string, meta: VideoMetadata, clips: RankedClip[],
  packs?: Map<string, SeoPack>,
  brollByClip?: Map<string, BrollSegment[]>,
  avssByClip?: Map<string, AvssExport>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const clip of clips) {
    // Batch runs pass per-clip packs built from each clip's OWN source metadata (correct
    // creator tags); the fallback rebuild from `meta` covers single-video callers.
    const pack = packs?.get(clip.clip_id) ?? buildSeoPack(clip, meta);
    await writeSeoFiles(dir, clip.clip_id, pack);
    const files = {
      final: `${clip.clip_id}_final.mp4`, raw: `${clip.clip_id}_raw.mp4`, srt: `${clip.clip_id}.srt`,
      thumbnail: `${clip.clip_id}_thumbnail.png`,
    };
    const avss = avssByClip?.get(clip.clip_id);
    if (avss) {
      for (const [name, body] of Object.entries(buildAvssFiles(clip.clip_id, avss))) {
        await writeFile(join(dir, name), JSON.stringify(body, null, 2));
      }
    }
    await writeFile(join(dir, `${clip.clip_id}.json`),
      JSON.stringify(buildClipJson(clip, jobId, files, pack, brollByClip?.get(clip.clip_id), avss), null, 2));
  }
  await writeFile(join(dir, 'broll_manifest.json'), JSON.stringify(buildBrollManifest(clips, brollByClip), null, 2));
  await writeFile(join(dir, 'clips_manifest.json'), JSON.stringify(buildManifest(jobId, source, meta, clips, avssByClip), null, 2));
}
