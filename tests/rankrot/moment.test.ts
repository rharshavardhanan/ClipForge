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

describe('momentWindow (adaptive arcs, 4-12s)', () => {
  it('sources at or under the max are kept whole (they ARE the arc)', () => {
    expect(momentWindow(curve([1, 2, 3]), 6)).toEqual({ start: 0, end: 6 });
    expect(momentWindow(curve([1, 2, 3]), MAX_MOMENT_SEC)).toEqual({ start: 0, end: MAX_MOMENT_SEC });
  });

  it('each clip gets ITS OWN length — a long arc gets more time than an instant', () => {
    const instant = new Array(60).fill(0.05);
    instant[30] = 1; // isolated spike
    const arc = new Array(60).fill(0.05);
    for (let t = 26; t <= 38; t++) arc[t] = 0.8; // sustained action
    arc[30] = 1;
    const wInstant = momentWindow(curve(instant), 60);
    const wArc = momentWindow(curve(arc), 60);
    expect(wArc.end - wArc.start).toBeGreaterThan(wInstant.end - wInstant.start);
    expect(wInstant.end - wInstant.start).toBeGreaterThanOrEqual(MIN_MOMENT_SEC);
    expect(wArc.end - wArc.start).toBeLessThanOrEqual(MAX_MOMENT_SEC);
  });

  it('grows BACKWARD for context: hot build-up before the peak is included', () => {
    const vs = new Array(60).fill(0.05);
    for (let t = 20; t <= 30; t++) vs[t] = 0.7; // build-up (cause)
    vs[30] = 1;                                  // impact
    const w = momentWindow(curve(vs), 60);
    expect(w.start).toBeLessThanOrEqual(24);     // several seconds of context kept
    expect(w.end).toBeGreaterThan(30);           // and the aftermath
  });

  it('tail pad: the window resolves PAST the last hot sample (no mid-action cut)', () => {
    const vs = new Array(60).fill(0.05);
    for (let t = 30; t <= 34; t++) vs[t] = 1;    // action t=30..34
    const w = momentWindow(curve(vs), 60);
    expect(w.end).toBeGreaterThan(34.5);         // ends after the action, not on it
  });

  it('clamps inside the source and respects min/max', () => {
    const nearEnd = new Array(30).fill(0.05);
    nearEnd[29] = 1;
    const w = momentWindow(curve(nearEnd), 30);
    expect(w.end).toBeLessThanOrEqual(30);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.end - w.start).toBeGreaterThanOrEqual(MIN_MOMENT_SEC);
    expect(w.end - w.start).toBeLessThanOrEqual(MAX_MOMENT_SEC);
  });
});
