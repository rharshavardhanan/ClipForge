import { describe, it, expect } from 'vitest';
import { planTighten, DEFAULT_TIGHTEN, MIN_KEPT_S } from '../../src/editor/tighten.js';
import type { CaptionWord } from '../../src/types/index.js';

const w = (start: number, end: number, text = 'word'): CaptionWord => ({ text, start, end, emphasized: false });

// A talky 30s clip: words roughly every 0.5s, a 4s silence 10-14, another 0.5s gap at 20.
function talkyWords(): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (let t = 0; t < 30; t += 0.5) {
    if (t >= 10 && t < 14) continue;   // the big silence
    out.push(w(t, t + 0.35));
  }
  return out;
}

describe('planTighten', () => {
  it('removes a long mid-clip silence, keeping breath padding', () => {
    const r = planTighten(30, [{ start: 10, end: 14 }], talkyWords());
    expect(r.removedSec).toBeGreaterThan(3);
    expect(r.removedSec).toBeLessThan(4);            // trimmed by keepBreath on each side
    expect(r.keep.length).toBe(2);
    expect(r.keep[0].start).toBe(0);
    expect(r.keep[1].end).toBe(30);
    // the join point sits inside the former silence, padded off the words
    expect(r.keep[0].end).toBeGreaterThan(10);
    expect(r.keep[1].start).toBeLessThan(14);
  });

  it('never cuts inside the payoff tail', () => {
    // silence at 27-29.5 sits in the last 3s (protected)
    const r = planTighten(30, [{ start: 27, end: 29.5 }], talkyWords());
    expect(r.removedSec).toBe(0);
    expect(r.map.isIdentity).toBe(true);
  });

  it('never cuts inside the hook', () => {
    const r = planTighten(30, [{ start: 0.5, end: 2.8 }], talkyWords());
    expect(r.removedSec).toBe(0);
  });

  it('ignores silences shorter than the threshold', () => {
    const r = planTighten(30, [{ start: 15, end: 15.4 }], talkyWords());
    expect(r.removedSec).toBe(0);
  });

  it('removes a silence-flanked filler word', () => {
    // words with a clear gap around a filler "um" at 16.0-16.4 (prev ends 15.5, next starts 17.0)
    const words = [w(14.8, 15.5, 'point'), w(16.0, 16.4, 'um'), w(17.0, 17.6, 'anyway'), w(18.0, 28, 'content')];
    const r = planTighten(30, [], words);
    expect(r.removedSec).toBeGreaterThan(0);         // the flanked filler is removed
  });

  it('falls back to identity when tightening would drop below MIN_KEPT_S', () => {
    // a 10s clip that is almost all silence
    const r = planTighten(10, [{ start: 1, end: 9 }], [w(0, 1, 'hi'), w(9, 10, 'bye')]);
    expect(r.map.isIdentity).toBe(true);
    expect(r.keep).toEqual([{ start: 0, end: 10 }]);
  });

  it('falls back to identity when the net gain is negligible', () => {
    const r = planTighten(30, [{ start: 15, end: 15.6 }], talkyWords(), DEFAULT_TIGHTEN);
    expect(r.map.isIdentity).toBe(true);
  });

  it('kept total is never below MIN_KEPT_S when it tightens', () => {
    const r = planTighten(30, [{ start: 10, end: 14 }], talkyWords());
    if (!r.map.isIdentity) expect(r.map.totalOut).toBeGreaterThanOrEqual(MIN_KEPT_S);
  });
});
