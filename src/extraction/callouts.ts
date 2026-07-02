/**
 * Arrow-callout planner: on a clip's strongest moments (the same emphasized-word events that
 * drive punch zooms), point an animated arrow at the active speaker's face. Callouts are only
 * planned when a face sample exists near the event — arrows never point at nothing — and are
 * deliberately sparing (max 2 per clip, min 4s apart, never in the first 1.5s).
 */
import type { CropKeyframe, FaceSample } from '../types/index.js';

export interface Callout { time: number; x: number; y: number; }

const OUT_W = 1080;
const OUT_H = 1920;
const MIN_START_SEC = 1.5;
const MIN_GAP_SEC = 4;
const MAX_CALLOUTS = 2;
const FACE_MATCH_SEC = 0.5;

/** PURE: nearest face sample with a box within `tol` seconds of t, or null. */
export function faceAt(faces: FaceSample[], t: number, tol = FACE_MATCH_SEC): FaceSample | null {
  let best: FaceSample | null = null;
  let bestDt = tol;
  for (const f of faces) {
    if (!f.box) continue;
    const dt = Math.abs(f.time - t);
    if (dt <= bestDt) { bestDt = dt; best = f; }
  }
  return best;
}

/** PURE: map a source-frame point onto the 1080x1920 output for blur framing (contained 16:9 band). */
export function mapBlurPoint(fx: number, fy: number, srcW: number, srcH: number): { x: number; y: number } {
  const dispH = (OUT_W * srcH) / srcW;
  const top = (OUT_H - dispH) / 2;
  return { x: (fx / srcW) * OUT_W, y: top + (fy / srcH) * dispH };
}

/** PURE: map a source-frame point onto the output for crop framing, using the nearest crop keyframe. */
export function mapCropPoint(
  fx: number, fy: number, track: CropKeyframe[], t: number,
): { x: number; y: number } | null {
  if (track.length === 0) return null;
  const kf = track.reduce((best, k) => (Math.abs(k.time - t) < Math.abs(best.time - t) ? k : best));
  const left = kf.cx - kf.cropW / 2;
  const top = kf.cy - kf.cropH / 2;
  const x = ((fx - left) / kf.cropW) * OUT_W;
  const y = ((fy - top) / kf.cropH) * OUT_H;
  if (x < 0 || x > OUT_W || y < 0 || y > OUT_H) return null; // face outside the crop — no arrow
  return { x, y };
}

/**
 * PURE: plan up to MAX_CALLOUTS arrows from zoom-event times + face samples.
 * Coordinates are output pixels (1080x1920) of the face's top-center point.
 */
export function planCallouts(
  zoomTimes: number[],
  faces: FaceSample[],
  opts: { mode: 'blur' | 'crop'; track: CropKeyframe[]; srcW: number; srcH: number },
): Callout[] {
  const callouts: Callout[] = [];
  for (const t of zoomTimes) {
    if (t < MIN_START_SEC) continue;
    if (callouts.length > 0 && t - callouts[callouts.length - 1].time < MIN_GAP_SEC) continue;
    const face = faceAt(faces, t);
    if (!face?.box) continue;
    const fx = face.box.x + face.box.w / 2;
    const fy = face.box.y; // top of the face — the arrow points down at the head
    const p = opts.mode === 'crop'
      ? mapCropPoint(fx, fy, opts.track, t)
      : mapBlurPoint(fx, fy, opts.srcW, opts.srcH);
    if (!p) continue;
    callouts.push({ time: t, x: Math.round(p.x), y: Math.round(p.y) });
    if (callouts.length >= MAX_CALLOUTS) break;
  }
  return callouts;
}
