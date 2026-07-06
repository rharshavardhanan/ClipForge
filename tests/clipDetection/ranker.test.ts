import { describe, it, expect } from 'vitest';
import { rank, defaultMinScore, clipText, priorityBoost } from '../../src/clipDetection/ranker.js';
import type { ClipCandidate, SemanticWindow, TranscriptSegment, WindowScore } from '../../src/types/index.js';

const segs: TranscriptSegment[] = [
  { id: 0, start: 0, end: 30, text: 'alpha beta gamma delta', words: [] },
  { id: 1, start: 30, end: 60, text: 'epsilon zeta eta theta', words: [] },
];

const baseSemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};

describe('ranker', () => {
  it('defaultMinScore = mean + 0.5*stddev', () => {
    const w: WindowScore[] = [
      { start: 0, end: 30, triggerScore: 0, audioScore: 0, composite: 2 },
      { start: 0, end: 30, triggerScore: 0, audioScore: 0, composite: 4 },
    ];
    expect(defaultMinScore(w)).toBeCloseTo(3 + 0.5 * 1); // mean 3, stddev 1
  });

  it('clipText gathers overlapping segment text', () => {
    expect(clipText({ start: 0, end: 30, composite: 5, triggerScore: 0, audioScore: 0 }, segs)).toContain('alpha');
  });

  it('ranks desc, assigns ids, applies top-N', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 35, composite: 5, triggerScore: 6, audioScore: 4 },
      { start: 30, end: 62, composite: 8, triggerScore: 9, audioScore: 7 },
    ];
    const r = rank(cands, segs, { top: 1, minScore: 0 });
    expect(r).toHaveLength(1);
    expect(r[0].clip_id).toBe('clip_001');
    expect(r[0].composite_score).toBe(8);
    expect(r[0].semantic_score).toBe(0);
    expect(r[0].audio_score).toBe(7);
  });

  it('surfaces the candidate commentScore as metadata_score (0 when absent)', () => {
    // [0,30) and [30,62) overlap disjoint segments, so dedup keeps both.
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 8, triggerScore: 6, audioScore: 4, commentScore: 7.5 },
      { start: 30, end: 62, composite: 5, triggerScore: 3, audioScore: 2 },
    ];
    const r = rank(cands, segs, { top: 2, minScore: 0 });
    expect(r[0].metadata_score).toBe(7.5);
    expect(r[1].metadata_score).toBe(0);
  });

  it('dedups clips sharing >40% transcript', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 8, triggerScore: 0, audioScore: 0 },
      { start: 0, end: 30, composite: 5, triggerScore: 0, audioScore: 0 },
    ];
    const r = rank(cands, segs, { top: 5, minScore: 0 });
    expect(r).toHaveLength(1);
    expect(r[0].composite_score).toBe(8);
  });

  it('filters out candidates below minScore', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 2, triggerScore: 0, audioScore: 0 },
    ];
    expect(rank(cands, segs, { top: 5, minScore: 3 })).toHaveLength(0);
  });

  it('defaultMinScore returns 0 for an empty window list', () => {
    expect(defaultMinScore([])).toBe(0);
  });

  it('attaches semantic fields from the overlapping semantic window onto the RankedClip', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 8, triggerScore: 6, audioScore: 4 },
    ];
    const semantic: SemanticWindow[] = [
      {
        start: 0, end: 30, semantic_score: 9, scores: baseSemanticScores,
        hook_moment: 'you will not believe this', clip_titles: ['Title A', 'Title B', 'Title C'],
        is_standalone: true, recommended_duration: 45, sentiment: 'intense', reason: 'huge emotional peak',
      },
    ];
    const r = rank(cands, segs, { top: 5, minScore: 0 }, semantic);
    expect(r).toHaveLength(1);
    expect(r[0].hook_moment).toBe('you will not believe this');
    expect(r[0].semantic_score).toBe(9);
    expect(r[0].is_standalone).toBe(true);
    expect(r[0].recommended_duration).toBe(45); // adaptive length: semantic 45s allowed (60s cap)
    expect(r[0].sentiment).toBe('intense');
    expect(r[0].reason).toBe('huge emotional peak');
    expect(r[0].clip_titles).toEqual(['Title A', 'Title B', 'Title C']);
  });

  it('drops a candidate whose overlapping semantic window is non-standalone and composite < 7', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 5, triggerScore: 2, audioScore: 3 },
      { start: 30, end: 60, composite: 8, triggerScore: 6, audioScore: 7 },
    ];
    const semantic: SemanticWindow[] = [
      {
        start: 0, end: 30, semantic_score: 3, scores: baseSemanticScores,
        hook_moment: '', clip_titles: [], is_standalone: false, recommended_duration: 30,
        sentiment: 'neutral', reason: 'needs context',
      },
      {
        start: 30, end: 60, semantic_score: 8, scores: baseSemanticScores,
        hook_moment: 'big reveal', clip_titles: [], is_standalone: true, recommended_duration: 60,
        sentiment: 'intense', reason: 'standalone peak',
      },
    ];
    const r = rank(cands, segs, { top: 5, minScore: 0 }, semantic);
    expect(r).toHaveLength(1);
    expect(r[0].start).toBe(30);
  });

  it('keeps a non-standalone candidate when composite_score >= 7', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 7, triggerScore: 5, audioScore: 5 },
    ];
    const semantic: SemanticWindow[] = [
      {
        start: 0, end: 30, semantic_score: 7, scores: baseSemanticScores,
        hook_moment: '', clip_titles: [], is_standalone: false, recommended_duration: 30,
        sentiment: 'neutral', reason: 'still strong',
      },
    ];
    const r = rank(cands, segs, { top: 5, minScore: 0 }, semantic);
    expect(r).toHaveLength(1);
  });

  it('keeps non-standalone candidates when semantic is absent entirely (Slice-1 behavior)', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 2, triggerScore: 0, audioScore: 0 },
    ];
    const r = rank(cands, segs, { top: 5, minScore: 0 });
    expect(r).toHaveLength(1);
  });
});

