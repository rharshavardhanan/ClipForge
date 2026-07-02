import type { AudioEnergyLayer, ClipCandidate, SilenceRegion, TranscriptSegment, WindowScore } from '../types/index.js';

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
export const MIN_CLIP_SEC = 15;
export const SOFT_CAP_SEC = 30;
export const MAX_CLIP_SEC = 60;

function spanAllowed(span: number, composite: number, threshold: number): boolean {
  if (span <= SOFT_CAP_SEC) return true;
  return composite >= threshold && span <= MAX_CLIP_SEC;
}

export function clampDuration(start: number, end: number): { start: number; end: number } {
  let e = end;
  if (e - start > MAX_CLIP_SEC) e = start + MAX_CLIP_SEC;   // hard cap
  if (e - start < MIN_CLIP_SEC) e = start + MIN_CLIP_SEC;   // pull up very short clips
  return { start, end: e };
}

export function buildClips(
  windows: WindowScore[],
  segments: TranscriptSegment[],
  audio: AudioEnergyLayer,
  threshold: number,
  duration = Infinity,
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
      && spanAllowed(end - sorted[i - 1].start, sorted[i - 1].composite, threshold)) {
      i--;
      start = sorted[i].start;
    }
    let j = pi;
    while (j + 1 < sorted.length && sorted[j + 1].composite >= floor
      && spanAllowed(sorted[j + 1].end - start, sorted[j + 1].composite, threshold)) {
      j++;
      end = sorted[j].end;
    }

    // Snap to sentence boundaries, trim a cold open, clamp to 15-60s, and cap at real duration.
    start = coldOpenTrim(snapStart(start, segments), audio.silence_regions);
    end = snapEnd(end, segments);
    ({ start, end } = clampDuration(start, end));
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
