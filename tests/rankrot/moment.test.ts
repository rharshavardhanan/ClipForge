import { describe, it, expect } from 'vitest';
import { normalizeCurve, fuseCurves, momentWindow, MIN_MOMENT_SEC, MAX_MOMENT_SEC } from '../../src/rankrot/moment.js';
import { parseYdif, percentile, curveAt } from '../../src/rankrot/signals.js';

const curve = (vs: number[], dt = 1) => vs.map((v, i) => ({ time: i * dt, v }));

describe('signals parsers/helpers', () => {
  it('parseYdif reads signalstats metadata lines onto the fps timeline', () => {
    const stderr = 'lavfi.signalstats.YDIF=1.5\nnoise\nlavfi.signalstats.YDIF=20.25\n';
    expect(parseYdif(stderr, 8)).toEqual([{ time: 0, v: 1.5 }, { time: 0.125, v: 20.25 }]);
  });
  it('percentile and curveAt behave on edges', () => {
    const c = curve([1, 5, 9]);
    expect(percentile(c, 50)).toBe(5);
    expect(percentile([], 95)).toBe(0);
    expect(curveAt(c, 1.4)).toBe(5);
  });
});

describe('normalizeCurve / fuseCurves', () => {
  it('normalizes to 0..1, flat → 0.5', () => {
    expect(normalizeCurve(curve([2, 4, 6])).map((p) => p.v)).toEqual([0, 0.5, 1]);
    expect(normalizeCurve(curve([3, 3])).map((p) => p.v)).toEqual([0.5, 0.5]);
  });
  it('fuses on the motion timeline, 60/40 weighted', () => {
    const fused = fuseCurves(curve([0, 10]), curve([10, 0]));
    expect(fused[0].v).toBeCloseTo(0.4);
    expect(fused[1].v).toBeCloseTo(0.6);
  });
});

describe('momentWindow', () => {
  it('short sources are kept whole', () => {
    expect(momentWindow(curve([1, 2, 3]), 6)).toEqual({ start: 0, end: 6 });
  });
  it('window brackets the fused peak with pre-roll, inside the clip', () => {
    const vs = new Array(60).fill(0.1);
    vs[40] = 1; // peak at t=40 of a 60s clip
    const w = momentWindow(curve(vs), 60);
    expect(w.start).toBeLessThan(40);
    expect(w.end).toBeGreaterThan(40);
    expect(w.end - w.start).toBeGreaterThanOrEqual(MIN_MOMENT_SEC);
    expect(w.end - w.start).toBeLessThanOrEqual(MAX_MOMENT_SEC);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.end).toBeLessThanOrEqual(60);
  });
  it('sustained heat after the peak extends the window toward 8s', () => {
    const hot = new Array(60).fill(0.1);
    for (let t = 30; t < 45; t++) hot[t] = 1; // long hot plateau
    const spike = new Array(60).fill(0.1);
    spike[30] = 1; // single instant
    const wHot = momentWindow(curve(hot), 60);
    const wSpike = momentWindow(curve(spike), 60);
    expect(wHot.end - wHot.start).toBeGreaterThan(wSpike.end - wSpike.start);
  });
  it('peak near the clip end clamps the window inside the clip', () => {
    const vs = new Array(30).fill(0.1);
    vs[29] = 1;
    const w = momentWindow(curve(vs), 30);
    expect(w.end).toBeLessThanOrEqual(30);
    expect(w.start).toBeGreaterThanOrEqual(0);
  });
});
