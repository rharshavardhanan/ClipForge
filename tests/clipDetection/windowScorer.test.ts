import { describe, it, expect } from 'vitest';
import { scoreWindows } from '../../src/clipDetection/windowScorer.js';
import type { AudioEnergyLayer, SemanticWindow } from '../../src/types/index.js';

const audio: AudioEnergyLayer = {
  rms_curve: Array.from({ length: 60 }, (_, t) => ({ time: t, rms: 5 })),
  silence_regions: [],
};

const baseSemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};

describe('scoreWindows', () => {
  it('emits 30s windows stepping by 15s', () => {
    const w = scoreWindows(60, [], audio);
    expect(w).toHaveLength(4);            // starts 0,15,30,45 for duration 60
    expect(w[0].start).toBe(0); expect(w[0].end).toBe(30);
    expect(w[1].start).toBe(15);
    expect(w[2].start).toBe(30);
    expect(w[3].start).toBe(45);
    expect(w[3].end).toBe(60);            // tail window clamped to duration
  });
  it('applies the 0.6/0.4 composite and caps trigger score at 10', () => {
    const triggers = [{ time: 5, weight: 9, phrase: 'x', tier: 1 as const }, { time: 6, weight: 9, phrase: 'y', tier: 1 as const }];
    const w = scoreWindows(60, triggers, audio);
    expect(w[0].triggerScore).toBe(10);      // 18 capped to 10
    expect(w[0].audioScore).toBeCloseTo(5);
    expect(w[0].composite).toBeCloseTo(10 * 0.6 + 5 * 0.4);
    expect(w[0].semanticScore).toBe(0);
  });

  it('applies the 0.5/0.3/0.2 semantic-dominant composite when semantic windows are present', () => {
    const triggers = [{ time: 5, weight: 9, phrase: 'x', tier: 1 as const }, { time: 6, weight: 9, phrase: 'y', tier: 1 as const }];
    const semantic: SemanticWindow[] = [
      {
        start: 0, end: 30, semantic_score: 8, scores: baseSemanticScores,
        hook_moment: 'wow', clip_titles: [], is_standalone: true, recommended_duration: 60,
        sentiment: 'intense', reason: 'big moment',
      },
    ];
    const w = scoreWindows(60, triggers, audio, semantic);
    expect(w[0].triggerScore).toBe(10);
    expect(w[0].audioScore).toBeCloseTo(5);
    expect(w[0].semanticScore).toBe(8);
    expect(w[0].composite).toBeCloseTo(8 * 0.5 + 5 * 0.3 + 10 * 0.2);
  });

  it('folds comment boosts into the composite as an additive bonus on affected windows', () => {
    const boosts = [{ time: 5, weight: 10 }];
    const w = scoreWindows(60, [], audio, [], boosts);
    expect(w[0].commentScore).toBe(10);                      // boost at t=5 inside [0,30)
    expect(w[0].composite).toBeCloseTo(5 * 0.4 + 10 * 0.15); // base 0.6/0.4 + comment bonus
    expect(w[1].commentScore).toBe(0);                       // t=5 outside [15,45)
    expect(w[1].composite).toBeCloseTo(5 * 0.4);             // untouched without boosts
  });

  it('sums multiple boosts within a window and caps commentScore at 10', () => {
    const boosts = [{ time: 5, weight: 8 }, { time: 10, weight: 8 }];
    const w = scoreWindows(60, [], audio, [], boosts);
    expect(w[0].commentScore).toBe(10); // 16 capped to 10
  });

  it('finds the semantic window with max overlap, not just the first match', () => {
    const semantic: SemanticWindow[] = [
      {
        start: 0, end: 16, semantic_score: 2, scores: baseSemanticScores,
        hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 60,
        sentiment: 'neutral', reason: '',
      },
      {
        start: 10, end: 40, semantic_score: 9, scores: baseSemanticScores,
        hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 60,
        sentiment: 'neutral', reason: '',
      },
    ];
    // window[1] is start=15,end=45 — overlaps [10,40) by 25s vs [0,16) by 1s, so the bigger-overlap window (score 9) wins.
    const w = scoreWindows(60, [], audio, semantic);
    expect(w[1].start).toBe(15);
    expect(w[1].semanticScore).toBe(9);
  });
});
