import type { AudioEnergyLayer, SemanticWindow, TriggerHit, WindowScore } from '../types/index.js';
import type { CommentBoost } from '../analysis/commentSignals.js';

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
  comments: CommentBoost[] = [],
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
    const commentSum = comments.filter((b) => b.time >= start && b.time < end).reduce((a, b) => a + b.weight, 0);
    const commentScore = Math.min(10, commentSum);
    const base = semantic.length > 0
      ? semanticScore * 0.5 + audioScore * 0.3 + triggerScore * 0.2
      : triggerScore * 0.6 + audioScore * 0.4;
    // Viewer-flagged moments are an additive bonus (max +1.5) so the score is unchanged
    // when comments are unavailable (cached pre-comment downloads, non-YT sources).
    const composite = base + commentScore * 0.15;
    windows.push({ start, end, triggerScore, audioScore, semanticScore, commentScore, composite });
  }
  return windows;
}
