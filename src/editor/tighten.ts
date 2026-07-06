/**
 * Tighten planner (v4 Part 3 §3) — decides which spans of a clip to CUT so it feels hand-edited:
 * long internal silences (trimmed, not fully closed — breaths stay natural) and filler words
 * that are safely flanked by gaps. Never touches the hook or the payoff tail ("tighten the
 * runway, not the landing"), never leaves a tiny kept fragment, and falls back to leaving the
 * clip whole when there's little to gain. PURE — returns kept segments + a TimeMap.
 */
import type { CaptionWord } from '../types/index.js';
import { isFillerWord } from '../analysis/filler.js';
import { buildTimeMap, identityTimeMap, type KeepSegment, type TimeMap } from './timeMap.js';

export interface TightenParams {
  maxInternalSilenceSec: number;
  keepBreathSec: number;
  hookProtectSec: number;
  payoffProtectSec: number;
  minSegmentSec: number;
  fillerGapSec: number;
}

export const DEFAULT_TIGHTEN: TightenParams = {
  maxInternalSilenceSec: 0.9,
  keepBreathSec: 0.15,
  hookProtectSec: 3,
  payoffProtectSec: 3,
  minSegmentSec: 1.2,
  fillerGapSec: 0.15,
};

export const MIN_TIGHTEN_GAIN_S = 0.8;
export const MIN_KEPT_S = 8;

export interface TightenResult { keep: KeepSegment[]; map: TimeMap; removedSec: number; }

interface Span { start: number; end: number; }

/** Merge overlapping/adjacent spans (sorted). */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Clip a span to the unprotected middle region; returns null if nothing survives. */
function clampUnprotected(s: Span, lo: number, hi: number): Span | null {
  const start = Math.max(s.start, lo);
  const end = Math.min(s.end, hi);
  return end > start ? { start, end } : null;
}

export function planTighten(
  durSec: number, silences: Span[], words: CaptionWord[], p: TightenParams = DEFAULT_TIGHTEN,
): TightenResult {
  const lo = p.hookProtectSec;
  const hi = durSec - p.payoffProtectSec;
  const identity = (): TightenResult => ({ keep: [{ start: 0, end: durSec }], map: identityTimeMap(durSec), removedSec: 0 });
  if (hi <= lo) return identity();

  const removals: Span[] = [];

  // (a) Long silences — trimmed by keepBreath each side so the cut leaves a natural breath.
  for (const sil of silences) {
    if (sil.end - sil.start <= p.maxInternalSilenceSec) continue;
    const trimmed = { start: sil.start + p.keepBreathSec, end: sil.end - p.keepBreathSec };
    const c = clampUnprotected(trimmed, lo, hi);
    if (c && c.end - c.start > 0) removals.push(c);
  }

  // (b) Filler words flanked by gaps ≥ fillerGapSec on both sides (safe to excise).
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!isFillerWord(word.text)) continue;
    const prevEnd = i > 0 ? words[i - 1].end : 0;
    const nextStart = i < words.length - 1 ? words[i + 1].start : durSec;
    if (word.start - prevEnd < p.fillerGapSec || nextStart - word.end < p.fillerGapSec) continue;
    const c = clampUnprotected({ start: word.start, end: word.end }, lo, hi);
    if (c) removals.push(c);
  }

  const merged = mergeSpans(removals);
  if (merged.length === 0) return identity();

  // Kept = complement of removals over [0, durSec].
  const keep: KeepSegment[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) keep.push({ start: cursor, end: r.start });
    cursor = r.end;
  }
  if (cursor < durSec) keep.push({ start: cursor, end: durSec });

  // Drop kept fragments below minSegmentSec (fold them away — they'd stutter).
  const bigEnough = keep.filter((s) => s.end - s.start >= p.minSegmentSec);
  if (bigEnough.length === 0) return identity();

  const keptTotal = bigEnough.reduce((a, s) => a + (s.end - s.start), 0);
  const removedSec = durSec - keptTotal;
  if (removedSec < MIN_TIGHTEN_GAIN_S || keptTotal < MIN_KEPT_S) return identity();

  return { keep: bigEnough, map: buildTimeMap(bigEnough), removedSec: +removedSec.toFixed(3) };
}
