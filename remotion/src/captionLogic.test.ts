import { describe, it, expect } from 'vitest';
import { groupIntoLines, findActiveIndex } from './captionLogic.js';

const words = [
  { text: 'a', start: 0, end: 0.5, emphasized: false },
  { text: 'b', start: 0.5, end: 1, emphasized: false },
  { text: 'c', start: 1, end: 1.5, emphasized: false },
  { text: 'd', start: 1.5, end: 2, emphasized: false },
  { text: 'e', start: 2, end: 2.5, emphasized: false },
];

describe('captionLogic', () => {
  it('groups into lines of <=4 words', () => {
    const lines = groupIntoLines(words, 4);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(4);
  });
  it('finds the active word with 50ms lead', () => {
    expect(findActiveIndex(words, 0.4, 50)).toBe(0);
    expect(findActiveIndex(words, 0.46, 50)).toBe(1); // 0.46+0.05=0.51 -> word b
    expect(findActiveIndex(words, 99, 50)).toBe(-1);
  });
});
