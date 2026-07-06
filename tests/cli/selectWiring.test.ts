import { describe, it, expect } from 'vitest';
import { survivorToSelectable } from '../../src/cli/commands/all.js';
import type { RankedClip } from '../../src/types/index.js';

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_003', start: 10, end: 40, duration: 30, composite_score: 7.5,
  semantic_score: 6, audio_score: 5, visual_score: 0, trigger_score: 4, pacing_score: 0, metadata_score: 0,
  hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 30, reason: '', transcript_excerpt: '',
};

describe('survivorToSelectable', () => {
  it('maps clip + context into the diversity selector input', () => {
    const s = survivorToSelectable(clip, 'vidA', 'gym motivation', 0.8);
    expect(s).toEqual({ id: 'clip_003', composite: 7.5, visual: 0.8, topic: 'gym motivation', sourceId: 'vidA' });
  });
});
