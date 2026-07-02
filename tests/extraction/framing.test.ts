import { describe, it, expect } from 'vitest';
import { chooseFramingMode, summarizeFraming, type FramingSignal } from '../../src/extraction/framing.js';
import type { Track } from '../../src/types/index.js';

const base: FramingSignal = {
  trackCount: 1, dominantPresence: 0.9, secondaryPresence: 0,
  dominantFaceFraction: 0.25, positionStability: 0.9,
};

describe('chooseFramingMode', () => {
  it('no face → blur', () => {
    expect(chooseFramingMode({ ...base, trackCount: 0, dominantPresence: 0, dominantFaceFraction: 0, positionStability: 0 })).toBe('blur');
  });

  it('one stable close-up dominant face → smart crop', () => {
    expect(chooseFramingMode(base)).toBe('crop');
  });

  it('two people both present → blur (preserve both, never crop one out)', () => {
    expect(chooseFramingMode({ ...base, trackCount: 2, secondaryPresence: 0.5 })).toBe('blur');
  });

  it('one face but tiny/far (wide shot) → blur', () => {
    expect(chooseFramingMode({ ...base, dominantFaceFraction: 0.06 })).toBe('blur');
  });

  it('one face but jittery/unstable → blur (no fake-looking chase)', () => {
    expect(chooseFramingMode({ ...base, positionStability: 0.2 })).toBe('blur');
  });

  it('one face present only briefly → blur', () => {
    expect(chooseFramingMode({ ...base, dominantPresence: 0.3 })).toBe('blur');
  });
});

describe('summarizeFraming', () => {
  const track = (id: number, n: number, cx: number, h: number): Track => ({
    id,
    samples: Array.from({ length: n }, (_, i) => ({
      time: i / 3,
      box: { x: cx - 50, y: 400 - h / 2, w: 100, h },
      mouthOpenness: 0.1,
    })),
  });

  it('empty → all-zero signal', () => {
    expect(summarizeFraming([], 0, 1920, 1080)).toEqual({
      trackCount: 0, dominantPresence: 0, secondaryPresence: 0, dominantFaceFraction: 0, positionStability: 0,
    });
  });

  it('single still close-up track → high presence, high stability, sane face fraction', () => {
    const s = summarizeFraming([track(0, 30, 960, 300)], 30, 1920, 1080);
    expect(s.trackCount).toBe(1);
    expect(s.dominantPresence).toBe(1);
    expect(s.secondaryPresence).toBe(0);
    expect(s.dominantFaceFraction).toBeCloseTo(300 / 1080, 5);
    expect(s.positionStability).toBeGreaterThan(0.9); // still face
  });

  it('two tracks → dominant is the more-sampled one; secondary presence reported', () => {
    const s = summarizeFraming([track(0, 30, 500, 200), track(1, 12, 1400, 200)], 30, 1920, 1080);
    expect(s.trackCount).toBe(2);
    expect(s.dominantPresence).toBe(1);          // 30/30
    expect(s.secondaryPresence).toBeCloseTo(12 / 30, 5);
  });
});
