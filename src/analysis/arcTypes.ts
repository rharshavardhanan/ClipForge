/**
 * Micro-story arc helpers (v7) — pure validation and scoring over ArcLabel.
 * Components may be brief (>=0.5s) or overlap/nest; the parser is LENIENT
 * (malformed spans are dropped, partial arcs are legal) — strictness lives in
 * the 6/6 gate (arcCompleter), not here.
 */
import type { ArcComponentName, ArcComponents, ArcLabel, ArcSpan } from '../types/index.js';
import { clamp01 } from '../avss/editPlan.js';

export const ARC_COMPONENT_NAMES: ArcComponentName[] =
  ['setup', 'trigger', 'escalation', 'peak', 'payoff', 'reaction'];
export const MIN_COMPONENT_SEC = 0.5;
const REACTION_AFTER_PEAK_BONUS = 1.15;

/** PURE: absent component names in canonical order. */
export function missingComponents(c: ArcComponents): ArcComponentName[] {
  return ARC_COMPONENT_NAMES.filter((k) => !c[k]);
}

/** PURE: min start → max end over present spans; null when none. */
export function arcOuterSpan(c: ArcComponents): ArcSpan | null {
  const spans = ARC_COMPONENT_NAMES.flatMap((k) => (c[k] ? [c[k] as ArcSpan] : []));
  if (spans.length === 0) return null;
  return {
    start: Math.min(...spans.map((s) => s.start)),
    end: Math.max(...spans.map((s) => s.end)),
  };
}

function validSpan(s: unknown, durationSec: number): s is ArcSpan {
  const sp = s as ArcSpan;
  return typeof sp?.start === 'number' && typeof sp?.end === 'number'
    && sp.start >= 0 && sp.end <= durationSec
    && sp.end - sp.start >= MIN_COMPONENT_SEC;
}

/** PURE: shape-check one LLM-returned arc. Malformed components are dropped;
 *  a label with zero valid components, no synopsis, or non-numeric confidence → null. */
export function validateArc(raw: unknown, durationSec: number): ArcLabel | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.synopsis !== 'string' || r.synopsis.trim() === '') return null;
  if (typeof r.confidence !== 'number' || Number.isNaN(r.confidence)) return null;
  const rawComponents = (r.components ?? {}) as Record<string, unknown>;
  const components: ArcComponents = {};
  for (const k of ARC_COMPONENT_NAMES) {
    if (validSpan(rawComponents[k], durationSec)) components[k] = rawComponents[k] as ArcSpan;
  }
  if (Object.keys(components).length === 0) return null;
  return {
    synopsis: r.synopsis.trim(),
    confidence: clamp01(r.confidence),
    components,
    ...(typeof r.reactionAfterPeak === 'boolean' ? { reactionAfterPeak: r.reactionAfterPeak } : {}),
  };
}

/** PURE: coerce one span in Gemini's loose shapes — "12.9-31.3" strings or
 *  string-number fields — into {start, end} numbers; anything else untouched. */
function normalizeSpan(s: unknown): unknown {
  if (typeof s === 'string') {
    const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*$/);
    return m ? { start: Number(m[1]), end: Number(m[2]) } : s;
  }
  const sp = s as { start?: unknown; end?: unknown };
  if (sp && typeof sp === 'object' && sp.start !== undefined && sp.end !== undefined) {
    const start = Number(sp.start);
    const end = Number(sp.end);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }
  return s;
}

/**
 * PURE: Gemini-first tolerance layer — free-tier Gemini gets no schema
 * enforcement (unlike Claude structured outputs) and returns structurally
 * loose JSON: component keys flattened at the item root, spans as "a-b"
 * strings, synopsis/confidence omitted. Coerce those into the canonical shape
 * BEFORE the strict validateArc; missing confidence becomes the 0.5 neutral
 * prior, missing synopsis a placeholder. Garbage stays garbage (still
 * rejected downstream).
 */
export function normalizeArcRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const components: Record<string, unknown> = { ...((r.components as Record<string, unknown>) ?? {}) };
  for (const k of ARC_COMPONENT_NAMES) {
    if (r[k] !== undefined && components[k] === undefined) components[k] = r[k];   // flattened keys
  }
  for (const k of Object.keys(components)) components[k] = normalizeSpan(components[k]);
  r.components = components;
  if (r.bounds !== undefined) r.bounds = normalizeSpan(r.bounds);
  const conf = Number(r.confidence);
  if (typeof r.confidence !== 'number') r.confidence = Number.isFinite(conf) && typeof r.confidence === 'string' ? conf : 0.5;
  if (typeof r.synopsis !== 'string' || r.synopsis.trim() === '') r.synopsis = 'micro-story';
  return r;
}

/** PURE: spec §5 — confidence × completenessFraction × reaction bonus, clamped. */
export function arcScore(label: Pick<ArcLabel, 'confidence' | 'components' | 'reactionAfterPeak'>): number {
  const completeness = (6 - missingComponents(label.components).length) / 6;
  return clamp01(label.confidence * completeness * (label.reactionAfterPeak ? REACTION_AFTER_PEAK_BONUS : 1));
}
