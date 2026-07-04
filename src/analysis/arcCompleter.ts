/**
 * Arc completion (precision pass, v7) — one vision-capable LLM call per top-K
 * candidate labels all six story components and proposes expanded bounds
 * (backward >=3s to the cause, forward >=3s to the reaction — context beats
 * shortness). resolveBounds clamps proposals to the mode envelope, the
 * sentence-aware rule, and used_ranges; gateArc enforces STRICT 6/6.
 */
import { askVisionJson, type AskVisionFn, type VisionImage } from '../broll/llmJson.js';
import { arcOuterSpan, missingComponents, normalizeArcRaw, validateArc, ARC_COMPONENT_NAMES } from './arcTypes.js';
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
  additionalProperties: false,
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
      additionalProperties: false,
    },
    bounds: SPAN_SCHEMA,
  },
  required: ['synopsis', 'confidence', 'components', 'bounds'],
  additionalProperties: false,
};

/** PURE: the completion prompt for one candidate window. */
export function completionPrompt(opts: {
  window: ArcSpan;
  contextSegments: TranscriptSegment[];
  evidence: string;
  priorArc?: ArcLabel;
  mode: ContentMode;
  hasImages: boolean;
  /** Mode envelope max — stated so the model finds arcs that FIT (longer arcs are rejected). */
  maxSec?: number;
}): string {
  const transcript = opts.contextSegments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  return [
    `A candidate ${opts.mode} clip spans ${opts.window.start.toFixed(1)}-${opts.window.end.toFixed(1)}s.`,
    'Identify ALL SIX micro-story components inside or around it: setup, trigger, escalation, peak, payoff, reaction.',
    'Components may be brief (>=0.5s) or overlap/nest. Times are source-absolute seconds.',
    'Propose bounds: expand backward at least 3s to include the cause/setup and forward at least 3s to include the result/reaction when the story is incomplete. Context beats shortness.',
    ...(opts.maxSec ? [`HARD LIMIT: the final clip can be AT MOST ${opts.maxSec} seconds long. All six components AND the bounds must fit inside one ${opts.maxSec}s window — a story that cannot fit is not a valid answer.`] : []),
    'Set reactionAfterPeak true when a clear reaction FOLLOWS the peak.',
    'Return ONLY JSON in EXACTLY this shape (numbers in seconds, every key shown):',
    '{"synopsis":"one line","confidence":0.8,"reactionAfterPeak":true,'
      + '"components":{"setup":{"start":18.0,"end":24.0},"trigger":{"start":23.0,"end":24.0},'
      + '"escalation":{"start":24.0,"end":28.0},"peak":{"start":28.0,"end":30.0},'
      + '"payoff":{"start":30.0,"end":33.0},"reaction":{"start":33.0,"end":38.0}},'
      + '"bounds":{"start":18.0,"end":40.0}}',
    ...(opts.priorArc ? ['', `A previous pass suggested: ${JSON.stringify(opts.priorArc.components)}`] : []),
    ...(opts.hasImages ? ['', 'Frames from the clip are attached in time order — use them to see silent/visual action.'] : []),
    '', 'TRANSCRIPT (context around the candidate):', transcript, '', 'SIGNAL EVIDENCE:', opts.evidence,
  ].join('\n');
}

/** PURE: parse one completion response. `missing` is COMPUTED from the
 *  components, never trusted from the model. Null on structural garbage. */
export function parseCompletion(rawIn: unknown, durationSec: number): ArcCompletion | null {
  const raw = normalizeArcRaw(rawIn);
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
export function resolveBounds(
  c: ArcCompletion, ctx: BoundsCtx,
): { start: number; end: number } | { reject: 'overlap' | 'envelope' } {
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
  const clamped = clampToSentences(start, end, ctx.segments, ctx.envelope);
  // The envelope/sentence clamp is a HARD constraint — an arc it cannot contain
  // must be rejected, never silently truncated into a story missing its reaction
  // (live-smoke bug: a 97s arc exported "complete" with the reaction cut off).
  if (clamped.start > outer.start || clamped.end < outer.end) return { reject: 'envelope' };
  return clamped;
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
  /** Mode envelope max, stated in the prompt. */
  maxSec?: number;
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
      maxSec: opts.maxSec,
    }),
    schema: ARC_COMPLETE_SCHEMA as unknown as Record<string, unknown>,
    label: `arc-complete ${opts.window.start.toFixed(0)}-${opts.window.end.toFixed(0)}`,
    images: opts.images,
  });
  return parseCompletion(raw, opts.durationSec);
}
