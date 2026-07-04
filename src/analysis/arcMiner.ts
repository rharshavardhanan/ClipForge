/**
 * Arc mining (recall pass, v7) — one LLM call per transcript chunk returns complete
 * micro-stories; validated labels merge into the scorer's candidate pool.
 * Cache: layer_arcs_<provider>.json, per-chunk incremental (failed chunks are
 * NOT cached so a re-run retries them).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { askVisionJson, type AskVisionFn } from '../broll/llmJson.js';
import { arcOuterSpan, arcScore, normalizeArcRaw, validateArc, ARC_COMPONENT_NAMES } from './arcTypes.js';
import type { TranscriptChunk } from './arcChunker.js';
import type { ArcLabel, ArcSpan, ClipCandidate } from '../types/index.js';
import type { ContentMode } from '../modes.js';
import { logger } from '../utils/logger.js';

const MODE_VOCAB: Record<ContentMode, string> = {
  clippies: 'challenge setup, joke setup, fail setup, rage escalation, scream/reaction payoff. Never isolate a scream — the story is: sees challenge → tries → fails → reacts.',
  mindcuts: 'hook, explanation, escalation, insight/payoff. Never a quote without its story: the arc is struggle → turn → insight.',
};

const SPAN_SCHEMA = {
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

/** PURE: the mining prompt for one chunk. */
export function miningPrompt(chunk: TranscriptChunk, evidence: string, mode: ContentMode, maxSpanSec?: number): string {
  const transcript = chunk.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  return [
    `Find 0-4 COMPLETE micro-stories in this ${mode} source segment.`,
    'A micro-story has ALL SIX components: setup, trigger, escalation, peak, payoff, reaction.',
    'Components may be brief (>=0.5s) or overlap/nest (a trigger inside setup, escalation coinciding with peak) — identify all six or omit the story.',
    `Mode vocabulary: ${MODE_VOCAB[mode]}`,
    ...(maxSpanSec ? [`HARD LIMIT: each micro-story must span at most ${maxSpanSec} seconds from setup start to reaction end — longer stories are rejected downstream.`] : []),
    'Times are source-absolute seconds. Set reactionAfterPeak true when a clear reaction FOLLOWS the peak (weight those stories higher).',
    'Return ONLY JSON in EXACTLY this shape (numbers in seconds, every key shown):',
    '{"arcs":[{"synopsis":"one line","confidence":0.8,"reactionAfterPeak":true,'
      + '"components":{"setup":{"start":12.9,"end":31.3},"trigger":{"start":31.3,"end":36.8},'
      + '"escalation":{"start":36.8,"end":57.4},"peak":{"start":57.4,"end":77.8},'
      + '"payoff":{"start":77.8,"end":93.6},"reaction":{"start":93.6,"end":110.3}}}]}',
    '', 'TRANSCRIPT:', transcript, '', 'SIGNAL EVIDENCE:', evidence,
  ].join('\n');
}

/** PURE: overlap seconds / the smaller span's length. */
export function overlapFraction(a: ArcSpan, b: ArcSpan): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const minLen = Math.min(a.end - a.start, b.end - b.start);
  return minLen > 0 ? overlap / minLen : 0;
}

interface ArcCache { chunks: Record<string, ArcLabel[]>; }

async function loadCache(path: string): Promise<ArcCache> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    if (j && typeof j.chunks === 'object') return j as ArcCache;
  } catch { /* cold */ }
  return { chunks: {} };
}

export interface MineOpts {
  cachePath: string;
  durationSec: number;
  mode: ContentMode;
  /** Mode envelope max, stated in the prompt so mined stories fit. */
  maxSpanSec?: number;
  /** Test seam; default askVisionJson (text-only here). */
  ask?: AskVisionFn;
}

export async function mineArcs(
  chunks: TranscriptChunk[], evidenceFor: (c: TranscriptChunk) => string, opts: MineOpts,
): Promise<ArcLabel[]> {
  const ask = opts.ask ?? askVisionJson;
  const cache = await loadCache(opts.cachePath);
  const out: ArcLabel[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.start}-${chunk.end}`;
    let labels = cache.chunks[key];
    if (!labels) {
      const raw = await ask({
        system: 'You are a top YouTube Shorts story editor. You find complete micro-stories, never isolated moments.',
        prompt: miningPrompt(chunk, evidenceFor(chunk), opts.mode, opts.maxSpanSec),
        schema: ARC_MINE_SCHEMA as unknown as Record<string, unknown>,
        label: `arc-mine ${key}`,
      });
      // Gemini-first tolerance: a top-level array IS the arcs list (free-tier Gemini
      // frequently drops the {"arcs": ...} wrapper despite the stated shape).
      const arr = Array.isArray(raw) ? raw
        : Array.isArray((raw as { arcs?: unknown[] })?.arcs) ? (raw as { arcs: unknown[] }).arcs : null;
      if (arr === null) {
        logger.warn(`[arc-mine ${key}] chunk failed — no arcs from this chunk (will retry next run)`);
        continue;                                    // NOT cached → retryable
      }
      labels = arr.map((a) => validateArc(normalizeArcRaw(a), opts.durationSec)).filter((a): a is ArcLabel => a !== null);
      cache.chunks[key] = labels;
      await mkdir(dirname(opts.cachePath), { recursive: true });
      await writeFile(opts.cachePath, JSON.stringify(cache, null, 2));  // incremental
    }
    out.push(...labels);
  }
  return out;
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
