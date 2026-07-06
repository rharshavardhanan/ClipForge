import { describe, it, expect } from 'vitest';
import { clipRelativeSilences } from '../../src/cli/commands/all.js';

describe('clipRelativeSilences', () => {
  it('re-offsets silences into clip-relative time', () => {
    expect(clipRelativeSilences([{ start: 12, end: 16 }], 10, 40)).toEqual([{ start: 2, end: 6 }]);
  });
  it('drops silences fully outside the clip', () => {
    expect(clipRelativeSilences([{ start: 100, end: 110 }], 10, 40)).toEqual([]);
  });
  it('clamps a silence straddling the clip start to 0', () => {
    expect(clipRelativeSilences([{ start: 8, end: 13 }], 10, 40)).toEqual([{ start: 0, end: 3 }]);
  });
  it('clamps a silence straddling the clip end', () => {
    expect(clipRelativeSilences([{ start: 38, end: 45 }], 10, 40)).toEqual([{ start: 28, end: 30 }]);
  });
});
