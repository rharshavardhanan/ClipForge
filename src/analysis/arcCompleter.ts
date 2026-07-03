/**
 * Arc completion (precision pass, v7) — one vision-capable LLM call per top-K
 * candidate labels all six story components and proposes expanded bounds
 * (backward >=3s to the cause, forward >=3s to the reaction — context beats
 * shortness). resolveBounds clamps proposals to the mode envelope, the
 * sentence-aware rule, and used_ranges; gateArc enforces STRICT 6/6.
 */
import { askVisionJson, type AskVisionFn, type VisionImage } from '../broll/llmJson.js';
import { arcOuterSpan, missingComponents, validateArc, ARC_COMPONENT_NAMES } from './arcTypes.js';
import { clampToSentences } from '../clipDetection/merger.js';
import type { UsedRange } from '../clipDetection/usedRanges.js';
import type { ClipLengths, ContentMode } from '../modes.js';
import type { ArcComponentName, ArcComponents, ArcLabel, ArcSpan, TranscriptSegment } from '../types/index.js';

export interface ArcCompletion {
  components: ArcComponents;
  missing: ArcComponentName[];
  bounds: ArcSpan;
  confidence: number;
  synopsis: string;
  reactionAfterPeak: boolean;
}

const SPAN_SCHEMA = {
  type: 'object',
  properties: { start: { type: 'number' }, end: { type: 'number' } },
  required: ['start', 'end'],
} as const;

export const ARC_COMPLETE_SCHEMA = {
  type: 'object',
  properties: {
    synopsis: { type: 'string' },
    confidence: { type: 'number' },
    reactionAfterPeak: { type: 'boolean' },
    components: {
      type: 'object',
      properties: Object.fromEntries(ARC_COMPONENT_NAMES.map((k) => [k, SPAN_SCHEMA])),
      required: [...ARC_COMPONENT_NAMES],
    },
    bounds: SPAN_SCHEMA,
  },
  required: ['synopsis', 'confidence', 'components', 'bounds'],
};

/** PURE: the completion prompt for one candidate window. */
export function completionPrompt(opts: {
  window: ArcSpan;
  contextSegments: TranscriptSegment[];
  evidence: string;
  priorArc?: ArcLabel;
  mode: ContentMode;
  hasImages: boolean;
}): string {
  const transcript = opts.contextSegments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  return [
    `A candidate ${opts.mode} clip spans ${opts.window.start.toFixed(1)}-${opts.window.end.toFixed(1)}s.`,
    'Identify ALL SIX micro-story components inside or around it: setup, trigger, escalation, peak, payoff, reaction.',
    'Components may be brief (>=0.5s) or overlap/nest. Times are source-absolute seconds.',
    'Propose bounds: expand backward at least 3s to include the cause/setup and forward at least 3s to include the result/reaction when the story is incomplete. Context beats shortness.',
    'Set reactionAfterPeak true when a clear reaction FOLLOWS the peak.',
    ...(opts.priorArc ? ['', `A previous pass suggested: ${JSON.stringify(opts.priorArc.components)}`] : []),
    ...(opts.hasImages ? ['', 'Frames from the clip are attached in time order — use them to see silent/visual action.'] : []),
    '', 'TRANSCRIPT (context around the candidate):', transcript, '', 'SIGNAL EVIDENCE:', opts.evidence,
  ].join('\n');
}

/** PURE: parse one completion response. `missing` is COMPUTED from the
 *  components, never trusted from the model. Null on structural garbage. */
export function parseCompletion(raw: unknown, durationSec: number): ArcCompletion | null {
  const label = validateArc(raw, durationSec);
  if (!label) return null;
  const bounds = (raw as { bounds?: unknown }).bounds as ArcSpan | undefined;
  if (typeof bounds?.start !== 'number' || typeof bounds?.end !== 'number' || bounds.end <= bounds.start) return null;
  return {
    components: label.components,
    missing: missingComponents(label.components),
    bounds: { start: bounds.start, end: bounds.end },
    confidence: label.confidence,
    synopsis: label.synopsis,
    reactionAfterPeak: label.reactionAfterPeak ?? false,
  };
}

export interface BoundsCtx {
  envelope: ClipLengths;
  segments: TranscriptSegment[];
  used: UsedRange[];
  durationSec: number;
}

/** PURE: spec §4 bounds rules — cover the outer component span and the proposed
 *  expansions; a used-range collision pulls the colliding edge to the range
 *  boundary, and if that cuts into any component span the candidate is rejected;
 *  then the sentence-aware clamp applies within the mode envelope. */
export function resolveBounds(c: ArcCompletion, ctx: BoundsCtx): { start: number; end: number } | { reject: 'overlap' } {
  const outer = arcOuterSpan(c.components);
  if (!outer) return { reject: 'overlap' };                    // defensive: parse guarantees >=1 span
  let start = Math.max(0, Math.min(c.bounds.start, outer.start));
  let end = Math.min(ctx.durationSec, Math.max(c.bounds.end, outer.end));
  for (const u of ctx.used) {
    if (u.end <= start || u.start >= end) continue;            // no overlap
    if (u.end <= outer.start) start = Math.max(start, u.end);  // pull the leading edge in
    else if (u.start >= outer.end) end = Math.min(end, u.start); // pull the trailing edge in
    else return { reject: 'overlap' };                         // range straddles a component
  }
  if (start > outer.start || end < outer.end) return { reject: 'overlap' }; // a component got cut
  return clampToSentences(start, end, ctx.segments, ctx.envelope);
}

/** PURE: STRICT 6/6 gate (user mandate). Null completion → arc-label-failed. */
export function gateArc(c: ArcCompletion | null): { pass: boolean; missing: string[] } {
  if (!c) return { pass: false, missing: ['arc-label-failed'] };
  return { pass: c.missing.length === 0, missing: [...c.missing] };
}

export interface CompleteArcOpts {
  window: ArcSpan;
  segments: TranscriptSegment[];       // pre-sliced to window ±60s by the caller
  evidence: string;
  images: VisionImage[];
  priorArc?: ArcLabel;
  mode: ContentMode;
  durationSec: number;
  /** Test seam; default askVisionJson. */
  ask?: AskVisionFn;
}

export async function completeArc(opts: CompleteArcOpts): Promise<ArcCompletion | null> {
  const ask = opts.ask ?? askVisionJson;
  const raw = await ask({
    system: 'You are a top YouTube Shorts story editor. You never cut before the payoff or start mid-story.',
    prompt: completionPrompt({
      window: opts.window, contextSegments: opts.segments, evidence: opts.evidence,
      priorArc: opts.priorArc, mode: opts.mode, hasImages: opts.images.length > 0,
    }),
    schema: ARC_COMPLETE_SCHEMA as unknown as Record<string, unknown>,
    label: `arc-complete ${opts.window.start.toFixed(0)}-${opts.window.end.toFixed(0)}`,
    images: opts.images,
  });
  return parseCompletion(raw, opts.durationSec);
}