describe('priorityBoost (v6 modes)', () => {
  const sw = {
    start: 0, end: 30, semantic_score: 5,
    scores: {
      emotional_intensity: 0, controversy: 0, humor: 10, surprise: 10,
      wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
    },
    hook_moment: 'h', clip_titles: [], is_standalone: true, recommended_duration: 30,
    sentiment: 'funny', reason: 'r',
  } as const;

  it('is 0 without a window or priorities, ≤1.5 otherwise', () => {
    expect(priorityBoost(null, ['humor'])).toBe(0);
    expect(priorityBoost(sw as never, undefined)).toBe(0);
    expect(priorityBoost(sw as never, ['humor', 'surprise'])).toBeCloseTo(1.5);
    expect(priorityBoost(sw as never, ['wisdom'])).toBe(0);
  });

  it('reorders near-equal candidates toward the mode grammar', () => {
    const segs = [
      { id: 0, start: 0, end: 30, text: 'alpha beta gamma delta epsilon', words: [] },
      { id: 1, start: 100, end: 130, text: 'zeta eta theta iota kappa', words: [] },
    ];
    const funnyWin = { ...sw, start: 0, end: 30 };
    const wiseWin = {
      ...sw, start: 100, end: 130,
      scores: { ...sw.scores, humor: 0, surprise: 0, wisdom: 10, storytelling_tension: 10 },
    };
    const cands = [
      { start: 0, end: 30, composite: 7.0, triggerScore: 5, audioScore: 5 },
      { start: 100, end: 130, composite: 7.2, triggerScore: 5, audioScore: 5 },
    ];
    const clippies = rank(cands, segs as never, { top: 2, priorities: ['humor', 'surprise'] }, [funnyWin, wiseWin] as never);
    expect(clippies[0].start).toBe(0);            // humor boost outranks the 0.2 composite gap
    const neutral = rank(cands, segs as never, { top: 2 }, [funnyWin, wiseWin] as never);
    expect(neutral[0].start).toBe(100);           // without priorities, raw composite wins
  });
});

// ---- v7 arc weighting -------------------------------------------------------------------
import { arcWeightedComposite } from '../../src/clipDetection/ranker.js';
import type { ArcLabel } from '../../src/types/index.js';

const fullComponents = {
  setup: { start: 0, end: 4 }, trigger: { start: 3, end: 4 },
  escalation: { start: 4, end: 8 }, peak: { start: 8, end: 10 },
  payoff: { start: 10, end: 13 }, reaction: { start: 13, end: 16 },
};

describe('arcWeightedComposite', () => {
  it('no arc → raw composite unchanged (no-LLM runs behave exactly as today)', () => {
    expect(arcWeightedComposite(8)).toBe(8);
  });
  it('full-confidence arc → 0.75×composite + 0.25×10', () => {
    const arc: ArcLabel = { synopsis: 's', confidence: 1, components: fullComponents };
    expect(arcWeightedComposite(8, arc)).toBeCloseTo(0.75 * 8 + 0.25 * 10);
  });
});

describe('rank with arcs', () => {
  it('an arc-labeled candidate outranks an equal-composite bare candidate and carries arc onto RankedClip', () => {
    const arc: ArcLabel = { synopsis: 'story', confidence: 1, components: fullComponents, reactionAfterPeak: true };
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 8, triggerScore: 6, audioScore: 4, arc },
      { start: 30, end: 62, composite: 8, triggerScore: 6, audioScore: 4 },
    ];
    const r = rank(cands, segs, { top: 2, minScore: 0 });
    expect(r[0].start).toBe(0);
    expect(r[0].arc?.synopsis).toBe('story');
    expect(r[0].composite_score).toBeCloseTo(0.75 * 8 + 0.25 * 10, 1);
    expect(r[1].arc).toBeUndefined();
    expect(r[1].composite_score).toBe(8);
  });
  it('min-score filter still uses the RAW composite', () => {
    // raw 6 passes min 5.5 even though a weak arc drags the effective score to ~4.5
    const weakArc: ArcLabel = { synopsis: 'w', confidence: 0, components: fullComponents };
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 6, triggerScore: 6, audioScore: 4, arc: weakArc },
    ];
    const r = rank(cands, segs, { top: 1, minScore: 5.5 });
    expect(r).toHaveLength(1);
    expect(r[0].composite_score).toBeCloseTo(4.5);
  });
});

describe('filler penalty (v4 Slice B)', () => {
  it('a filler-dense candidate ranks below an equal-composite clean one', () => {
    const fillerSegs: TranscriptSegment[] = [
      { id: 0, start: 0, end: 30, text: 'um so like you know basically i mean uh', words: [] },
      { id: 1, start: 30, end: 60, text: 'discipline is the bridge between goals and accomplishment', words: [] },
    ];
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 7, triggerScore: 5, audioScore: 5 },   // filler-heavy
      { start: 30, end: 60, composite: 7, triggerScore: 5, audioScore: 5 },  // clean
    ];
    const r = rank(cands, fillerSegs, { top: 2, minScore: 0 });
    expect(r[0].transcript_excerpt).toContain('discipline');   // clean clip wins the tie
    expect(r[1].transcript_excerpt).toContain('um');
  });
});
