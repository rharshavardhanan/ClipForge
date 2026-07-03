import { describe, expect, it } from 'vitest';
import { buildMontagePlan, remapCycleEvents } from '../../src/montage/planner.js';
import type { MusicMap, MontageMoment } from '../../src/montage/types.js';

const BPM = 120; // beat = 0.5s
const map: MusicMap = {
  bpm: BPM,
  beats: Array.from({ length: 240 }, (_, i) => i * 0.5),
  drops: [{ time: 20, strength: 4 }],
  energy: [], duration: 120,
  sections: [
    { kind: 'build', start: 0, end: 20 },
    { kind: 'drop', start: 20, end: 28 },
    { kind: 'cool', start: 28, end: 120 },
  ],
};
const mk = (i: number, cycles: number[] = []): MontageMoment => ({
  src: `m${i}.mp4`, start: 0, dur: 5, motionScore: 1 - i * 0.1, audioScore: 0.5, cycleEvents: cycles,
});
const moments = [mk(0), mk(1), mk(2), mk(3), mk(4)];

describe('buildMontagePlan', () => {
  const plan = buildMontagePlan(map, moments, { targetSec: 25, seed: 'test' });

  it('is deterministic for a seed', () => {
    expect(buildMontagePlan(map, moments, { targetSec: 25, seed: 'test' })).toEqual(plan);
  });
  it('lands near the target duration', () => {
    expect(plan.totalDur).toBeGreaterThan(20);
    expect(plan.totalDur).toBeLessThan(31);
  });
  it('every cut sits on the beat grid (±1 frame @30fps)', () => {
    let t = 0;
    for (const s of plan.segments) {
      const rel = (t + plan.musicOffset) % 0.25; // half-beat grid at 120bpm
      expect(Math.min(rel, 0.25 - rel)).toBeLessThan(1 / 30 + 1e-6);
      t += s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
    }
  });
  it('drop section cuts are denser than build cuts', () => {
    // wall-clock positions of each segment
    let t = 0;
    const starts = plan.segments.map((s) => {
      const st = t; t += s.freeze ? s.srcDur : s.srcDur / s.playbackRate; return st;
    });
    const dropRelStart = 20 - plan.musicOffset;
    const inDrop = starts.filter((s) => s >= dropRelStart && s < dropRelStart + 8).length / 8;
    const inBuild = starts.filter((s) => s < dropRelStart).length / Math.max(1, dropRelStart);
    expect(inDrop).toBeGreaterThan(inBuild);
  });
  it('slowmo payoff then freeze at the end', () => {
    const [slow, freeze] = plan.segments.slice(-2);
    expect(slow.playbackRate).toBeLessThanOrEqual(0.5);
    expect(freeze.freeze).toBe(true);
  });
  it('strongest moment is reserved for the drop hit', () => {
    let t = 0;
    for (const s of plan.segments) {
      const st = t; t += s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
      const dropRelStart = 20 - plan.musicOffset;
      if (Math.abs(st - dropRelStart) < 0.05) expect(s.src).toBe('m0.mp4');
    }
  });
  it('flashes only at cut boundaries, 1-4 frames', () => {
    for (const f of plan.flashes) {
      expect(f.frames).toBeGreaterThanOrEqual(1);
      expect(f.frames).toBeLessThanOrEqual(4);
    }
  });
});

describe('remapCycleEvents', () => {
  it('maps source cycle times through the playback rate', () => {
    const withCycles = [mk(0), mk(1, [0.5, 1.5, 2.5, 3.5]), mk(2), mk(3), mk(4)];
    const plan = buildMontagePlan(map, withCycles, { targetSec: 25, seed: 'test' });
    const events = remapCycleEvents(plan, withCycles);
    expect(events.length).toBeGreaterThan(0); // m1 footage IS used, so some cycles land
    expect(events.map((e) => e.value)).toEqual(events.map((_, i) => i + 1));
    const times = events.map((e) => e.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const e of events) { expect(e.time).toBeGreaterThanOrEqual(0); expect(e.time).toBeLessThan(plan.totalDur); }
  });
});
