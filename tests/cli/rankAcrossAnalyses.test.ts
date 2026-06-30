import { describe, it, expect } from 'vitest';
import { rankAcrossAnalyses, batchId, type SourcedRankedClip } from '../../src/cli/commands/all.js';
import type { RankedClip, VideoAnalysis } from '../../src/types/index.js';

function makeAnalysis(jobId: string, url: string): VideoAnalysis {
  return {
    jobId, url, videoPath: `/tmp/${jobId}.mp4`,
    meta: {
      jobId, title: `Title ${jobId}`, duration: 600, width: 1920, height: 1080, fps: 30, codec: 'h264',
      chapters: [], description: '',
    },
    segments: [], triggers: [], audio: { rms_curve: [], silence_regions: [] }, semantic: [], candidates: [],
  };
}

function makeClip(id: string, composite: number): RankedClip {
  return {
    rank: 0, clip_id: id, start: 0, end: 30, duration: 30, composite_score: composite,
    semantic_score: 0, audio_score: 0, visual_score: 0, trigger_score: 0, pacing_score: 0, metadata_score: 0,
    hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 30, reason: '', transcript_excerpt: '',
  };
}

describe('rankAcrossAnalyses', () => {
  const videoA = makeAnalysis('vidA', 'https://www.youtube.com/watch?v=vidA');
  const videoB = makeAnalysis('vidB', 'https://www.youtube.com/watch?v=vidB');

  it('picks the highest-composite clips across sources, ignoring which source they came from', () => {
    const pool: SourcedRankedClip[] = [
      { clip: makeClip('clip_001', 5), source: videoA },
      { clip: makeClip('clip_002', 9), source: videoA },
      { clip: makeClip('clip_001', 8), source: videoB },
      { clip: makeClip('clip_002', 3), source: videoB },
    ];
    const top = rankAcrossAnalyses(pool, { top: 2 });
    expect(top).toHaveLength(2);
    expect(top[0].clip.composite_score).toBe(9);
    expect(top[0].source.jobId).toBe('vidA');
    expect(top[1].clip.composite_score).toBe(8);
    expect(top[1].source.jobId).toBe('vidB');
  });

  it('preserves source attribution via source_video/source_url tags', () => {
    const pool: SourcedRankedClip[] = [
      { clip: makeClip('clip_001', 9), source: videoA },
      { clip: makeClip('clip_001', 7), source: videoB },
    ];
    const top = rankAcrossAnalyses(pool, { top: 2 });
    expect(top[0].clip.source_video).toBe('vidA');
    expect(top[0].clip.source_url).toBe(videoA.url);
    expect(top[1].clip.source_video).toBe('vidB');
    expect(top[1].clip.source_url).toBe(videoB.url);
  });

  it('respects perVideoCap, preventing one source from monopolizing all slots', () => {
    const pool: SourcedRankedClip[] = [
      { clip: makeClip('clip_001', 10), source: videoA },
      { clip: makeClip('clip_002', 9), source: videoA },
      { clip: makeClip('clip_003', 8), source: videoA },
      { clip: makeClip('clip_001', 5), source: videoB },
    ];
    const top = rankAcrossAnalyses(pool, { top: 3, perVideoCap: 1 });
    expect(top).toHaveLength(2);
    expect(top.map((t) => t.source.jobId)).toEqual(['vidA', 'vidB']);
    expect(top[0].clip.composite_score).toBe(10);
    expect(top[1].clip.composite_score).toBe(5);
  });

  it('without a perVideoCap, a single source can take all top-N slots', () => {
    const pool: SourcedRankedClip[] = [
      { clip: makeClip('clip_001', 10), source: videoA },
      { clip: makeClip('clip_002', 9), source: videoA },
      { clip: makeClip('clip_001', 8), source: videoB },
    ];
    const top = rankAcrossAnalyses(pool, { top: 2 });
    expect(top.every((t) => t.source.jobId === 'vidA')).toBe(true);
  });

  it('re-numbers rank and clip_id 1..N globally after selection, overwriting per-analysis numbering', () => {
    const pool: SourcedRankedClip[] = [
      { clip: makeClip('clip_001', 5), source: videoA },
      { clip: makeClip('clip_001', 9), source: videoB },
    ];
    const top = rankAcrossAnalyses(pool, { top: 2 });
    expect(top[0].clip.rank).toBe(1);
    expect(top[0].clip.clip_id).toBe('clip_001');
    expect(top[0].clip.composite_score).toBe(9);
    expect(top[1].clip.rank).toBe(2);
    expect(top[1].clip.clip_id).toBe('clip_002');
    expect(top[1].clip.composite_score).toBe(5);
  });

  it('returns fewer than top when the pool is smaller than top-N', () => {
    const pool: SourcedRankedClip[] = [{ clip: makeClip('clip_001', 5), source: videoA }];
    const top = rankAcrossAnalyses(pool, { top: 5 });
    expect(top).toHaveLength(1);
  });
});

describe('batchId', () => {
  it('is order-independent (same id regardless of URL order)', () => {
    const a = batchId(['https://y/1', 'https://y/2']);
    const b = batchId(['https://y/2', 'https://y/1']);
    expect(a).toBe(b);
  });

  it('differs for different URL sets', () => {
    expect(batchId(['https://y/1'])).not.toBe(batchId(['https://y/2']));
  });

  it('is prefixed with batch_', () => {
    expect(batchId(['https://y/1'])).toMatch(/^batch_[0-9a-f]+$/);
  });
});
