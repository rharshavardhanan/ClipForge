import { describe, it, expect } from 'vitest';
import {
  buildTimeMap, identityTimeMap, srcToOut, isKept, mapWords, mapTimes, mapRms,
} from '../../src/editor/timeMap.js';
import type { CaptionWord, RmsPoint } from '../../src/types/index.js';

const w = (start: number, end: number): CaptionWord => ({ text: 'x', start, end, emphasized: false });

describe('identityTimeMap', () => {
  it('maps every time to itself, keeps all words', () => {
    const m = identityTimeMap(30);
    expect(m.isIdentity).toBe(true);
    expect(m.totalOut).toBe(30);
    expect(srcToOut(m, 12.5)).toBe(12.5);
    const words = [w(1, 2), w(5, 6)];
    expect(mapWords(m, words)).toEqual(words);
  });
});

describe('buildTimeMap (two kept segments, gap 5-8 removed)', () => {
  const m = buildTimeMap([{ start: 0, end: 5 }, { start: 8, end: 12 }]); // totalOut 9

  it('totalOut = sum of kept durations', () => {
    expect(m.totalOut).toBe(9);
    expect(m.isIdentity).toBe(false);
  });
  it('srcToOut within kept segments', () => {
    expect(srcToOut(m, 3)).toBe(3);
    expect(srcToOut(m, 10)).toBe(7);   // 5 kept + (10-8)
  });
  it('srcToOut in a removed gap collapses to the next kept start', () => {
    expect(srcToOut(m, 6)).toBe(5);
  });
  it('srcToOut past the end clamps to totalOut', () => {
    expect(srcToOut(m, 99)).toBe(9);
  });
  it('isKept true inside segments, false in the gap', () => {
    expect(isKept(m, 3)).toBe(true);
    expect(isKept(m, 6)).toBe(false);
    expect(isKept(m, 10)).toBe(true);
  });
  it('mapWords drops words centered in a removed gap, shifts kept ones', () => {
    const words = [w(1, 2), w(6, 7), w(9, 10)]; // middle word centered at 6.5 (removed)
    const out = mapWords(m, words);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(w(1, 2));
    expect(out[1]).toEqual({ text: 'x', start: 6, end: 7, emphasized: false }); // 9-8+5=6, 10-8+5=7
  });
  it('mapTimes drops removed times', () => {
    expect(mapTimes(m, [3, 6, 10])).toEqual([3, 7]);
  });
  it('mapRms drops removed points and shifts kept', () => {
    const rms: RmsPoint[] = [{ time: 2, rms: 5 }, { time: 6, rms: 3 }, { time: 10, rms: 8 }];
    expect(mapRms(m, rms)).toEqual([{ time: 2, rms: 5 }, { time: 7, rms: 8 }]);
  });
});

describe('srcToOut properties', () => {
  it('is non-decreasing over a random sorted sample', () => {
    const m = buildTimeMap([{ start: 0, end: 4 }, { start: 7, end: 9 }, { start: 15, end: 20 }]);
    let prev = -Infinity;
    for (let t = 0; t <= 22; t += 0.37) {
      const o = srcToOut(m, t);
      expect(o).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = o;
    }
  });
  it('totalOut equals summed kept durations for arbitrary segments', () => {
    const keep = [{ start: 1, end: 4 }, { start: 6, end: 6.5 }, { start: 10, end: 18 }];
    const expected = 3 + 0.5 + 8;
    expect(buildTimeMap(keep).totalOut).toBeCloseTo(expected);
  });
});
