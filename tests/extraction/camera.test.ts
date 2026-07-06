import { describe, it, expect } from 'vitest';
import {
  lockOnPath, smoothCameraAxis,
  CAMERA_DEADBAND_FRAC, CAMERA_MAX_VEL_FRAC,
} from '../../src/extraction/camera.js';

const opts = { deadband: 5, maxVel: 10, maxAccel: 4 };

describe('lockOnPath', () => {
  it('constant target → held still (zero motion)', () => {
    const out = lockOnPath(new Array(20).fill(500), opts);
    for (const v of out) expect(v).toBe(500);
  });

  it('jitter within the deadband → output stays flat (locked to the first sample)', () => {
    const target = Array.from({ length: 30 }, (_, i) => 500 + (i % 2 ? 2 : -2)); // ±2 < deadband 5
    const out = lockOnPath(target, opts);
    for (const v of out) expect(v).toBe(out[0]); // never moves — all held at the lock point
  });

  it('step target → holds, then glides to it without overshoot, bounded velocity', () => {
    const target = [...new Array(10).fill(0), ...new Array(40).fill(100)];
    const out = lockOnPath(target, opts);
    for (let i = 0; i < 10; i++) expect(out[i]).toBe(0);           // held before the step
    for (const v of out) expect(v).toBeLessThanOrEqual(100 + 1e-9); // never overshoots
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThanOrEqual(opts.maxVel + 1e-9);
    }
    expect(out[out.length - 1]).toBeCloseTo(100, 3);              // converges
  });

  it('respects the acceleration bound (smooth ramp, no velocity jumps)', () => {
    const target = [...new Array(5).fill(0), ...new Array(60).fill(300)];
    const out = lockOnPath(target, opts);
    for (let i = 2; i < out.length; i++) {
      const a = (out[i] - out[i - 1]) - (out[i - 1] - out[i - 2]);
      expect(Math.abs(a)).toBeLessThanOrEqual(opts.maxAccel + 1e-9);
    }
  });

  it('empty / single input', () => {
    expect(lockOnPath([], opts)).toEqual([]);
    expect(lockOnPath([42], opts)).toEqual([42]);
  });
});

describe('smoothCameraAxis', () => {
  it('is deterministic', () => {
    const desired = Array.from({ length: 40 }, (_, i) => 500 + 200 * Math.sin(i / 5));
    expect(smoothCameraAxis(desired, 1920)).toEqual(smoothCameraAxis(desired, 1920));
  });
  it('holds a near-static subject flat', () => {
    const desired = Array.from({ length: 30 }, (_, i) => 960 + (i % 3 - 1) * 3); // tiny jitter
    const out = smoothCameraAxis(desired, 1920);
    const spread = Math.max(...out) - Math.min(...out);
    expect(spread).toBeLessThan(1920 * CAMERA_DEADBAND_FRAC); // stays within the comfort box
  });
});

describe('containment invariant', () => {
  it('deadband + one step is well inside a crop half-width', () => {
    // the subject can never get more than (deadband + maxVel) ahead of the camera;
    // with a 9:16 crop of full 1080p height, half-width ≈ 303px ≈ 0.28·srcW(1080)…
    // expressed as fractions of the source extent, hold slack must stay < 0.5·crop-half.
    expect(CAMERA_DEADBAND_FRAC + CAMERA_MAX_VEL_FRAC).toBeLessThan(0.25);
  });
});
