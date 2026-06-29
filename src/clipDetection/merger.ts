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

export function clampDuration(start: number, end: number): { start: number; end: number } {
  let e = end;
  if (e - start > 90) e = start + 90;          // hard cap
  if (e - start < 30) e = start + 30;          // pull up short clips
  return { start, end: e };
}

export function buildClips(
  windows: WindowScore[], segments: TranscriptSegment[], audio: AudioEnergyLayer, threshold: number,
): ClipCandidate[] {
  const floor = threshold * 0.7;
  const peaks = windows.filter((w) => w.composite >= threshold).sort((a, b) => b.composite - a.composite);
  const clips: ClipCandidate[] = [];

  for (const peak of peaks) {
    // expand left/right while neighbors stay above floor
    let start = peak.start;
    let end = peak.end;
    for (const w of windows) {
      if (w.end <= start && w.composite >= floor && start - w.start <= 5) start = w.start;
      if (w.start >= end && w.composite >= floor && w.end - end <= 5) end = w.end;
    }
    // snap + cold-open + clamp
    start = coldOpenTrim(snapStart(start, segments), audio.silence_regions);
    end = snapEnd(end, segments);
    ({ start, end } = clampDuration(start, end));

    // IOU>0.5 merge against existing
    const overlaps = clips.some((c) => {
      const inter = Math.max(0, Math.min(c.end, end) - Math.max(c.start, start));
      const union = Math.max(c.end, end) - Math.min(c.start, start);
      return union > 0 && inter / union > 0.5;
    });
    if (overlaps) continue;

    clips.push({ start, end, composite: peak.composite, triggerScore: peak.triggerScore, audioScore: peak.audioScore });
  }
  return clips;
}
