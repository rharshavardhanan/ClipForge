import { describe, it, expect } from 'vitest';
import type { RankedClip } from '../../src/types/index.js';

describe('types', () => {
  it('RankedClip carries all six layer-score fields', () => {
    const clip: RankedClip = {
      rank: 1, clip_id: 'clip_001', start: 0, end: 60, duration: 60,
      composite_score: 5, semantic_score: 0, audio_score: 4, visual_score: 0,
      trigger_score: 6, pacing_score: 0, metadata_score: 0,
      hook_moment: '', clip_titles: [], is_standalone: true,
      recommended_duration: 60, reason: 'x', transcript_excerpt: 'y',
    };
    expect(clip.semantic_score).toBe(0);
    expect(clip.clip_id).toBe('clip_001');
  });
});
