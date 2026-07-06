/**
 * Pace engine (v4 Part 3 §4) — decides HOW aggressively to tighten per clip, from content
 * signals, not a global constant. Dense/punchy/clippies content tightens hard; slow/reflective/
 * mindcuts content keeps more breath. Maps a 0-1 pace to the tighten thresholds. PURE.
 */
import type { ContentMode } from '../types/index.js';
import { DEFAULT_TIGHTEN, type TightenParams } from './tighten.js';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);

/** PURE: per-clip pace 0-1 from speech density + energy + mode. */
export function paceTarget(args: { wordsPerSec: number; meanRms: number; mode: ContentMode }): number {
  const density = clamp01(args.wordsPerSec / 3);       // ~3 wps = full marks
  const energy = clamp01(args.meanRms / 10);           // rms is 0-10
  const modeBias = args.mode === 'clippies' ? 0.3 : 0.1;
  return clamp01(0.4 * density + 0.3 * energy + modeBias);
}

/** PURE: pace → tighten params. Higher pace ⇒ shorter allowed silence + tighter breath. */
export function paceToTighten(pace: number): TightenParams {
  return {
    ...DEFAULT_TIGHTEN,
    maxInternalSilenceSec: lerp(1.2, 0.5, pace),
    keepBreathSec: lerp(0.18, 0.10, pace),
  };
}
