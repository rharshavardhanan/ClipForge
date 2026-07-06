import { describe, it, expect } from 'vitest';
import { buildCaptionCues, cueViolatesReadingSpeed, DEFAULT_CUE_CONSTRAINTS } from '../../src/captions/captionCues.js';
import type { CaptionWord } from '../../src/types/index.js';

const w = (text: string, start: number, end: number): CaptionWord => ({ text, start, end, emphasized: false });

describe('buildCaptionCues', () => {
  it('packs within maxCharsPerLine and maxLines, never splits a word', () => {
    // 8 words × ~6 chars → with 24 chars/line, 2 lines, ~3 words/line, 6 words/cue
    const words = Array.from({ length: 8 }, (_, i) => w('sixsix', i * 0.5, i * 0.5 + 0.4));
    const cues = buildCaptionCues(words);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(DEFAULT_CUE_CONSTRAINTS.maxLines);
      for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(DEFAULT_CUE_CONSTRAINTS.maxCharsPerLine);
    }
    // every word survives, in order
    expect(cues.flatMap((c) => c.lines.join(' ').split(' ')).length).toBe(8);
  });

  it('extends a too-short cue to minCueSec without overlapping the next', () => {
    const words = [w('hi', 0, 0.1), w('there', 5, 5.3)];
    const cues = buildCaptionCues(words, { ...DEFAULT_CUE_CONSTRAINTS, maxCharsPerLine: 3, maxLines: 1 });
    // "hi" and "there" can't share a 3-char line → separate cues
    expect(cues.length).toBe(2);
    expect(cues[0].end - cues[0].start).toBeGreaterThanOrEqual(DEFAULT_CUE_CONSTRAINTS.minCueSec - 1e-9);
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start + 1e-9);
  });

  it('empty input → no cues', () => {
    expect(buildCaptionCues([])).toEqual([]);
  });
});

describe('cueViolatesReadingSpeed', () => {
  it('flags too many chars for the duration', () => {
    expect(cueViolatesReadingSpeed({ start: 0, end: 1, lines: ['a'.repeat(60)] }, 22)).toBe(true);
    expect(cueViolatesReadingSpeed({ start: 0, end: 1, lines: ['abcdefghij'] }, 22)).toBe(false);
  });
});
