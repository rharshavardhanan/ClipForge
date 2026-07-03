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

/** PURE: spec §5 — confidence × completenessFraction × reaction bonus, clamped. */
export function arcScore(label: Pick<ArcLabel, 'confidence' | 'components' | 'reactionAfterPeak'>): number {
  const completeness = (6 - missingComponents(label.components).length) / 6;
  return clamp01(label.confidence * completeness * (label.reactionAfterPeak ? REACTION_AFTER_PEAK_BONUS : 1));
}
