import { describe, it, expect } from 'vitest';
import { planCallouts, mapBlurPoint, mapCropPoint, faceAt } from '../../src/extraction/callouts.js';
import type { FaceSample } from '../../src/types/index.js';

const face = (time: number, x = 800, y = 300): FaceSample => ({ time, box: { x, y, w: 160, h: 200 } });

describe('coordinate mapping', () => {
  it('blur: contained 16:9 band centered vertically', () => {
    // 1920x1080 source → displayed 1080x607.5, top offset (1920-607.5)/2 = 656.25
    const p = mapBlurPoint(960, 540, 1920, 1080);
    expect(p.x).toBeCloseTo(540);
    expect(p.y).toBeCloseTo(656.25 + 303.75);
  });
  it('crop: maps through the nearest crop keyframe window', () => {
    const track = [{ time: 2, cx: 800, cy: 500, cropW: 540, cropH: 960 }];
    const p = mapCropPoint(800, 500, track, 2);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(540); // crop center → output center
    expect(p!.y).toBeCloseTo(960);
    // point outside the crop window → null (no arrow)
    expect(mapCropPoint(0, 0, track, 2)).toBeNull();
  });
});

describe('faceAt', () => {
  it('nearest sample within tolerance; null when too far', () => {
    const faces = [face(1.9), face(5.0)];
    expect(faceAt(faces, 2.1)?.time).toBe(1.9);
    expect(faceAt(faces, 3.5)).toBeNull();
  });
});

describe('planCallouts', () => {
  const opts = { mode: 'blur' as const, track: [], srcW: 1920, srcH: 1080 };
  it('caps at 2, enforces 4s gap, skips first 1.5s, requires a face', () => {
    const faces = [face(2), face(3), face(7), face(12)];
    const callouts = planCallouts([1.0, 2.0, 3.0, 7.0, 12.0], faces, opts);
    expect(callouts.map((c) => c.time)).toEqual([2.0, 7.0]);
  });
  it('no faces → no callouts', () => {
    expect(planCallouts([2, 7], [], opts)).toEqual([]);
  });
  it('coordinates are inside the 1080x1920 output', () => {
    const [c] = planCallouts([2], [face(2)], opts);
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(1080);
    expect(c.y).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(1920);
  });
});
