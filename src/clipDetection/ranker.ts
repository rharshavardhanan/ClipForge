import type { ArcLabel, ClipCandidate, RankedClip, SemanticScores, SemanticWindow, TranscriptSegment, WindowScore } from '../types/index.js';
import { arcScore } from '../analysis/arcTypes.js';
import { fillerRatio } from '../analysis/filler.js';
import { meanImportance01 } from '../understanding/assemble.js';
import { IMPORTANCE_SORT_WEIGHT, type ImportancePoint } from '../understanding/types.js';

/** Sort-key penalty per unit filler ratio (v4 Slice B) — a rambling, filler-dense candidate
 *  ranks below a tight one. Sort-only, like the mode priority boost; composite is untouched. */
export const FILLER_PENALTY_WEIGHT = 2.0;

/** PURE: v7 spec §5 — for ARC-LABELED candidates, story completeness joins the
 *  composite at weight 0.25 (renormalized). Unlabeled candidates keep their raw
 *  composite so no-LLM runs behave exactly as before; the 6/6 gate — not this
 *  weighting — is what keeps incomplete stories from exporting. */
export function arcWeightedComposite(composite: number, arc?: ArcLabel): number {
  return arc ? 0.75 * composite + 0.25 * (10 * arcScore(arc)) : composite;
}

export function defaultMinScore(windows: WindowScore[]): number {
  if (!windows.length) return 0;
  const xs = windows.map((w) => w.composite);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return mean + 0.5 * Math.sqrt(variance);
}

export function clipText(clip: { start: number; end: number }, segments: TranscriptSegment[]): string {
  return segments.filter((s) => s.end > clip.start && s.start < clip.end).map((s) => s.text).join(' ').trim();
}

function overlapRatio(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  // Denominator is the smaller word-set: a clip whose transcript is a subset of another
  // is treated as a near-duplicate (aggressive dedup, by design).
  return shared / Math.min(wa.size, wb.size);
}

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

/** PURE: mode-priority boost — mean of the prioritized semantic sub-scores, scaled to ≤1.5.
 *  Reorders ranking toward the active mode's grammar without touching the reported composite. */
export function priorityBoost(sw: SemanticWindow | null, priorities?: (keyof SemanticScores)[]): number {
  if (!sw || !priorities || priorities.length === 0) return 0;
  const mean = priorities.reduce((a, k) => a + (sw.scores[k] ?? 0), 0) / priorities.length;
  return 1.5 * (mean / 10);
}

export function rank(
  candidates: ClipCandidate[],
  segments: TranscriptSegment[],
  opts: { top: number; minScore?: number; priorities?: (keyof SemanticScores)[]; importance?: ImportancePoint[] },
  semantic: SemanticWindow[] = [],
): RankedClip[] {
  const min = opts.minScore ?? 0;
  const scored = [...candidates]
    .filter((c) => c.composite >= min)
    .map((cand) => {
      const sw = semantic.length > 0 ? findOverlappingSemantic(cand.start, cand.end, semantic) : null;
      const text = clipText(cand, segments);
      const adjusted = arcWeightedComposite(cand.composite, cand.arc)
        + priorityBoost(sw, opts.priorities)
        - FILLER_PENALTY_WEIGHT * fillerRatio(text)
        // SP2: understanding importance — sort-only like the mode boost; composite untouched.
        + IMPORTANCE_SORT_WEIGHT * meanImportance01(opts.importance ?? [], cand.start, cand.end);
      return { cand, sw, text, adjusted };
    })
    .sort((a, b) => b.adjusted - a.adjusted);

  const kept: { cand: ClipCandidate; text: string; sw: SemanticWindow | null }[] = [];
  for (const { cand, sw, text } of scored) {
    if (kept.some((k) => overlapRatio(k.text, text) > 0.4)) continue;
    // Drop non-standalone clips that aren't otherwise strong enough — only when semantic data exists.
    if (semantic.length > 0 && sw && sw.is_standalone === false && cand.composite < 7) continue;
    kept.push({ cand, text, sw });
  }

  return kept.slice(0, opts.top).map(({ cand, text, sw }, i) => {
    const duration = +(cand.end - cand.start).toFixed(2);
    const fallbackReason = `trigger=${cand.triggerScore.toFixed(1)}, audio=${cand.audioScore.toFixed(1)}`;
    return {
      rank: i + 1,
      clip_id: `clip_${String(i + 1).padStart(3, '0')}`,
      start: cand.start, end: cand.end, duration,
      composite_score: +arcWeightedComposite(cand.composite, cand.arc).toFixed(2),
      ...(cand.arc ? { arc: cand.arc } : {}),
      semantic_score: sw ? +sw.semantic_score.toFixed(2) : 0, audio_score: +cand.audioScore.toFixed(2), visual_score: 0,
      trigger_score: +cand.triggerScore.toFixed(2), pacing_score: 0, metadata_score: +(cand.commentScore ?? 0).toFixed(2),
      hook_moment: sw ? sw.hook_moment : '', clip_titles: sw ? sw.clip_titles : [],
      is_standalone: sw ? sw.is_standalone : true,
      recommended_duration: sw ? Math.min(60, sw.recommended_duration) : (duration <= 18 ? 15 : duration <= 24 ? 20 : 30),
      reason: sw ? sw.reason : fallbackReason,
      transcript_excerpt: text.slice(0, 200),
      sentiment: sw ? sw.sentiment : undefined,
    };
  });
}
