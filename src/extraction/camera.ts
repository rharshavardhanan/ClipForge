/**
 * Virtual camera (v4 Part 4 §6) — lock-on / hold-then-glide crop motion. A skilled operator
 * holds the frame still while the subject sits in a comfort box, then moves decisively and
 * smoothly (bounded velocity + acceleration, no overshoot) when the subject leaves it. This
 * replaces the old continuous EMA that made the crop micro-drift with every detection wobble.
 * PURE — arrays in, arrays out. Bounds are source pixels (callers pass fractions of the extent).
 */
import { smoothSeriesBidirectional } from './faceTracker.js';

export interface LockOnOpts {
  deadband: number;   // hold while |target − held| ≤ this (source px)
  maxVel: number;     // max |Δposition| per sample
  maxAccel: number;   // max |Δvelocity| per sample — ramps moves in and out
}

export const CAMERA_DEADBAND_FRAC = 0.055;
export const CAMERA_MAX_VEL_FRAC = 0.11;
export const CAMERA_MAX_ACCEL_FRAC = 0.045;

const EPS = 1e-6;

/** PURE: hold-then-glide path over a per-sample target series. */
export function lockOnPath(target: number[], opts: LockOnOpts): number[] {
  if (target.length <= 1) return [...target];
  const { deadband, maxVel, maxAccel } = opts;
  const out: number[] = new Array(target.length);
  let p = target[0];   // camera position
  let v = 0;           // camera velocity (px/sample)
  out[0] = p;

  for (let i = 1; i < target.length; i++) {
    const err = target[i] - p;
    if (Math.abs(err) <= deadband && Math.abs(v) < EPS) {
      // inside the comfort box and at rest → hold
      v = 0;
      out[i] = p;
      continue;
    }
    const dir = Math.sign(err) || 1;
    // Critically-damped brake: distance needed to stop from current speed.
    const stopDist = (v * v) / (2 * maxAccel);
    if (Math.abs(err) <= stopDist + EPS) {
      // close enough that we must brake now to stop at the target
      v -= Math.sign(v || dir) * maxAccel;
    } else {
      // accelerate toward the target, capped at cruise speed
      v += dir * maxAccel;
    }
    v = Math.max(-maxVel, Math.min(maxVel, v));
    const next = p + v;
    // never pass the target — snap and stop if this step would overshoot
    if (Math.sign(target[i] - next) !== Math.sign(err) && Math.abs(target[i] - next) > EPS) {
      p = target[i];
      v = 0;
    } else {
      p = next;
    }
    out[i] = p;
  }
  return out;
}

/** PURE: denoise the raw desired series (zero-lag EMA), then apply the lock-on camera.
 *  Bounds are fractions of `extent` (srcW for cx, srcH for cy). */
export function smoothCameraAxis(desired: number[], extent: number, alpha = 0.35): number[] {
  const denoised = smoothSeriesBidirectional(desired, alpha);
  return lockOnPath(denoised, {
    deadband: extent * CAMERA_DEADBAND_FRAC,
    maxVel: extent * CAMERA_MAX_VEL_FRAC,
    maxAccel: extent * CAMERA_MAX_ACCEL_FRAC,
  });
}
