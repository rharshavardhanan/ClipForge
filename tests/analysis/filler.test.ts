import { describe, it, expect } from 'vitest';
import { isFillerWord, fillerRatio, FILLER_LEXICON } from '../../src/analysis/filler.js';

describe('isFillerWord', () => {
  it('matches fillers regardless of case/punctuation', () => {
    expect(isFillerWord('Um,')).toBe(true);
    expect(isFillerWord('LIKE')).toBe(true);
    expect(isFillerWord('important')).toBe(false);
  });
  it('lexicon holds the common single-word fillers', () => {
    for (const w of ['um', 'uh', 'like', 'basically', 'literally']) expect(FILLER_LEXICON.has(w)).toBe(true);
  });
});

describe('fillerRatio', () => {
  it('counts single-word fillers', () => {
    expect(fillerRatio('um so like the point')).toBeCloseTo(3 / 5);
  });
  it('counts 2-gram phrase fillers', () => {
    // "you know" + "i mean" → 4 filler tokens of 5 total ("what" is content)
    expect(fillerRatio('you know what i mean')).toBeCloseTo(4 / 5);
  });
  it('empty text → 0', () => {
    expect(fillerRatio('')).toBe(0);
    expect(fillerRatio('   ')).toBe(0);
  });
  it('content-heavy text → low ratio', () => {
    expect(fillerRatio('the discipline required to win is enormous')).toBe(0);
  });
});
