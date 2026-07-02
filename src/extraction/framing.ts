/**
 * Framing decision engine. The default for short-form clips is a BLUR-BACKGROUND 9:16
 * frame (original video centered, duplicated + heavily blurred behind) — it preserves
 * composition, never cuts faces, and looks natural. Smart face-crop is used ONLY when
 * there is a single, stable, close-up dominant face; two-or-more people always stay in
 * blur mode so nobody gets cropped out. (Split-frame is a future mode; punch zooms are
 * applied per-moment on top of either base framing.)
 *
 * This is the fix for the "always crop the face" anti-pattern that makes AI clip tools
 * look synthetic — crop is now the exception, blur is the rule.
 */
import type { Track } from '../types/index.js';

export type FramingMode = 'blur' | 'crop';

export interface FramingSignal {
  trackCount: number;           // distinct people detected
  dominantPresence: number;     // 0-1: fraction of sampled frames the biggest face appears in
  secondaryPresence: number;    // 0-1: fraction the 2nd face appears in
  dominantFaceFraction: number; // dominant face height / source height (close-up ⇒ larger)
  positionStability: number;    // 0-1: 1 = dominant face barely moves
}

export interface FramingThresholds {
  minFaceFraction?: number;  // face must fill ≥ this fraction of frame height to be a "close-up"
  minPresence?: number;      // dominant face must be present ≥ this fraction of the clip
  minStability?: number;     // dominant face must be at least this stable
  secondaryFloor?: number;   // a 2nd face present ≥ this fraction ⇒ keep both (blur)
}

/** Pick the base framing mode. Blur is the strong default; crop is earned. */
export function chooseFramingMode(s: FramingSignal, t: FramingThresholds = {}): FramingMode {
  const minFace = t.minFaceFraction ?? 0.12;
  const minPresence = t.minPresence ?? 0.6;
  const minStability = t.minStability ?? 0.5;
  const secondaryFloor = t.secondaryFloor ?? 0.25;

  // Two (or more) people who are both actually present → never crop one out.
  if (s.trackCount >= 2 && s.secondaryPresence >= secondaryFloor) return 'blur';

  // A single dominant face that is close-up, steady, and consistently on screen → smart crop.
  if (
    s.dominantPresence >= minPresence &&
    s.dominantFaceFraction >= minFace &&
    s.positionStability >= minStability
  ) return 'crop';

  // No face, a tiny/far face (wide shot), a jittery face, or one that's mostly absent → blur.
  return 'blur';
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function std(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

/** PURE: summarize associated face tracks into a framing signal over `frameCount` sampled frames. */
export function summarizeFraming(tracks: Track[], frameCount: number, srcW: number, srcH: number): FramingSignal {
  const zero: FramingSignal = {
    trackCount: 0, dominantPresence: 0, secondaryPresence: 0, dominantFaceFraction: 0, positionStability: 0,
  };
  if (tracks.length === 0 || frameCount === 0) return zero;

  const bySize = [...tracks].sort((a, b) => b.samples.length - a.samples.length);
  const dom = bySize[0];
  const sec = bySize[1];

  const dominantPresence = Math.min(1, dom.samples.length / frameCount);
  const secondaryPresence = sec ? Math.min(1, sec.samples.length / frameCount) : 0;
  const dominantFaceFraction = median(dom.samples.map((s) => s.box.h)) / srcH;

  const cxs = dom.samples.map((s) => s.box.x + s.box.w / 2);
  const cys = dom.samples.map((s) => s.box.y + s.box.h / 2);
  const stability = Math.max(0, 1 - (std(cxs) / srcW + std(cys) / srcH));

  return { trackCount: tracks.length, dominantPresence, secondaryPresence, dominantFaceFraction, positionStability: stability };
}
