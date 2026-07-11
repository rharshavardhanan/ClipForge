/**
 * Arc mining constants + merge helper (v7, retained under SP2). The mining CALL itself
 * (mineArcs/miningPrompt) is retired — superseded by the unified understanding pass
 * (src/understanding/engine.ts::runUnderstanding), which returns arcs alongside scenes
 * and edges from one LLM call per chunk. This module keeps the shared vocabulary/schema
 * pieces (reused by the understanding schema so the arc contract can't drift) and the
 * pure candidate-pool merge that both the old and new callers rely on.
 */
import { arcOuterSpan, arcScore, ARC_COMPONENT_NAMES } from './arcTypes.js';
import type { ArcLabel, ArcSpan, ClipCandidate } from '../types/index.js';
import type { ContentMode } from '../modes.js';

export const MODE_VOCAB: Record<ContentMode, string> = {
  clippies: 'challenge setup, joke setup, fail setup, rage escalation, scream/reaction payoff. Never isolate a scream — the story is: sees challenge → tries → fails → reacts.',
  mindcuts: 'hook, explanation, escalation, insight/payoff. Never a quote without its story: the arc is struggle → turn → insight.',
};

export const SPAN_SCHEMA = {
  type: 'object',
  properties: { start: { type: 'number' }, end: { type: 'number' } },
  required: ['start', 'end'],
  additionalProperties: false,
} as const;

export const ARC_MINE_SCHEMA = {
  type: 'object',
  properties: {
    arcs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          synopsis: { type: 'string' },
          confidence: { type: 'number' },
          reactionAfterPeak: { type: 'boolean' },
          components: {
            type: 'object',
            properties: Object.fromEntries(ARC_COMPONENT_NAMES.map((k) => [k, SPAN_SCHEMA])),
            required: [...ARC_COMPONENT_NAMES],
            additionalProperties: false,
          },
        },
        required: ['synopsis', 'confidence', 'components'],
        additionalProperties: false,
      },
    },
  },
  required: ['arcs'],
  additionalProperties: false,
};

/** PURE: overlap seconds / the smaller span's length. */
export function overlapFraction(a: ArcSpan, b: ArcSpan): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const minLen = Math.min(a.end - a.start, b.end - b.start);
  return minLen > 0 ? overlap / minLen : 0;
}

/** PURE: fold mined arcs into the candidate pool (spec §3 dedupe rule): an arc
 *  overlapping an existing candidate ≥50% attaches to it (keeps the candidate's
 *  composite, stronger label wins); a disjoint arc becomes a new candidate. */
export function mergeMinedCandidates(existing: ClipCandidate[], arcs: ArcLabel[]): ClipCandidate[] {
  const out = existing.map((c) => ({ ...c }));
  for (const arc of arcs) {
    const span = arcOuterSpan(arc.components);
    if (!span) continue;
    const host = out.find((c) => overlapFraction({ start: c.start, end: c.end }, span) >= 0.5);
    if (host) {
      if (!host.arc || arcScore(arc) > arcScore(host.arc)) host.arc = arc;
    } else {
      out.push({ start: span.start, end: span.end, composite: 10 * arcScore(arc), triggerScore: 0, audioScore: 0, arc });
    }
  }
  return out;
}
