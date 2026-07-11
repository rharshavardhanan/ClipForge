import { describe, expect, it } from 'vitest';
import { mergeMinedCandidates, overlapFraction } from '../../src/analysis/arcMiner.js';
import type { ArcLabel, ClipCandidate } from '../../src/types/index.js';

const fullComponents = {
  setup: { start: 10, end: 13 }, trigger: { start: 12, end: 13 }, escalation: { start: 13, end: 16 },
  peak: { start: 16, end: 18 }, payoff: { start: 18, end: 21 }, reaction: { start: 21, end: 25 },
};

describe('overlapFraction / mergeMinedCandidates', () => {
  const cand: ClipCandidate = { start: 10, end: 25, composite: 6, triggerScore: 3, audioScore: 3 };
  const arc: ArcLabel = { synopsis: 's', confidence: 0.9, components: fullComponents, reactionAfterPeak: true };
  it('overlapFraction uses the smaller span as denominator', () => {
    expect(overlapFraction({ start: 0, end: 10 }, { start: 5, end: 25 })).toBe(0.5);
  });
  it('≥50% overlap → existing candidate gains the label and keeps its composite', () => {
    const out = mergeMinedCandidates([cand], [arc]);
    expect(out).toHaveLength(1);
    expect(out[0].composite).toBe(6);
    expect(out[0].arc?.synopsis).toBe('s');
  });
  it('a stronger label replaces a weaker one on the same host', () => {
    const weak: ArcLabel = { ...arc, confidence: 0.2, synopsis: 'weak' };
    const out = mergeMinedCandidates([{ ...cand, arc: weak }], [arc]);
    expect(out[0].arc?.synopsis).toBe('s');
  });
  it('disjoint arc becomes a new candidate with composite = 10×arcScore', () => {
    const far: ArcLabel = {
      ...arc,
      components: {
        setup: { start: 100, end: 103 }, trigger: { start: 101, end: 102 },
        escalation: { start: 103, end: 105 }, peak: { start: 105, end: 107 },
        payoff: { start: 107, end: 110 }, reaction: { start: 110, end: 115 },
      },
    };
    const out = mergeMinedCandidates([cand], [far]);
    expect(out).toHaveLength(2);
    const mined = out.find((c) => c.start === 100)!;
    expect(mined.composite).toBeCloseTo(10 * Math.min(1, 0.9 * 1.15));
    expect(mined.end).toBe(115);
  });
});
