import { describe, it, expect } from 'vitest';
import { TICK, visualEvents, simulate } from '../../src/avss/simulator.js';
import type { EditPlan, SourceSignals } from '../../src/avss/editPlan.js';
import type { CaptionWord, SemanticScores } from '../../src/types/index.js';

const w = (start: number, emphasized = false): CaptionWord =>
  ({ text: 'word', start, end: start + 0.3, emphasized });

const zeroScores: SemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};

function plan(over: Partial<EditPlan> = {}): EditPlan {
  return {
    hookText: 'wait for it', hookSource: 'moment', captionPreset: 'mrbeast',
    zoom: { enabled: true, times: [3, 7, 11, 15], intensity: 1 },
    sfx: { enabled: true, volume: 0.6 },
    brollWindows: [], musicOn: false,
    ...over,
  };
}

function signals(over: Partial<SourceSignals> = {}): SourceSignals {
  const words: CaptionWord[] = [];
  for (let t = 0.4; t < 20; t += 0.4) words.push(w(t, Math.abs(t % 4) < 0.3));
  return {
    durationSec: 20,
    words,
    rms: Array.from({ length: 21 }, (_, i) => ({ time: i, rms: 5 })),
    silences: [],
    semantic: { ...zeroScores, emotional_intensity: 0.6, humor: 0.4 },
    ...over,
  };
}

const mean = (pts: { v: number }[]) => pts.reduce((a, p) => a + p.v, 0) / pts.length;

describe('visualEvents', () => {
  it('collects hook start, zooms, broll edges and emphasized word starts, sorted', () => {
    const p = plan({ brollWindows: [{ atSec: 5, durationSec: 2 }] });
    const ev = visualEvents(p);
    expect(ev[0]).toBe(0);
    expect(ev).toContain(3);
    expect(ev).toContain(5);
    expect(ev).toContain(7);   // broll end 5+2 collides with zoom 7
    const sorted = [...ev].sort((a, b) => a - b);
    expect(ev).toEqual(sorted);
  });
});

describe('simulate', () => {
  it('more visual events → higher mean attention', () => {
    const s = signals();
    const withZooms = simulate(plan(), s);
    const without = simulate(plan({ zoom: { enabled: false, times: [], intensity: 1 } }), s);
    expect(mean(withZooms.attention)).toBeGreaterThan(mean(without.attention));
  });

  it('dead air → higher mean hazard', () => {
    const quiet = signals({ silences: [{ start: 8, end: 13 }], words: [w(1, true)] });
    const lively = signals({ words: [w(1, true)] });
    const p = plan({ zoom: { enabled: false, times: [], intensity: 1 } });
    expect(mean(simulate(p, quiet).hazard)).toBeGreaterThan(mean(simulate(p, lively).hazard));
  });

  it('retention is non-increasing and completion equals the last point', () => {
    const r = simulate(plan(), signals());
    for (let i = 1; i < r.retention.length; i++) {
      expect(r.retention[i].v).toBeLessThanOrEqual(r.retention[i - 1].v + 1e-12);
    }
    expect(r.completion).toBeCloseTo(r.retention[r.retention.length - 1].v, 12);
    expect(r.avgRetention).toBeGreaterThan(0);
    expect(r.avgRetention).toBeLessThanOrEqual(1);
  });

  it('a hook lowers early hazard', () => {
    const s = signals();
    const hooked = simulate(plan(), s);
    const bare = simulate(plan({ hookText: undefined, hookSource: 'none' }), s);
    const early = (h: { t: number; v: number }[]) => h.filter((p) => p.t < 3);
    expect(mean(early(hooked.hazard))).toBeLessThan(mean(early(bare.hazard)));
  });

  it('high humor+surprise raises rewatch', () => {
    const dull = simulate(plan(), signals({ semantic: { ...zeroScores } }));
    const wild = simulate(plan(), signals({ semantic: { ...zeroScores, humor: 0.9, surprise: 0.9 } }));
    expect(wild.rewatch).toBeGreaterThan(dull.rewatch);
    expect(wild.rewatchFactors.surpriseHumor).toBeGreaterThan(0);
  });

  it('overall is within [0,1]', () => {
    const r = simulate(plan(), signals());
    expect(r.overall).toBeGreaterThanOrEqual(0);
    expect(r.overall).toBeLessThanOrEqual(1);
  });

  it('dopamine events are merged (≥1s apart) and capped at 8', () => {
    const loud = signals({
      rms: Array.from({ length: 21 }, (_, i) => ({ time: i, rms: 9 })),
      semantic: { ...zeroScores, humor: 0.9, surprise: 0.9 },
    });
    const r = simulate(plan(), loud);
    expect(r.dopamine.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < r.dopamine.length; i++) {
      expect(r.dopamine[i].t - r.dopamine[i - 1].t).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('curves share the 0.5s tick and cover the duration', () => {
    const r = simulate(plan(), signals());
    expect(r.attention.length).toBe(r.hazard.length);
    expect(r.attention[1].t - r.attention[0].t).toBeCloseTo(TICK);
    expect(r.attention[r.attention.length - 1].t).toBeGreaterThanOrEqual(20 - TICK);
  });

  it('reports top-3 dropoff times at hazard maxima', () => {
    const r = simulate(plan({ zoom: { enabled: false, times: [], intensity: 1 } }),
      signals({ silences: [{ start: 10, end: 14 }] }));
    expect(r.dropoffs.length).toBeLessThanOrEqual(3);
    for (const t of r.dropoffs) expect(t).toBeGreaterThanOrEqual(0);
  });

  it('real reaction events become dopamine events (laughter→humor, applause→reward)', () => {
    const s = signals({
      reactionEvents: [
        { t: 8, kind: 'laughter', score: 0.9 },
        { t: 15, kind: 'applause', score: 0.7 },
      ],
    });
    const r = simulate(plan(), s);
    expect(r.dopamine.some((e) => e.kind === 'humor' && Math.abs(e.t - 8) < 1)).toBe(true);
    expect(r.dopamine.some((e) => e.kind === 'reward' && Math.abs(e.t - 15) < 1)).toBe(true);
  });

  it('absent reactionEvents leaves the simulation unchanged', () => {
    const s = signals();
    expect(simulate(plan(), s)).toEqual(simulate(plan(), { ...s, reactionEvents: undefined }));
  });

  it('importance lifts attention inside high-importance spans and is identity when absent', () => {
    const hot = { ...signals(), importance: Array.from({ length: 60 }, (_, t) => ({ t, v: 1 })) };
    const cold = { ...signals(), importance: Array.from({ length: 60 }, (_, t) => ({ t, v: 0 })) };
    const simHot = simulate(plan(), hot);
    const simCold = simulate(plan(), cold);
    const meanA = (s: { attention: { v: number }[] }) => s.attention.reduce((a, p) => a + p.v, 0) / s.attention.length;
    expect(meanA(simHot)).toBeGreaterThan(meanA(simCold));
    // identity
    expect(simulate(plan(), signals())).toEqual(simulate(plan(), { ...signals(), importance: undefined }));
  });
});
