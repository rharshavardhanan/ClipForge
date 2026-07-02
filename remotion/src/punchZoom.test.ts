import { describe, it, expect } from 'vitest';
import { buildZoomEvents, punchScaleAt } from './punchZoom';
import type { CaptionWord } from './captionLogic';

const w = (start: number, emphasized: boolean): CaptionWord => ({
  text: 'x', start, end: start + 0.3, emphasized,
});

describe('buildZoomEvents', () => {
  it('keeps emphasized word starts spaced >= 2.5s, never within the first second', () => {
    const words = [w(0.5, true), w(2, true), w(3, true), w(5, true), w(9, true), w(9.5, false)];
    expect(buildZoomEvents(words)).toEqual([2, 5, 9]);
  });

  it('caps at maxEvents', () => {
    const words = Array.from({ length: 20 }, (_, i) => w(2 + i * 3, true));
    expect(buildZoomEvents(words)).toHaveLength(4);
    expect(buildZoomEvents(words, { maxEvents: 2 })).toHaveLength(2);
  });

  it('returns [] when nothing is emphasized', () => {
    expect(buildZoomEvents([w(2, false), w(5, false)])).toEqual([]);
  });
});

describe('punchScaleAt', () => {
  it('is 1 outside any event window', () => {
    expect(punchScaleAt([10], 9.99)).toBe(1);
    expect(punchScaleAt([10], 11)).toBe(1);
    expect(punchScaleAt([], 5)).toBe(1);
  });

  it('ramps to 1.08 over 0.12s, holds, then eases back to 1 by +0.9s', () => {
    expect(punchScaleAt([10], 10.06)).toBeCloseTo(1.04, 5);  // mid-ramp
    expect(punchScaleAt([10], 10.12)).toBeCloseTo(1.08, 5);  // peak
    expect(punchScaleAt([10], 10.3)).toBeCloseTo(1.08, 5);   // hold
    expect(punchScaleAt([10], 10.7)).toBeCloseTo(1.04, 5);   // mid-release
    expect(punchScaleAt([10], 10.9)).toBeCloseTo(1, 5);      // done
  });
});

describe('zoom intensity (v6 modes)', () => {
  it('scales the punch amplitude without changing timing', () => {
    const events = [2];
    const full = punchScaleAt(events, 2.2, 1);      // in the hold window → full peak
    const subtle = punchScaleAt(events, 2.2, 0.5);
    expect(full).toBeCloseTo(1.08);
    expect(subtle).toBeCloseTo(1.04);
    expect(punchScaleAt(events, 1.9, 0.5)).toBe(1); // before event: unchanged
    expect(punchScaleAt(events, 3.5, 0.5)).toBe(1); // after release: unchanged
  });
});
