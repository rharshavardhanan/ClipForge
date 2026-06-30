import type { AudioEnergyLayer, SemanticWindow, TriggerHit, WindowScore } from '../types/index.js';

const WINDOW = 30;
const STEP = 15;

/** Returns the SemanticWindow with the greatest time-overlap against [start, end), or null if none overlap. */
function findOverlappingSemantic(
  start: number, end: number, semantic: SemanticWindow[],
): SemanticWindow | null {
  let best: SemanticWindow | null = null;
  let bestOverlap = 0;
  for (const sw of semantic) {
    const overlap = Math.max(0, Math.min(end, sw.end) - Math.max(start, sw.start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = sw;
    }
  }
  return best;
}

export function scoreWindows(
  duration: number, triggers: TriggerHit[], audio: AudioEnergyLayer, semantic: SemanticWindow[] = [],
): WindowScore[] {
  const windows: WindowScore[] = [];
  for (let start = 0; start < duration; start += STEP) {
    const end = Math.min(start + WINDOW, duration);
    const triggerSum = triggers.filter((t) => t.time >= start && t.time < end).reduce((a, t) => a + t.weight, 0);
    const triggerScore = Math.min(10, triggerSum);
    const pts = audio.rms_curve.filter((p) => p.time >= start && p.time < end);
    const audioScore = pts.length ? pts.reduce((a, p) => a + p.rms, 0) / pts.length : 0;
    const overlapping = findOverlappingSemantic(start, end, semantic);
    const semanticScore = overlapping ? overlapping.semantic_score : 0;
    const composite = semantic.length > 0
      ? semanticScore * 0.5 + audioScore * 0.3 + triggerScore * 0.2
      : triggerScore * 0.6 + audioScore * 0.4;
    windows.push({ start, end, triggerScore, audioScore, semanticScore, composite });
  }
  return windows;
}
