import { describe, it, expect } from 'vitest';
import { buildCaptionWords } from '../../src/captions/captionWords.js';

describe('buildCaptionWords', () => {
  it('rebases timing to clip start and flags emphasis from trigger phrases', () => {
    const words = [
      { start: 10, end: 10.3, word: 'the', probability: 1 },
      { start: 10.3, end: 10.6, word: 'truth', probability: 1 },
      { start: 10.6, end: 10.9, word: 'is', probability: 1 },
      { start: 10.9, end: 11.2, word: 'simple', probability: 1 },
    ];
    const cw = buildCaptionWords(words, 10, ['the truth is']);
    expect(cw[0].start).toBeCloseTo(0);
    expect(cw[0].emphasized).toBe(true);   // part of 'the truth is'
    expect(cw[1].emphasized).toBe(true);   // 'truth'
    expect(cw[2].emphasized).toBe(true);   // 'is'
    expect(cw[3].emphasized).toBe(false);  // 'simple' not in phrase
  });
});
