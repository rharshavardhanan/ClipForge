import { describe, expect, it } from 'vitest';
import { keyframeTimes, peakTime } from '../../src/analysis/keyframes.js';

describe('peakTime', () => {
  it('max within span; null when empty', () => {
    const pts = [{ time: 1, v: 1 }, { time: 5, v: 9 }, { time: 9, v: 2 }];
    expect(peakTime(pts, { start: 0, end: 10 })).toBe(5);
    expect(peakTime(pts, { start: 6, end: 10 })).toBe(9);
    expect(peakTime([], { start: 0, end: 10 })).toBeNull();
  });
});

describe('keyframeTimes', () => {
  it('4-6 sorted unique times inside the span', () => {
    const times = keyframeTimes({ start: 10, end: 30 }, 18, 26);
    expect(times.length).toBeGreaterThanOrEqual(4);
    expect(times.length).toBeLessThanOrEqual(6);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const t of times) { expect(t).toBeGreaterThanOrEqual(10); expect(t).toBeLessThanOrEqual(30); }
  });
  it('dedupes near-identical times (peak == midpoint) and still returns >=4', () => {
    const times = keyframeTimes({ start: 0, end: 20 }, 10, 10.2);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(0.75);
    expect(times.length).toBeGreaterThanOrEqual(4);
  });
  it('null peaks → still 4 structural frames', () => {
    expect(keyframeTimes({ start: 0, end: 12 }, null, null).length).toBeGreaterThanOrEqual(4);
  });
});
