import { describe, it, expect } from 'vitest';
import { buildClipJson, buildManifest } from '../../src/export/exporter.js';
import type { RankedClip, VideoMetadata } from '../../src/types/index.js';

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_001', start: 10, end: 70, duration: 60, composite_score: 8,
  semantic_score: 0, audio_score: 7, visual_score: 0, trigger_score: 9, pacing_score: 0, metadata_score: 0,
  hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 60, reason: 'r', transcript_excerpt: 'e',
};
const meta: VideoMetadata = {
  jobId: 'H14bBuluwB8', title: 'Goggins', duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264',
  chapters: [], description: '',
};

describe('exporter', () => {
  it('clip json includes files block and layer scores', () => {
    const j: any = buildClipJson(clip, 'H14bBuluwB8', { final: 'clip_001_final.mp4', raw: 'clip_001_raw.mp4', srt: 'clip_001.srt' });
    expect(j.clip_id).toBe('clip_001');
    expect(j.source_video).toBe('H14bBuluwB8');
    expect(j.files.final).toBe('clip_001_final.mp4');
    expect(j.layer_scores.trigger).toBe(9);
  });
  it('manifest aggregates clip count and scores', () => {
    const m: any = buildManifest('H14bBuluwB8', 'https://y/watch?v=H14bBuluwB8', meta, [clip]);
    expect(m.clips_generated).toBe(1);
    expect(m.top_score).toBe(8);
    expect(m.title).toBe('Goggins');
    expect(m.clips).toHaveLength(1);
  });
});
