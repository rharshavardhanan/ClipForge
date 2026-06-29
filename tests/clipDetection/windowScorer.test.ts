import { describe, it, expect } from 'vitest';
import { scoreWindows } from '../../src/clipDetection/windowScorer.js';
import type { AudioEnergyLayer } from '../../src/types/index.js';

const audio: AudioEnergyLayer = {
  rms_curve: Array.from({ length: 60 }, (_, t) => ({ time: t, rms: 5 })),
  silence_regions: [],
};

describe('scoreWindows', () => {
  it('emits 30s windows stepping by 15s', () => {
    const w = scoreWindows(60, [], audio);
    expect(w).toHaveLength(4);            // starts 0,15,30,45 for duration 60
    expect(w[0].start).toBe(0); expect(w[0].end).toBe(30);
    expect(w[1].start).toBe(15);
    expect(w[2].start).toBe(30);
    expect(w[3].start).toBe(45);
    expect(w[3].end).toBe(60);            // tail window clamped to duration
  });
  it('applies the 0.6/0.4 composite and caps trigger score at 10', () => {
    const triggers = [{ time: 5, weight: 9, phrase: 'x', tier: 1 as const }, { time: 6, weight: 9, phrase: 'y', tier: 1 as const }];
    const w = scoreWindows(60, triggers, audio);
    expect(w[0].triggerScore).toBe(10);      // 18 capped to 10
    expect(w[0].audioScore).toBeCloseTo(5);
    expect(w[0].composite).toBeCloseTo(10 * 0.6 + 5 * 0.4);
  });
});
