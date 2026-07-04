import { describe, expect, it } from 'vitest';
import { buildMontagePlan, cutTimes, mulberry32, remapCycleEvents } from '../../src/montage/planner.js';
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
    // NOTE: this fixture's drop (t=20) happens to sit exactly on the 0.5s beat grid, so it
    // passes even under the old float `Math.abs(cut.time - dropRel) < 1e-3` compare — see the
    // "non-beat-aligned drop" test below (BUG I-2) for the case that actually exercises real
    // (non-grid-aligned) drop timestamps from musicMap.detectDrops.
    let t = 0;
    for (const s of plan.segments) {
      const st = t; t += s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
      const dropRelStart = 20 - plan.musicOffset;
      if (Math.abs(st - dropRelStart) < 0.05) expect(s.src).toBe('m0.mp4');
    }
  });
  it('strongest moment lands ON a non-beat-aligned drop, not only in the payoff (BUG I-2)', () => {
    // Real drops from musicMap.detectDrops are NOT snapped to the beat grid. Move the drop
    // off-grid (20.3s, vs. a 0.5s beat grid) — the reserved moment (m0.mp4, highest
    // motion+audio score) must still land on a cut inside the main drop section, not only in
    // the trailing payoff (which always carries the reserved src unconditionally, so its mere
    // presence there proves nothing). `pool` explicitly excludes byScore[0] (m0.mp4) from
    // ordinary rotation, so ANY m0.mp4 segment outside the last two payoff segments can only
    // exist because a cut was flagged as the drop hit.
    const offGridMap: MusicMap = { ...map, drops: [{ time: 20.3, strength: 4 }] };
    const offGridPlan = buildMontagePlan(offGridMap, moments, { targetSec: 25, seed: 'test' });
    const mainCutSegments = offGridPlan.segments.slice(0, -2); // exclude slowmo + freeze payoff
    expect(mainCutSegments.some((s) => s.src === 'm0.mp4')).toBe(true);
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

describe('cutTimes — drop-hit marking (BUG I-2)', () => {
  it('flags exactly one cut — the first drop-kind cut — even when the drop is off the beat grid', () => {
    const offGridMap: MusicMap = { ...map, drops: [{ time: 20.3, strength: 4 }] };
    const rng = mulberry32('test');
    const cuts = cutTimes(offGridMap, 0, 25, rng);

    const dropHitCuts = cuts.filter((c) => c.dropHit);
    expect(dropHitCuts.length).toBe(1);

    const firstDropKindCut = cuts.find((c) => c.kind === 'drop');
    expect(dropHitCuts[0]).toBe(firstDropKindCut);

    // First beat at/after the off-grid drop (20.3) on the 0.5s grid — NOT 20.3 itself, and
    // structurally marked regardless of the (non-zero) distance from the raw drop timestamp.
    expect(dropHitCuts[0]!.time).toBeCloseTo(20.5, 10);
  });
});
