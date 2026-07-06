/**
 * TimeMap (v4 Part 3 §2) — the source↔output time transform for internal cuts. When the editor
 * removes dead air / filler, the clip is physically shortened; every clip-relative time
 * (caption words, zoom events, B-roll windows, RMS curve) must move onto the compressed
 * timeline or captions desync from speech. This is that transform, kept pure and heavily
 * property-tested because a bug here is an audible/visible defect. All times are clip-relative
 * seconds; kept segments are ordered, disjoint, in SOURCE clip-relative time.
 */
import type { CaptionWord, RmsPoint } from '../types/index.js';

export interface KeepSegment { start: number; end: number; }
export interface TimeMap {
  keep: KeepSegment[];
  totalOut: number;    // sum of kept durations = compressed clip length
  isIdentity: boolean; // true when nothing was removed (a single [0, dur] span)
}

export function buildTimeMap(keep: KeepSegment[]): TimeMap {
  const totalOut = keep.reduce((a, s) => a + (s.end - s.start), 0);
  const isIdentity = keep.length === 1 && keep[0].start === 0;
  return { keep, totalOut, isIdentity };
}

export function identityTimeMap(dur: number): TimeMap {
  return { keep: [{ start: 0, end: dur }], totalOut: dur, isIdentity: true };
}

/** PURE: source clip-relative t → output clip-relative t. t in a removed gap collapses to the
 *  next kept segment's output start; t past the end clamps to totalOut. */
export function srcToOut(map: TimeMap, t: number): number {
  let acc = 0;
  for (const seg of map.keep) {
    if (t < seg.start) return acc;          // in the gap before this segment
    if (t <= seg.end) return acc + (t - seg.start);
    acc += seg.end - seg.start;
  }
  return acc;                                // past the last kept segment
}

/** PURE: is source time t inside a kept segment? */
export function isKept(map: TimeMap, t: number): boolean {
  return map.keep.some((seg) => t >= seg.start && t <= seg.end);
}

/** PURE: words onto the output timeline; a word whose MIDPOINT is in a removed gap is dropped. */
export function mapWords(map: TimeMap, words: CaptionWord[]): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const word of words) {
    if (!isKept(map, (word.start + word.end) / 2)) continue;
    out.push({ ...word, start: srcToOut(map, word.start), end: srcToOut(map, word.end) });
  }
  return out;
}

/** PURE: event times onto the output timeline; times in removed gaps are dropped. */
export function mapTimes(map: TimeMap, times: number[]): number[] {
  return times.filter((t) => isKept(map, t)).map((t) => srcToOut(map, t));
}

/** PURE: RMS curve onto the output timeline; points in removed gaps are dropped. */
export function mapRms(map: TimeMap, rms: RmsPoint[]): RmsPoint[] {
  return rms.filter((p) => isKept(map, p.time)).map((p) => ({ time: srcToOut(map, p.time), rms: p.rms }));
}
