import { describe, it, expect } from 'vitest';
import { rank, defaultMinScore, clipText } from '../../src/clipDetection/ranker.js';
import type { ClipCandidate, TranscriptSegment, WindowScore } from '../../src/types/index.js';

const segs: TranscriptSegment[] = [
  { id: 0, start: 0, end: 30, text: 'alpha beta gamma delta', words: [] },
  { id: 1, start: 30, end: 60, text: 'epsilon zeta eta theta', words: [] },
];

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

  it('dedups clips sharing >40% transcript', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 8, triggerScore: 0, audioScore: 0 },
      { start: 0, end: 30, composite: 5, triggerScore: 0, audioScore: 0 },
    ];
    const r = rank(cands, segs, { top: 5, minScore: 0 });
    expect(r).toHaveLength(1);
    expect(r[0].composite_score).toBe(8);
  });
});
