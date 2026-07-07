/**
 * Arc-template candidate detectors (v4 Part 2 §3.2) — pure heuristics that surface clip
 * candidates the 30s sliding window misses because they're anchored to narrative structure,
 * not a grid: Q&A exchanges (question → answer), reaction/punchline moments (a strong trigger
 * with setup before + tail after), and real audience reactions (laughter/applause/cheer from
 * the perception audio layer, same setup+tail shape — SP1 1c). Emitted candidates merge into
 * the pool and flow through the unchanged rank → 6/6 arc gate → select → tighten → render path;
 * the gate still decides whether each is a real story. No LLM — works even with the semantic
 * layer off (audience detector no-ops on an empty event list).
 */
import type { AudioEnergyLayer, ClipCandidate, TranscriptSegment, TriggerHit } from '../types/index.js';
import type { ClipLengths } from '../modes.js';
import { overlapFraction } from '../analysis/arcMiner.js';
import type { AudioEvent } from '../perception/timeline.js';

export const TEMPLATE_QA_BONUS = 1.0;
export const TEMPLATE_REACTION_BONUS = 1.5;
export const TEMPLATE_AUDIENCE_BONUS = 1.5;
export const AUDIENCE_SCORE_MIN = 0.5;
export const AUDIENCE_MAX_CANDIDATES = 12;
export const TEMPLATE_MERGE_OVERLAP = 0.5;

const AUDIENCE_KINDS = new Set<AudioEvent['kind']>(['laughter', 'applause', 'cheer']);

const INTERROGATIVE = /^(what|why|how|when|where|who|which|is|are|do|does|did|can|could|would|should|will|has|have)$/i;

/** PURE: is this text a question — ends with '?' or opens with an interrogative word. */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  const first = t.split(/\s+/)[0].replace(/[^a-z]/gi, '');
  return INTERROGATIVE.test(first);
}

/** PURE: composite for an arbitrary span (windowScorer no-semantic fallback shape + bonus). */
export function spanComposite(
  start: number, end: number, triggers: TriggerHit[], audio: AudioEnergyLayer, bonus: number,
): { composite: number; triggerScore: number; audioScore: number } {
  const triggerScore = Math.min(10, triggers.filter((t) => t.time >= start && t.time < end).reduce((a, t) => a + t.weight, 0));
  const pts = audio.rms_curve.filter((p) => p.time >= start && p.time < end);
  const audioScore = pts.length ? pts.reduce((a, p) => a + p.rms, 0) / pts.length : 0;
  const composite = Math.min(10, triggerScore * 0.6 + audioScore * 0.4 + bonus);
  return { composite, triggerScore, audioScore };
}

/** Clamp a span's length into [min,max] by extending/trimming the END, bounded by duration. */
function clampSpan(start: number, end: number, lengths: ClipLengths, duration: number): { start: number; end: number } {
  let e = Math.min(duration, Math.max(end, start + lengths.min));
  if (e - start > lengths.max) e = start + lengths.max;
  return { start, end: e };
}

/** PURE: question segment + following answer → one candidate spanning both. */
export function detectQaCandidates(
  segments: TranscriptSegment[], triggers: TriggerHit[], audio: AudioEnergyLayer, lengths: ClipLengths, duration: number,
): ClipCandidate[] {
  const out: ClipCandidate[] = [];
  for (const q of segments) {
    if (!isQuestion(q.text)) continue;
    const desiredEnd = Math.min(duration, q.start + lengths.soft);
    // require a real answer: a segment that starts after the question and within the span
    const hasAnswer = segments.some((s) => s.start >= q.end - 0.01 && s.start < desiredEnd);
    if (!hasAnswer) continue;
    const span = clampSpan(q.start, desiredEnd, lengths, duration);
    if (span.end - span.start < lengths.min) continue;
    const sc = spanComposite(span.start, span.end, triggers, audio, TEMPLATE_QA_BONUS);
    out.push({ start: span.start, end: span.end, ...sc });
  }
  return out;
}

/** PURE: each Tier-1 trigger anchors a reaction/punchline candidate (setup before + tail after). */
export function detectReactionCandidates(
  segments: TranscriptSegment[], triggers: TriggerHit[], audio: AudioEnergyLayer, lengths: ClipLengths, duration: number,
): ClipCandidate[] {
  const out: ClipCandidate[] = [];
  for (const t of triggers) {
    if (t.tier !== 1) continue;
    const start = Math.max(0, t.time - lengths.soft * 0.6);
    const end = Math.min(duration, t.time + lengths.soft * 0.4);
    const span = clampSpan(start, end, lengths, duration);
    if (span.end - span.start < lengths.min) continue;
    const sc = spanComposite(span.start, span.end, triggers, audio, TEMPLATE_REACTION_BONUS);
    out.push({ start: span.start, end: span.end, ...sc });
  }
  return out;
}

/** PURE: real audience reactions (laughter/applause/cheer from perception) anchor
 *  reaction candidates the transcript can't see — setup before + tail after, exactly the
 *  Tier-1 trigger shape. Strongest events win; capped so laugh-track footage can't spam. */
export function detectAudienceReactionCandidates(
  events: AudioEvent[], triggers: TriggerHit[], audio: AudioEnergyLayer, lengths: ClipLengths, duration: number,
): ClipCandidate[] {
  const anchors = events
    .filter((e) => AUDIENCE_KINDS.has(e.kind) && e.score >= AUDIENCE_SCORE_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, AUDIENCE_MAX_CANDIDATES);
  const out: ClipCandidate[] = [];
  for (const e of anchors) {
    const start = Math.max(0, e.start - lengths.soft * 0.6);
    const end = Math.min(duration, e.start + lengths.soft * 0.4);
    const span = clampSpan(start, end, lengths, duration);
    if (span.end - span.start < lengths.min) continue;
    const sc = spanComposite(span.start, span.end, triggers, audio, TEMPLATE_AUDIENCE_BONUS);
    out.push({ start: span.start, end: span.end, ...sc });
  }
  return out;
}

/** PURE: all templates combined (Q&A, Tier-1 trigger reactions, real audience reactions). */
export function generateArcTemplateCandidates(
  segments: TranscriptSegment[], triggers: TriggerHit[], audio: AudioEnergyLayer,
  lengths: ClipLengths, duration: number, audioEvents: AudioEvent[] = [],
): ClipCandidate[] {
  return [
    ...detectQaCandidates(segments, triggers, audio, lengths, duration),
    ...detectReactionCandidates(segments, triggers, audio, lengths, duration),
    ...detectAudienceReactionCandidates(audioEvents, triggers, audio, lengths, duration),
  ];
}

/** PURE: fold template candidates into an existing pool, dropping ones already covered
 *  (≥ TEMPLATE_MERGE_OVERLAP overlap with an existing candidate). Mirrors the arc-miner dedupe. */
export function mergeTemplateCandidates(existing: ClipCandidate[], templates: ClipCandidate[]): ClipCandidate[] {
  const out = [...existing];
  for (const t of templates) {
    const covered = existing.some((c) => overlapFraction({ start: c.start, end: c.end }, { start: t.start, end: t.end }) >= TEMPLATE_MERGE_OVERLAP);
    if (!covered) out.push(t);
  }
  return out;
}
