import { describe, it, expect } from 'vitest';
import { CAPS, regulate } from '../../src/avss/regulator.js';
import type { EditPlan } from '../../src/avss/editPlan.js';

function plan(over: Partial<EditPlan> = {}): EditPlan {
  return {
    hookText: 'wait for it', hookSource: 'moment', captionPreset: 'mrbeast',
    zoom: { enabled: true, times: [3, 7], intensity: 1 },
    sfx: { enabled: true, volume: 0.6 },
    brollWindows: [], musicOn: false,
    ...over,
  };
}

describe('regulate', () => {
  it('returns a compliant plan unchanged with no violations', () => {
    const p = plan();
    const r = regulate(p, 20);
    expect(r.violations).toEqual([]);
    expect(r.plan).toEqual(p);
  });

  it('enforces min zoom gap and per-10s density on a 15s clip', () => {
    const p = plan({ zoom: { enabled: true, times: [1, 2, 3.6, 6.2, 8.8, 11.4], intensity: 1 } });
    const r = regulate(p, 15);
    const t = r.plan.zoom.times;
    expect(t.length).toBeLessThanOrEqual(Math.ceil((15 / 10) * CAPS.zoomsPer10s)); // ≤3
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(CAPS.minZoomGapSec);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it('clamps zoom intensity into range', () => {
    expect(regulate(plan({ zoom: { enabled: true, times: [3], intensity: 2 } }), 20).plan.zoom.intensity)
      .toBe(CAPS.zoomIntensityMax);
    expect(regulate(plan({ zoom: { enabled: true, times: [3], intensity: 0.1 } }), 20).plan.zoom.intensity)
      .toBe(CAPS.zoomIntensityMin);
  });

  it('re-truncates an over-long hook', () => {
    const r = regulate(plan({ hookText: 'one two three four five six seven eight nine ten eleven twelve' }), 20);
    expect(r.plan.hookText).toBe('one two three four five six seven…');
    expect(r.violations.some((v) => v.includes('hook'))).toBe(true);
  });

  it('trims trailing broll windows above 40% coverage', () => {
    const p = plan({ brollWindows: [
      { atSec: 2, durationSec: 6 }, { atSec: 10, durationSec: 6 }, { atSec: 20, durationSec: 6 },
    ] });
    const r = regulate(p, 30); // 18s of 30s = 60% coverage
    const covered = r.plan.brollWindows.reduce((a, b) => a + b.durationSec, 0);
    expect(covered).toBeLessThanOrEqual(30 * CAPS.maxBrollCoverage);
    expect(r.plan.brollWindows[0]).toEqual({ atSec: 2, durationSec: 6 }); // earlier windows kept
    expect(r.violations.some((v) => v.includes('b-roll'))).toBe(true);
  });

  it('never throws on a degenerate plan', () => {
    const r = regulate(plan({ zoom: { enabled: true, times: [], intensity: NaN } }), 0.5);
    expect(r.plan.zoom.intensity).toBeGreaterThanOrEqual(CAPS.zoomIntensityMin);
  });
});
