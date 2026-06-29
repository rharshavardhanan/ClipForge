import { describe, it, expect } from 'vitest';
import { detectTriggers } from '../../src/analysis/transcriptTriggers.js';
import type { TranscriptSegment } from '../../src/types/index.js';

const seg = (id: number, start: number, text: string): TranscriptSegment =>
  ({ id, start, end: start + 3, text, words: [] });

describe('detectTriggers', () => {
  it('fires tier-1 with weight 2.5 at the segment time', () => {
    const hits = detectTriggers([seg(0, 12, "Here's the thing, nobody tells you this.")]);
    const t1 = hits.find((h) => h.tier === 1);
    expect(t1?.weight).toBe(2.5);
    expect(t1?.time).toBe(12);
  });
  it('fires tier-2 (1.5) and tier-3 (0.5)', () => {
    const hits = detectTriggers([seg(0, 0, 'Let me explain. Fun fact about this.')]);
    expect(hits.some((h) => h.tier === 2 && h.weight === 1.5)).toBe(true);
    expect(hits.some((h) => h.tier === 3 && h.weight === 0.5)).toBe(true);
  });
  it('detects structural number-statements and contrast (1.0)', () => {
    const hits = detectTriggers([seg(0, 0, 'There are 3 reasons, but the truth is simple.')]);
    expect(hits.some((h) => h.phrase === 'number-statement' && h.weight === 1.0)).toBe(true);
    expect(hits.some((h) => h.phrase === 'contrast' && h.weight === 1.0)).toBe(true);
  });
  it('does not match a trigger embedded inside a larger word', () => {
    const hits = detectTriggers([seg(0, 0, 'I had to await the waiter.')]);
    expect(hits.some((h) => h.phrase === 'wait')).toBe(false);
  });
  it('detects six/eight/nine number-statements', () => {
    const hits = detectTriggers([seg(0, 0, 'There are six steps to nine rules.')]);
    expect(hits.some((h) => h.phrase === 'number-statement' && h.tier === 'structural')).toBe(true);
  });
});
