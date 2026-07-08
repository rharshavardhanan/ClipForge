import { describe, it, expect } from 'vitest';
import { truncateHook, clamp01, buildSourceSignals, buildEditPlan } from '../../src/avss/editPlan.js';
import { MODE_PROFILES } from '../../src/modes.js';
import type { AudioEnergyLayer, CaptionWord, SemanticScores, SemanticWindow } from '../../src/types/index.js';

const w = (start: number, emphasized = false, text = 'word'): CaptionWord =>
  ({ text, start, end: start + 0.3, emphasized });

const zeroScores: SemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};

const semWindow = (start: number, end: number, scores: Partial<SemanticScores>): SemanticWindow => ({
  start, end, semantic_score: 5, scores: { ...zeroScores, ...scores },
  hook_moment: 'hook', clip_titles: ['a', 'b', 'c'], is_standalone: true,
  recommended_duration: 30, sentiment: 'neutral', reason: '',
});

describe('truncateHook', () => {
  it('keeps short hooks verbatim', () => {
    expect(truncateHook('wait for it')).toBe('wait for it');
  });
  it('cuts >8 words to 7 + ellipsis', () => {
    expect(truncateHook('one two three four five six seven eight nine')).toBe('one two three four five six seven…');
  });
});

describe('clamp01', () => {
  it('clamps below and above', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});

describe('buildSourceSignals', () => {
  const audio: AudioEnergyLayer = {
    rms_curve: [
      { time: 9, rms: 2 }, { time: 10, rms: 5 }, { time: 12, rms: 8 }, { time: 40, rms: 3 },
    ],
    silence_regions: [{ start: 5, end: 11 }, { start: 20, end: 22 }],
  };

  it('slices and re-offsets rms + silences to clip-relative times', () => {
    const s = buildSourceSignals({ start: 10, end: 25 }, [w(0)], audio, []);
    expect(s.durationSec).toBe(15);
    expect(s.rms).toEqual([{ time: 0, rms: 5 }, { time: 2, rms: 8 }]);
    // first silence [5,11] intersected with [10,25] → clip-relative [0,1]
    expect(s.silences).toEqual([{ start: 0, end: 1 }, { start: 10, end: 12 }]);
  });

  it('normalizes overlapping semantic scores from 0-10 to 0-1', () => {
    const sem = [semWindow(0, 30, { humor: 8, surprise: 10 })];
    const s = buildSourceSignals({ start: 10, end: 25 }, [], audio, sem);
    expect(s.semantic.humor).toBeCloseTo(0.8);
    expect(s.semantic.surprise).toBe(1);
    expect(s.semantic.wisdom).toBe(0);
  });

  it('weights multiple windows by overlap', () => {
    const sem = [
      semWindow(0, 20, { humor: 10 }),   // overlaps [10,20] → 10s
      semWindow(20, 30, { humor: 0 }),   // overlaps [20,25] → 5s
    ];
    const s = buildSourceSignals({ start: 10, end: 25 }, [], audio, sem);
    expect(s.semantic.humor).toBeCloseTo((10 * 1 + 5 * 0) / 15 / 1, 5); // (10s·1.0 + 5s·0)/15s
  });

  it('yields zero scores when no window overlaps', () => {
    const sem = [semWindow(100, 130, { humor: 10 })];
    const s = buildSourceSignals({ start: 10, end: 25 }, [], audio, sem);
    expect(s.semantic).toEqual(zeroScores);
  });

  it('threads reactionEvents through', () => {
    const s = buildSourceSignals({ start: 10, end: 25 }, [], audio, [],
      [{ t: 1, kind: 'laughter', score: 0.8 }]);
    expect(s.reactionEvents).toEqual([{ t: 1, kind: 'laughter', score: 0.8 }]);
  });

  it('leaves reactionEvents undefined when omitted', () => {
    const s = buildSourceSignals({ start: 10, end: 25 }, [], audio, []);
    expect(s.reactionEvents).toBeUndefined();
  });
});

describe('buildEditPlan', () => {
  const base = {
    profile: MODE_PROFILES.clippies,
    captionPreset: 'mrbeast',
    words: [w(0.5, true), w(2, true), w(6, true)],
    overlays: [{ atSec: 4, durationSec: 3 }],
    zoomsEnabled: true, sfxEnabled: true, sfxVolume: 0.6, musicOn: false,
  };

  it('prefers hook moment over title', () => {
    const p = buildEditPlan({ ...base, hookMoment: 'no way he did that', clipTitle: 'Crazy moment' });
    expect(p.hookSource).toBe('moment');
    expect(p.hookText).toBe('no way he did that');
  });

  it('falls back to title, then none', () => {
    expect(buildEditPlan({ ...base, clipTitle: 'Crazy moment' }).hookSource).toBe('title');
    const none = buildEditPlan({ ...base });
    expect(none.hookSource).toBe('none');
    expect(none.hookText).toBeUndefined();
  });

  it('computes zoom times from emphasized words, honoring zoomsEnabled', () => {
    const p = buildEditPlan({ ...base, hookMoment: 'x' });
    expect(p.zoom.times).toEqual([2, 6]);   // <1s skipped, 2.5s min gap
    expect(p.zoom.intensity).toBe(MODE_PROFILES.clippies.zoomIntensity);
    const off = buildEditPlan({ ...base, zoomsEnabled: false });
    expect(off.zoom.enabled).toBe(false);
    expect(off.zoom.times).toEqual([]);
  });

  it('carries broll windows and sfx settings through untouched', () => {
    const p = buildEditPlan({ ...base, hookMoment: 'x' });
    expect(p.brollWindows).toEqual([{ atSec: 4, durationSec: 3 }]);
    expect(p.sfx).toEqual({ enabled: true, volume: 0.6 });
    expect(p.musicOn).toBe(false);
  });
});
