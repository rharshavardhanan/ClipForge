/**
 * Claude semantic layer — the primary (high-accuracy) viral-scoring brain. Mirrors the
 * Gemini layer's output shape (SemanticWindow[]) so the rest of the pipeline is provider-
 * agnostic, but uses Claude with structured outputs for reliable JSON and higher-quality
 * scoring/hook extraction. Gemini Flash remains the redundant fallback (see semanticEngine).
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import {
  chunkTranscript, batchChunks, buildBatchPrompt, toWindow, SYSTEM_PROMPT, BATCH_SIZE,
  type TranscriptChunk, type SemanticChunkResult,
} from './semantic.js';
import type { TranscriptSegment, SemanticWindow } from '../types/index.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 16000;
const CONCURRENCY = 2;

/** PURE: JSON schema for a batch response — an object wrapping a windows array of strict result objects. */
export function buildBatchSchema(): Record<string, unknown> {
  const scores = {
    type: 'object',
    additionalProperties: false,
    required: [
      'emotional_intensity', 'controversy', 'humor', 'surprise',
      'wisdom', 'storytelling_tension', 'argument_peak', 'relatability',
    ],
    properties: Object.fromEntries(
      ['emotional_intensity', 'controversy', 'humor', 'surprise', 'wisdom', 'storytelling_tension', 'argument_peak', 'relatability']
        .map((k) => [k, { type: 'number' }]),
    ),
  };
  const window = {
    type: 'object',
    additionalProperties: false,
    required: ['scores', 'hook_moment', 'clip_titles', 'is_standalone', 'recommended_duration', 'sentiment', 'reason'],
    properties: {
      scores,
      hook_moment: { type: 'string' },
      clip_titles: { type: 'array', items: { type: 'string' } },
      is_standalone: { type: 'boolean' },
      recommended_duration: { type: 'integer', enum: [30, 45, 60, 90] },
      sentiment: { type: 'string', enum: ['serious', 'funny', 'intense', 'neutral'] },
      reason: { type: 'string' },
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['windows'],
    properties: { windows: { type: 'array', items: window } },
  };
}

/** PURE: Anthropic Messages request for a batch of transcript windows. */
export function buildClaudeRequest(batch: TranscriptChunk[], model: string, effort: Effort): Record<string, unknown> {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildBatchPrompt(batch) }],
    output_config: {
      effort,
      format: { type: 'json_schema', schema: buildBatchSchema() },
    },
  };
}

/** PURE: parse a structured-output batch response ({ windows: [...] }). Returns null on any mismatch. */
export function parseClaudeBatch(raw: string): SemanticChunkResult[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.windows)) return null;
    return parsed.windows as SemanticChunkResult[];
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function textOf(response: Anthropic.Message): string {
  return response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
}

/** PURE: an auth/permission failure (bad or revoked API key) — fatal for every batch, so don't retry. */
export function isAuthError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /\b401\b|\b403\b|authentication_error|invalid x-api-key|permission_error/i.test(msg);
}

export interface ClaudeSemanticOpts {
  apiKey?: string;
  model?: string;
  effort?: Effort;
  outPath?: string;
}

/** Score transcript windows with Claude. Returns [] (never throws) when unavailable so the caller can fall back. */
export async function analyzeSemanticClaude(
  segments: TranscriptSegment[],
  opts: ClaudeSemanticOpts = {},
): Promise<SemanticWindow[]> {
  if (opts.outPath && existsSync(opts.outPath)) {
    logger.info('Reusing cached layer_semantic.json');
    return JSON.parse(await readFile(opts.outPath, 'utf8'));
  }

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) {
    logger.warn('ANTHROPIC_API_KEY not set — skipping Claude semantic layer');
    return [];
  }

  const chunks = chunkTranscript(segments);
  if (chunks.length === 0) return [];

  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_CLAUDE_MODEL;
  const effort: Effort = opts.effort ?? (process.env.ANTHROPIC_EFFORT as Effort) ?? 'medium';
  const client = new Anthropic(apiKey ? { apiKey } : {});
  const batches = batchChunks(chunks, BATCH_SIZE);

  // A bad API key (401) fails every batch identically — abort the whole layer after the first
  // auth failure instead of grinding through all batches × retries, so we fall back fast.
  let authFailed = false;

  const batchResults = await mapWithConcurrency(batches, CONCURRENCY, async (batch): Promise<(SemanticWindow | null)[]> => {
    if (authFailed) return batch.map(() => null);
    const label = `claude-semantic-batch[${batch[0].start}-${batch[batch.length - 1].end}] (${batch.length} windows)`;
    try {
      const results = await withRetry(async () => {
        // output_config (structured outputs) isn't in this SDK's types yet — it still
        // serializes into the request body. Cast through unknown.
        const req = buildClaudeRequest(batch, model, effort) as unknown as Anthropic.MessageCreateParamsNonStreaming;
        const res = await client.messages.create(req);
        if (res.stop_reason === 'refusal') throw new Error('Claude declined the request (refusal)');
        const parsed = parseClaudeBatch(textOf(res));
        if (!parsed) throw new Error('failed to parse Claude batch JSON response');
        return parsed;
      }, { attempts: 3, label, shouldRetry: (e) => !isAuthError(e) });

      return batch.map((chunk, i) => {
        const item = results[i];
        if (!item || !item.scores) return null;
        return toWindow(chunk, item);
      });
    } catch (e) {
      if (isAuthError(e) && !authFailed) {
        authFailed = true;
        logger.warn('Claude API key rejected (401/403) — aborting Claude layer, falling back to Gemini');
      }
      logger.warn(`[${label}] failed after retries: ${e instanceof Error ? e.message : String(e)}`);
      return batch.map(() => null);
    }
  });

  const ok = batchResults.flat().filter((w): w is SemanticWindow => w !== null);
  if (ok.length === 0) {
    logger.warn('All Claude semantic batches failed');
    return [];
  }

  if (opts.outPath) {
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, JSON.stringify(ok, null, 2));
  }
  return ok;
}
