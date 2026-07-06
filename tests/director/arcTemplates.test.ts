import { describe, it, expect } from 'vitest';
import {
  isQuestion, spanComposite, detectQaCandidates, detectReactionCandidates, generateArcTemplateCandidates,
  TEMPLATE_QA_BONUS, mergeTemplateCandidates,
} from '../../src/director/arcTemplates.js';
import type { AudioEnergyLayer, TranscriptSegment, TriggerHit } from '../../src/types/index.js';

const lengths = { min: 15, soft: 30, max: 45 };
const seg = (id: number, start: number, end: number, text: string): TranscriptSegment => ({ id, start, end, text, words: [] });
const audio: AudioEnergyLayer = {
  rms_curve: Array.from({ length: 120 }, (_, i) => ({ time: i, rms: 5 })),
  silence_regions: [],
};

describe('isQuestion', () => {
  it('detects ? endings and interrogative openers', () => {
    expect(isQuestion('Why did you do that?')).toBe(true);
    expect(isQuestion('Is that real')).toBe(true);
    expect(isQuestion('How do you stay disciplined')).toBe(true);
    expect(isQuestion('Because I wanted to win.')).toBe(false);
    expect(isQuestion('')).toBe(false);
  });
});

describe('spanComposite', () => {
  it('combines trigger weights + mean rms + bonus, capped at 10', () => {
    const triggers: TriggerHit[] = [{ time: 12, weight: 4, phrase: 'no way', tier: 1 }];
    const r = spanComposite(10, 20, triggers, audio, TEMPLATE_QA_BONUS);
    // triggerScore 4·0.6=2.4, audioScore 5·0.4=2.0, +1 bonus = 5.4
    expect(r.triggerScore).toBe(4);
    expect(r.audioScore).toBeCloseTo(5);
    expect(r.composite).toBeCloseTo(5.4);
  });
  it('caps at 10', () => {
    const triggers: TriggerHit[] = [{ time: 12, weight: 20, phrase: 'x', tier: 1 }];
    expect(spanComposite(10, 20, triggers, audio, 5).composite).toBe(10);
  });
});

describe('detectQaCandidates', () => {
  const segments = [
    seg(0, 8, 11, 'Why did you start running?'),
    seg(1, 13, 25, 'Because I hated who I was becoming, so I changed everything.'),
    seg(2, 26, 30, 'That is powerful.'),
  ];
  it('spans a question + its answer, within the envelope', () => {
    const c = detectQaCandidates(segments, [], audio, lengths, 900);
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c[0].start).toBe(8);
    const dur = c[0].end - c[0].start;
    expect(dur).toBeGreaterThanOrEqual(lengths.min);
    expect(dur).toBeLessThanOrEqual(lengths.max);
  });
  it('skips a question with no following answer', () => {
    const trailing = [seg(0, 890, 895, 'What now?')];
    expect(detectQaCandidates(trailing, [], audio, lengths, 900)).toEqual([]);
  });
});

describe('detectReactionCandidates', () => {
  it('brackets a Tier-1 trigger with setup + tail, within the envelope', () => {
    const triggers: TriggerHit[] = [
      { time: 40, weight: 5, phrase: 'oh my god', tier: 1 },
      { time: 41, weight: 2, phrase: 'wait', tier: 2 },   // tier 2 ignored
    ];
    const segments = [seg(0, 20, 60, 'a long stretch of talking around the moment')];
    const c = detectReactionCandidates(segments, triggers, audio, lengths, 900);
    expect(c).toHaveLength(1);
    expect(c[0].start).toBeLessThan(40);
    expect(c[0].end).toBeGreaterThan(40);
    const dur = c[0].end - c[0].start;
    expect(dur).toBeGreaterThanOrEqual(lengths.min);
    expect(dur).toBeLessThanOrEqual(lengths.max);
  });
});

describe('generateArcTemplateCandidates', () => {
  it('returns both templates combined', () => {
    const segments = [seg(0, 8, 11, 'How did you do it?'), seg(1, 13, 25, 'Hard work every day.')];
    const triggers: TriggerHit[] = [{ time: 40, weight: 5, phrase: 'insane', tier: 1 }];
    const c = generateArcTemplateCandidates(segments, triggers, audio, lengths, 900);
    expect(c.length).toBeGreaterThanOrEqual(2);
  });
});

describe('mergeTemplateCandidates', () => {
  const mk = (start: number, end: number): import('../../src/types/index.js').ClipCandidate =>
    ({ start, end, composite: 5, triggerScore: 0, audioScore: 0 });

  it('drops a template overlapping an existing candidate ≥50%', () => {
    const existing = [mk(10, 40)];
    const templates = [mk(15, 42)]; // heavy overlap with [10,40]
    expect(mergeTemplateCandidates(existing, templates)).toHaveLength(1);
  });
  it('keeps a disjoint template candidate', () => {
    const existing = [mk(10, 40)];
    const templates = [mk(100, 130)];
    expect(mergeTemplateCandidates(existing, templates)).toHaveLength(2);
  });
  it('empty templates → pool unchanged', () => {
    const existing = [mk(10, 40)];
    expect(mergeTemplateCandidates(existing, [])).toEqual(existing);
  });
});
