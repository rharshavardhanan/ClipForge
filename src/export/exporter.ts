import type { BrollSegment, RankedClip, VideoMetadata } from '../types/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildSeoPack, writeSeoFiles, type SeoPack } from './seo.js';

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
    files,
  };
}

export function buildManifest(jobId: string, source: string, meta: VideoMetadata, clips: RankedClip[]) {
  const scores = clips.map((c) => c.composite_score);
  return {
    job_id: jobId, source, title: meta.title, processed_at: new Date().toISOString(),
    total_duration: meta.duration, clips_generated: clips.length,
    top_score: scores.length ? Math.max(...scores) : 0,
    avg_score: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0,
    clips,
  };
}

export async function writeExports(
  dir: string, jobId: string, source: string, meta: VideoMetadata, clips: RankedClip[],
  packs?: Map<string, SeoPack>,
  brollByClip?: Map<string, BrollSegment[]>,
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
    await writeFile(join(dir, `${clip.clip_id}.json`),
      JSON.stringify(buildClipJson(clip, jobId, files, pack, brollByClip?.get(clip.clip_id)), null, 2));
  }
  await writeFile(join(dir, 'broll_manifest.json'), JSON.stringify(buildBrollManifest(clips, brollByClip), null, 2));
  await writeFile(join(dir, 'clips_manifest.json'), JSON.stringify(buildManifest(jobId, source, meta, clips), null, 2));
}
