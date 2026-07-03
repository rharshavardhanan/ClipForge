import { describe, expect, it } from 'vitest';
import { centerCropTrack, smoothTrack } from '../../src/extraction/faceTracker.js';

describe('aspect-aware crop geometry', () => {
  it('centerCropTrack defaults to 9:16', () => {
    const [k] = centerCropTrack(1920, 1080);
    expect(k.cropH).toBe(1080);
    expect(k.cropW).toBeCloseTo(1080 * (9 / 16), 5);
  });

  it('centerCropTrack builds a 3:4 window when asked', () => {
    const [k] = centerCropTrack(1920, 1080, 0, 3 / 4);
    expect(k.cropH).toBe(1080);
    expect(k.cropW).toBeCloseTo(810, 5);
  });

  it('smoothTrack windows honor the aspect', () => {
    const samples = [0, 1, 2].map((i) => ({
      time: i, box: { x: 900, y: 400, w: 120, h: 160 },
    }));
    const track = smoothTrack(samples, 1920, 1080, 0.15, 3 / 4);
    for (const k of track) expect(k.cropW / k.cropH).toBeCloseTo(3 / 4, 3);
  });
});
