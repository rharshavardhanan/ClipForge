import type { AudioEnergyLayer, ClipCandidate, SilenceRegion, TranscriptSegment, WindowScore } from '../types/index.js';
import type { ClipLengths } from '../modes.js';

export function snapStart(t: number, segments: TranscriptSegment[]): number {
  const enclosing = segments.find((s) => t >= s.start && t < s.end);
  if (enclosing) return enclosing.start;
  const next = segments.find((s) => s.start >= t);
  return next ? next.start : t;
}

export function snapEnd(t: number, segments: TranscriptSegment[]): number {
  const enclosing = segments.find((s) => t > s.start && t <= s.end);
  if (enclosing) return enclosing.end;
  const prev = [...segments].reverse().find((s) => s.end <= t);
  return prev ? prev.end : t;
}

export function coldOpenTrim(start: number, silences: SilenceRegion[]): number {
  const covering = silences.find((r) => start >= r.start - 0.01 && start < r.end);
  return covering ? covering.end : start;
}

// Adaptive length (v4): most clips stay punchy under the 30s soft cap; a clip may extend
// toward 60s ONLY while its neighboring windows hold peak-level (>= threshold) heat —
// "if the clip needs more context, expand; never cut payoff."
// v6 modes override the caps per video (clippies 15/25/45, mindcuts 20/45/60).
export const MIN_CLIP_SEC = 15;
export const SOFT_CAP_SEC = 30;
export const MAX_CLIP_SEC = 60;
export const DEFAULT_LENGTHS: ClipLengths = { min: MIN_CLIP_SEC, soft: SOFT_CAP_SEC, max: MAX_CLIP_SEC };

function spanAllowed(span: number, composite: number, threshold: number, lengths: ClipLengths): boolean {
  if (span <= lengths.soft) return true;
  return composite >= threshold && span <= lengths.max;
}

export function clampDuration(start: number, end: number, lengths: ClipLengths = DEFAULT_LENGTHS): { start: number; end: number } {
  let e = end;
  if (e - start > lengths.max) e = start + lengths.max;   // hard cap
  if (e - start < lengths.min) e = start + lengths.min;   // pull up very short clips
  return { start, end: e };
}

/** A closing sentence may run this far past the mode max rather than being cut mid-word. */
export const SENTENCE_SLACK_SEC = 3;

/** PURE: latest sentence end in (start, cap], or null when no boundary fits. */
function lastSentenceEndWithin(cap: number, start: number, segments: TranscriptSegment[]): number | null {
  let best: number | null = null;
  for (const s of segments) {
    if (s.end > start && s.end <= cap && (best === null || s.end > best)) best = s.end;
  }
  return best;
}

/**
 * PURE: sentence-aware length clamp — never cut mid-sentence. Over the max: finish the
 * straddling sentence when it only slightly overshoots (≤ SENTENCE_SLACK_SEC), else retreat
 * to the last sentence boundary under the cap. Under the min: extend forward to the end of
 * the sentence that reaches the minimum. Falls back to hard times only when the transcript
 * offers no usable boundary (e.g. one giant segment).
 */
export function clampToSentences(
  start: number, end: number, segments: TranscriptSegment[], lengths: ClipLengths = DEFAULT_LENGTHS,
): { start: number; end: number } {
  let e = end;

  if (e - start > lengths.max) {
    const cap = start + lengths.max;
    const straddling = segments.find((s) => cap > s.start && cap < s.end);
    if (straddling && straddling.end - start <= lengths.max + SENTENCE_SLACK_SEC) {
      e = straddling.end;                                     // let the sentence finish
    } else {
      const boundary = lastSentenceEndWithin(cap, start, segments);
      e = boundary !== null && boundary - start >= lengths.min ? boundary : cap;
    }
  }

  if (e - start < lengths.min) {
    const target = start + lengths.min;
    const reaching = segments.find((s) => s.end >= target);   // sentence whose end reaches the minimum
    e = reaching && reaching.end - start <= lengths.max + SENTENCE_SLACK_SEC ? reaching.end : target;
  }

  return { start, end: e };
}

export function buildClips(
  windows: WindowScore[],
  segments: TranscriptSegment[],
  audio: AudioEnergyLayer,
  threshold: number,
  duration = Infinity,
  lengths: ClipLengths = DEFAULT_LENGTHS,
): ClipCandidate[] {
  const floor = threshold * 0.7;
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const peaks = windows.filter((w) => w.composite >= threshold).sort((a, b) => b.composite - a.composite);
  const clips: ClipCandidate[] = [];

  for (const peak of peaks) {
    const pi = sorted.findIndex((w) => w.start === peak.start);
    let start = peak.start;
    let end = peak.end;

    // Expand outward over consecutive windows whose composite stays >= floor. Spans under the
    // 30s soft cap expand freely; extending toward the 60s max needs peak-level (>= threshold) heat.
    let i = pi;
    while (i - 1 >= 0 && sorted[i - 1].composite >= floor
      && spanAllowed(end - sorted[i - 1].start, sorted[i - 1].composite, threshold, lengths)) {
      i--;
      start = sorted[i].start;
    }
    let j = pi;
    while (j + 1 < sorted.length && sorted[j + 1].composite >= floor
      && spanAllowed(sorted[j + 1].end - start, sorted[j + 1].composite, threshold, lengths)) {
      j++;
      end = sorted[j].end;
    }

    // Snap to sentence boundaries, trim a cold open, clamp to the mode's min/max, cap at real duration.
    // The clamp itself is sentence-aware — clips never end mid-sentence over a length cap.
    start = coldOpenTrim(snapStart(start, segments), audio.silence_regions);
    end = snapEnd(end, segments);
    ({ start, end } = clampToSentences(start, end, segments, lengths));
    end = Math.min(end, duration);

    // Drop candidates overlapping an already-kept clip (IOU > 0.5).
    const overlaps = clips.some((c) => {
      const inter = Math.max(0, Math.min(c.end, end) - Math.max(c.start, start));
      const union = Math.max(c.end, end) - Math.min(c.start, start);
      return union > 0 && inter / union > 0.5;
    });
    if (overlaps) continue;

    clips.push({ start, end, composite: peak.composite, triggerScore: peak.triggerScore, audioScore: peak.audioScore, commentScore: peak.commentScore });
  }
  return clips;
}
