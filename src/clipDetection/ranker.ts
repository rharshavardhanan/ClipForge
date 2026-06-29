import type { ClipCandidate, RankedClip, TranscriptSegment, WindowScore } from '../types/index.js';

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

export function rank(
  candidates: ClipCandidate[], segments: TranscriptSegment[], opts: { top: number; minScore?: number },
): RankedClip[] {
  const min = opts.minScore ?? 0;
  const sorted = [...candidates].filter((c) => c.composite >= min).sort((a, b) => b.composite - a.composite);

  const kept: { cand: ClipCandidate; text: string }[] = [];
  for (const cand of sorted) {
    const text = clipText(cand, segments);
    if (kept.some((k) => overlapRatio(k.text, text) > 0.4)) continue;
    kept.push({ cand, text });
  }

  return kept.slice(0, opts.top).map(({ cand, text }, i) => {
    const duration = +(cand.end - cand.start).toFixed(2);
    return {
      rank: i + 1,
      clip_id: `clip_${String(i + 1).padStart(3, '0')}`,
      start: cand.start, end: cand.end, duration,
      composite_score: +cand.composite.toFixed(2),
      semantic_score: 0, audio_score: +cand.audioScore.toFixed(2), visual_score: 0,
      trigger_score: +cand.triggerScore.toFixed(2), pacing_score: 0, metadata_score: 0,
      hook_moment: '', clip_titles: [], is_standalone: true,
      recommended_duration: duration <= 35 ? 30 : duration <= 50 ? 45 : duration <= 75 ? 60 : 90,
      reason: `trigger=${cand.triggerScore.toFixed(1)}, audio=${cand.audioScore.toFixed(1)}`,
      transcript_excerpt: text.slice(0, 200),
    };
  });
}
