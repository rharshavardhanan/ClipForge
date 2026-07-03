import { describe, expect, it } from 'vitest';
import { applyCompletionToClip, arcRejectionRow, padSpan, rawComposite, toCurve } from '../../src/cli/commands/all.js';
import { arcScore } from '../../src/analysis/arcTypes.js';
import type { ArcCompletion } from '../../src/analysis/arcCompleter.js';
import type { RankedClip } from '../../src/types/index.js';

const fullComponents = {
  setup: { start: 20, end: 24 }, trigger: { start: 23, end: 24 }, escalation: { start: 24, end: 28 },
  peak: { start: 28, end: 30 }, payoff: { start: 30, end: 33 }, reaction: { start: 33, end: 38 },
};

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_001', start: 22, end: 34, duration: 12,
  composite_score: 8, semantic_score: 0, audio_score: 0, visual_score: 0,
  trigger_score: 0, pacing_score: 0, metadata_score: 0,
  hook_moment: '', clip_titles: [], is_standalone: true,
  recommended_duration: 30, reason: '', transcript_excerpt: '',
};

const completion: ArcCompletion = {
  components: fullComponents, missing: [], bounds: { start: 18, end: 40 },
  confidence: 0.9, synopsis: 'the story', reactionAfterPeak: true,
};

describe('toCurve / padSpan', () => {
  it('adapts rms points and pads spans within [0, max]', () => {
    expect(toCurve({ rms_curve: [{ time: 1, rms: 5 }], silence_regions: [] })).toEqual([{ time: 1, v: 5 }]);
    expect(padSpan({ start: 5, end: 20 }, 10, 25)).toEqual({ start: 0, end: 25 });
  });
});

describe('rawComposite', () => {
  it('identity without arc; inverts the arc weighting with one', () => {
    expect(rawComposite(clip)).toBe(8);
    const label = { synopsis: 's', confidence: 0.9, components: fullComponents, reactionAfterPeak: true };
    const weighted = { ...clip, arc: label, composite_score: +(0.75 * 8 + 2.5 * arcScore(label)).toFixed(2) };
    expect(rawComposite(weighted)).toBeCloseTo(8, 1);
  });
});

describe('applyCompletionToClip', () => {
  it('updates start/end/duration, sets arc, and re-scores with the completion label', () => {
    const out = applyCompletionToClip(clip, completion, { start: 18, end: 40 });
    expect(out.start).toBe(18);
    expect(out.end).toBe(40);
    expect(out.duration).toBe(22);
    expect(out.arc?.synopsis).toBe('the story');
    const label = { synopsis: 'the story', confidence: 0.9, components: fullComponents, reactionAfterPeak: true };
    expect(out.composite_score).toBeCloseTo(0.75 * 8 + 2.5 * arcScore(label), 1);
  });
});

describe('arcRejectionRow', () => {
  it('captures the clip span and reasons', () => {
    expect(arcRejectionRow(clip, ['trigger'], 'incomplete-arc'))
      .toEqual({ clip_id: 'clip_001', start: 22, end: 34, missing: ['trigger'], reason: 'incomplete-arc' });
  });
});
