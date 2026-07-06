/**
 * Visual feasibility (v4 Part 2 §4.1 subject_clarity + shot_stability): can the Framing engine
 * make a clean 9:16 out of this moment? A great line with no findable subject, or a chaotic
 * rapid-cut window, is a hard clip — penalize it at SELECTION so we stop rendering
 * framing-hostile moments (the "face in the corner / ceiling shot" class of failure, caught
 * before render instead of after). Computed on arc survivors only. PURE.
 */
import type { FrameObs } from '../types/index.js';

export interface VisualFeasibility { facePresence: number; shotStability: number; score: number; }

export const VISUAL_WEIGHTS = { facePresence: 0.6, shotStability: 0.4 } as const;
/** A cut every 2s (0.5/s) reads as fully chaotic → shotStability 0. */
export const MAX_CUTS_PER_SEC = 0.5;

/** PURE: facePresence = fraction of sampled frames with ≥1 face; shotStability falls with
 *  cut density; score = weighted blend (0-1). Empty frames → 0 (no evidence of a subject). */
export function scoreVisualFeasibility(
  frames: FrameObs[], cutTimes: number[], windowStart: number, windowEnd: number,
): VisualFeasibility {
  if (frames.length === 0) return { facePresence: 0, shotStability: 0, score: 0 };
  const facePresence = frames.filter((f) => f.faces.length > 0).length / frames.length;
  const durationSec = Math.max(windowEnd - windowStart, 1e-6);
  const cutsInWindow = cutTimes.filter((t) => t >= windowStart && t <= windowEnd).length;
  const cutsPerSec = cutsInWindow / durationSec;
  const shotStability = 1 - Math.min(1, cutsPerSec / MAX_CUTS_PER_SEC);
  const score = VISUAL_WEIGHTS.facePresence * facePresence + VISUAL_WEIGHTS.shotStability * shotStability;
  return { facePresence, shotStability, score };
}
