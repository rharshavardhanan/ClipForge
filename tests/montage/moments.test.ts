import { describe, expect, it } from 'vitest';
import { detectCycles, pickMomentWindows } from '../../src/montage/moments.js';

const curve = (vs: number[], dt: number) => vs.map((v, i) => ({ time: i * dt, v }));

describe('detectCycles', () => {
  it('finds periodic peaks (reps at ~1.25s period)', () => {
    // 8 Hz motion curve, peak every 10 samples: v=10 on the beat, 1 elsewhere
    const vs = Array.from({ length: 80 }, (_, i) => (i % 10 === 5 ? 10 : 1));
    const cycles = detectCycles(curve(vs, 1 / 8));
    expect(cycles.length).toBeGreaterThanOrEqual(4);
    const gaps = cycles.slice(1).map((t, i) => t - cycles[i]);
    for (const g of gaps) expect(g).toBeCloseTo(1.25, 1);
  });
  it('irregular motion → no cycles', () => {
    const vs = [1, 9, 1, 1, 1, 1, 1, 8, 1, 10, 1, 1, 1, 1, 1, 1, 1, 1, 9, 1];
    expect(detectCycles(curve(vs, 1 / 8))).toEqual([]);
  });
});

describe('pickMomentWindows', () => {
  it('picks the highest-motion windows without overlap', () => {
    // 60s video: hot at 10-14s and 40-44s
    const vs = Array.from({ length: 480 }, (_, i) => {
      const t = i / 8;
      return (t >= 10 && t < 14) || (t >= 40 && t < 44) ? 9 : 1;
    });
    const wins = pickMomentWindows(curve(vs, 1 / 8), curve(Array(120).fill(5), 0.5), [], 60, 2);
    expect(wins).toHaveLength(2);
    const hits = wins.map((w) => (w.start < 14 && w.end > 10) || (w.start < 44 && w.end > 40));
    expect(hits.every(Boolean)).toBe(true);
  });
  it('snaps to scene-cut boundaries when the hot region is a shot', () => {
    // hot exactly between the cuts at 10s and 14s → the cut-derived candidate wins the tie
    const vs = Array.from({ length: 240 }, (_, i) => (i / 8 >= 10 && i / 8 < 14 ? 9 : 1));
    const wins = pickMomentWindows(curve(vs, 1 / 8), curve(Array(60).fill(5), 0.5), [10, 14], 30, 1);
    expect(wins[0].start).toBeCloseTo(10, 5);
    expect(wins[0].end).toBeCloseTo(14, 5);
  });
});
