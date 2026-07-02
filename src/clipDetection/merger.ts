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

// Short-form retention: keep clips punchy. Under ~30s holds viewers far better than 60-90s.
export const MAX_CLIP_SEC = 30;
export const MIN_CLIP_SEC = 15;

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

    // Expand outward over consecutive windows whose composite stays >= floor, capped at MAX_CLIP_SEC.
    let i = pi;
    while (i - 1 >= 0 && sorted[i - 1].composite >= floor && end - sorted[i - 1].start <= MAX_CLIP_SEC) {
      i--;
      start = sorted[i].start;
    }
    let j = pi;
    while (j + 1 < sorted.length && sorted[j + 1].composite >= floor && sorted[j + 1].end - start <= MAX_CLIP_SEC) {
      j++;
      end = sorted[j].end;
    }

    // Snap to sentence boundaries, trim a cold open, clamp to 30-90s, and cap at real duration.
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
