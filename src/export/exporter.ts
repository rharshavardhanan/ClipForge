import type { RankedClip, VideoMetadata } from '../types/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSeoPack, writeSeoFiles, type SeoPack } from './seo.js';

export function buildClipJson(
  clip: RankedClip, jobId: string,
  files: { final: string; raw: string; srt: string; thumbnail?: string },
  seo?: SeoPack,
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
    transcript_excerpt: clip.transcript_excerpt, seo, files,
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
    await writeFile(join(dir, `${clip.clip_id}.json`), JSON.stringify(buildClipJson(clip, jobId, files, pack), null, 2));
  }
  await writeFile(join(dir, 'clips_manifest.json'), JSON.stringify(buildManifest(jobId, source, meta, clips), null, 2));
}
