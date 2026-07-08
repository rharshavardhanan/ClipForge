/**
 * AVSS foundation: the EditPlan (every decision the renderer consumes, clip-relative)
 * and SourceSignals (the per-clip evidence the audience simulator scores plans against).
 * Pure — callers do all I/O. Framing, B-roll windows and music are carried but never
 * varied by AVSS (framing choice is final per user decision; B-roll is expensive I/O).
 */
import type {
  AudioEnergyLayer, CaptionWord, RmsPoint, SemanticScores, SemanticWindow,
} from '../types/index.js';
import type { ModeProfile } from '../modes.js';
import { buildZoomSfxTimes } from '../sfx/events.js';
import type { ReactionEvent } from '../perception/query.js';

export interface EditPlan {
  hookText?: string;                      // resolved card text (≤8 words)
  hookSource: 'moment' | 'title' | 'none';
  captionPreset: string;
  zoom: { enabled: boolean; times: number[]; intensity: number };
  sfx: { enabled: boolean; volume: number };
  brollWindows: { atSec: number; durationSec: number }[]; // fixed, never varied
  musicOn: boolean;                                        // fixed, never varied
}

export interface SourceSignals {
  durationSec: number;
  words: CaptionWord[];                                   // clip-relative
  rms: RmsPoint[];                                        // clip-relative slice, rms 0–10
  silences: { start: number; end: number }[];             // clip-relative, clamped
  semantic: SemanticScores;                               // normalized 0–1
  sentiment?: string;
  /** Real audience reactions from perception (clip-relative), absent when perception is off. */
  reactionEvents?: ReactionEvent[];
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** PURE: truncate a hook to <=8 words for the hook card, appending an ellipsis if cut. */
export function truncateHook(s: string): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 8) return words.join(' ');
  return words.slice(0, 7).join(' ') + '…';
}

const ZERO_SCORES: SemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};

/** PURE: slice the full-video audio layer + semantic windows down to one clip's window,
 *  re-offset to clip-relative seconds, and normalize semantic subscores from 0-10 to 0-1
 *  (overlap-weighted mean across intersecting windows). */
export function buildSourceSignals(
  clip: { start: number; end: number; sentiment?: string },
  words: CaptionWord[],
  audio: AudioEnergyLayer,
  semantic: SemanticWindow[],
  reactionEvents?: ReactionEvent[],
): SourceSignals {
  const durationSec = clip.end - clip.start;

  const rms = audio.rms_curve
    .filter((p) => p.time >= clip.start && p.time <= clip.end)
    .map((p) => ({ time: p.time - clip.start, rms: p.rms }));

  const silences = audio.silence_regions
    .filter((r) => r.end > clip.start && r.start < clip.end)
    .map((r) => ({
      start: Math.max(0, r.start - clip.start),
      end: Math.min(durationSec, r.end - clip.start),
    }));

  const scores: SemanticScores = { ...ZERO_SCORES };
  let totalOverlap = 0;
  const sums = new Map<keyof SemanticScores, number>();
  for (const win of semantic) {
    const overlap = Math.min(win.end, clip.end) - Math.max(win.start, clip.start);
    if (overlap <= 0) continue;
    totalOverlap += overlap;
    for (const k of Object.keys(ZERO_SCORES) as (keyof SemanticScores)[]) {
      sums.set(k, (sums.get(k) ?? 0) + (win.scores[k] ?? 0) * overlap);
    }
  }
  if (totalOverlap > 0) {
    for (const k of Object.keys(ZERO_SCORES) as (keyof SemanticScores)[]) {
      scores[k] = clamp01((sums.get(k) ?? 0) / totalOverlap / 10);
    }
  }

  return { durationSec, words, rms, silences, semantic: scores, sentiment: clip.sentiment, reactionEvents };
}

/** PURE: assemble the base (pre-variant) edit plan from the mode profile + resolved options. */
export function buildEditPlan(args: {
  profile: ModeProfile;
  captionPreset: string;
  hookMoment?: string;
  clipTitle?: string;
  words: CaptionWord[];
  overlays: { atSec: number; durationSec: number }[];
  zoomsEnabled: boolean;
  sfxEnabled: boolean;
  sfxVolume: number;
  musicOn: boolean;
}): EditPlan {
  const hookRaw = args.hookMoment?.trim() || undefined;
  const titleRaw = args.clipTitle?.trim() || undefined;
  const hookSource = hookRaw ? 'moment' : titleRaw ? 'title' : 'none';
  const hookText = hookRaw ?? titleRaw;
  return {
    ...(hookText ? { hookText: truncateHook(hookText) } : {}),
    hookSource,
    captionPreset: args.captionPreset,
    zoom: {
      enabled: args.zoomsEnabled,
      times: args.zoomsEnabled ? buildZoomSfxTimes(args.words) : [],
      intensity: args.profile.zoomIntensity,
    },
    sfx: { enabled: args.sfxEnabled, volume: args.sfxVolume },
    brollWindows: args.overlays.map((o) => ({ atSec: o.atSec, durationSec: o.durationSec })),
    musicOn: args.musicOn,
  };
}
