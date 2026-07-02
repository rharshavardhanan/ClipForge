import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { KeyPool, loadGeminiKeys } from './keyPool.js';
import type { TranscriptSegment, SemanticScores, SemanticWindow } from '../types/index.js';

export interface TranscriptChunk { start: number; end: number; text: string; }

export interface SemanticChunkResult {
  scores: SemanticScores;
  hook_moment: string;
  clip_titles: string[];
  is_standalone: boolean;
  recommended_duration: number;
  sentiment: 'serious' | 'funny' | 'intense' | 'neutral';
  reason: string;
}

export const BATCH_SIZE = 15;
const MAX_CHARS = 3000;
const BATCH_CONCURRENCY = 2;
const INTER_BATCH_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SYSTEM_PROMPT = `You are a viral content analyst. You study short-form video clips (TikTok, Reels, Shorts) and know exactly what makes a moment scroll-stopping. Given a list of transcript windows, score each one for viral/emotional potential and extract a clip-ready hook. Return ONLY valid JSON, no markdown, no commentary.`;

export function buildBatchPrompt(chunks: TranscriptChunk[]): string {
  const windowsBlock = chunks
    .map(
      (chunk, i) => `WINDOW ${i + 1} (${chunk.start.toFixed(1)}s - ${chunk.end.toFixed(1)}s):
"""
${chunk.text}
"""`,
    )
    .join('\n\n');

  return `Analyze the following ${chunks.length} transcript windows from a longer video. Score EACH window independently.

${windowsBlock}

For each window, score each dimension 0-10 (0 = none, 10 = extreme):
- emotional_intensity: how strong/raw the emotion is
- controversy: how likely to spark disagreement or debate
- humor: how funny/entertaining
- surprise: how unexpected/novel
- wisdom: how insightful/quotable
- storytelling_tension: how much narrative pull (setup, conflict, stakes)
- argument_peak: how strong/sharp the rhetorical point is
- relatability: how much an average viewer would relate

Also extract, per window:
- hook_moment: the single sharpest, most scroll-stopping sentence, verbatim from that window's transcript
- clip_titles: exactly 3 short clip title ideas, each under 8 words
- is_standalone: true if this window makes sense without any other context from the video
- recommended_duration: best clip length in seconds — one of 30, 45, 60, 90
- sentiment: one of "serious", "funny", "intense", "neutral"
- reason: one sentence explaining why this window would or wouldn't work as a clip

Return ONLY a JSON ARRAY of exactly ${chunks.length} objects, in the SAME ORDER as the windows above (element 0 = WINDOW 1, element 1 = WINDOW 2, etc). Each object must use this exact shape:
{
  "scores": { "emotional_intensity":0,"controversy":0,"humor":0,"surprise":0,"wisdom":0,"storytelling_tension":0,"argument_peak":0,"relatability":0 },
  "hook_moment":"", "clip_titles":["","",""], "is_standalone":true, "recommended_duration":60, "sentiment":"neutral", "reason":""
}

Do not return anything except the JSON array.`;
}

/** PURE: sliding windows over transcript segments. */
export function chunkTranscript(
  segments: TranscriptSegment[],
  windowSec = 30,
  overlapSec = 15,
): TranscriptChunk[] {
  if (segments.length === 0) return [];
  const step = Math.max(1, windowSec - overlapSec);
  const duration = Math.max(...segments.map((s) => s.end));
  const chunks: TranscriptChunk[] = [];
  for (let start = 0; start < duration; start += step) {
    const end = Math.min(start + windowSec, duration);
    const text = segments
      .filter((s) => s.start < end && s.end > start)
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, MAX_CHARS);
    chunks.push({ start, end, text });
    if (end >= duration) break;
  }
  return chunks;
}

/** PURE: weighted average across the 8 semantic dimensions. */
export function semanticScore(scores: SemanticScores): number {
  return (
    scores.emotional_intensity * 0.2 +
    scores.controversy * 0.15 +
    scores.humor * 0.15 +
    scores.surprise * 0.15 +
    scores.wisdom * 0.1 +
    scores.storytelling_tension * 0.1 +
    scores.argument_peak * 0.1 +
    scores.relatability * 0.05
  );
}

/** PURE: strip markdown fences from a raw Gemini response. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** PURE: strip markdown fences and parse Gemini's JSON response. Returns null on any failure. */
export function parseGeminiJson(raw: string): SemanticChunkResult | null {
  try {
    const parsed = JSON.parse(stripFences(raw));
    if (!parsed || typeof parsed !== 'object' || !parsed.scores) return null;
    return parsed as SemanticChunkResult;
  } catch {
    return null;
  }
}

/**
 * PURE: strip markdown fences and parse Gemini's batched JSON-array response.
 * Returns null if the payload isn't valid JSON or isn't an array.
 */
export function parseGeminiBatch(raw: string): SemanticChunkResult[] | null {
  try {
    const parsed = JSON.parse(stripFences(raw));
    if (!Array.isArray(parsed)) return null;
    return parsed as SemanticChunkResult[];
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** PURE: split chunks into fixed-size batches. */
export function batchChunks(chunks: TranscriptChunk[], batchSize: number): TranscriptChunk[][] {
  const batches: TranscriptChunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }
  return batches;
}

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

/** PURE: true if an error looks like a 429 / quota-exhausted response from the Gemini API. */
export function isRateLimitError(e: unknown): boolean {
  if (!e) return false;
  const status = (e as { status?: number }).status;
  if (status === 429) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message);
}

/**
 * PURE: true if the error is a PER-DAY free-tier quota exhaustion (e.g. the 20 requests/day
 * cap on gemini-2.5-flash). Unlike a per-minute rate limit, this won't recover for hours —
 * so retrying/cooling-down is pointless and we should abort the whole layer.
 */
export function isDailyQuotaError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /PerDay/i.test(message);
}

/**
 * PURE: extract a retryDelay (ms) from a Gemini error's message, e.g. a
 * RetryInfo detail like {"retryDelay":"19s"}. Returns null if not found/parsable.
 */
export function parseRetryDelayMs(e: unknown): number | null {
  const message = e instanceof Error ? e.message : String(e);
  const match = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!match) return null;
  const seconds = parseFloat(match[1]);
  if (!Number.isFinite(seconds)) return null;
  return Math.round(seconds * 1000);
}

export function toWindow(chunk: TranscriptChunk, result: SemanticChunkResult): SemanticWindow {
  return {
    start: chunk.start,
    end: chunk.end,
    semantic_score: semanticScore(result.scores),
    scores: result.scores,
    hook_moment: result.hook_moment,
    clip_titles: result.clip_titles,
    is_standalone: result.is_standalone,
    recommended_duration: result.recommended_duration,
    sentiment: result.sentiment,
    reason: result.reason,
  };
}

export async function analyzeSemantic(
  segments: TranscriptSegment[],
  opts: { apiKey?: string; model?: string; outPath?: string } = {},
): Promise<SemanticWindow[]> {
  if (opts.outPath && existsSync(opts.outPath)) {
    logger.info('Reusing cached layer_semantic.json');
    return JSON.parse(await readFile(opts.outPath, 'utf8'));
  }

  const keys = opts.apiKey ? [opts.apiKey] : loadGeminiKeys();
  const pool = new KeyPool(keys);
  if (pool.size() === 0) {
    logger.warn('GEMINI_API_KEY(S) not set — skipping semantic layer (falling back to Slice-1 scoring)');
    return [];
  }

  const chunks = chunkTranscript(segments);
  if (chunks.length === 0) return [];

  const modelName = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const modelCache = new Map<string, ReturnType<GoogleGenerativeAI['getGenerativeModel']>>();
  const modelFor = (key: string) => {
    let m = modelCache.get(key);
    if (!m) {
      m = new GoogleGenerativeAI(key).getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      });
      modelCache.set(key, m);
    }
    return m;
  };

  const batches = batchChunks(chunks, BATCH_SIZE);
  // When rotating across multiple keys we can usefully run more batches in parallel
  // (one per available key), but keep it bounded and simple.
  const concurrency = Math.max(BATCH_CONCURRENCY, Math.min(pool.size(), batches.length));

  // Once every key's PER-DAY free-tier quota is exhausted, stop — it won't recover for hours,
  // so grinding through 40-48s retries on every remaining batch is pure waste.
  let dailyExhausted = false;

  const batchResults = await mapWithConcurrency(batches, concurrency, async (batch, batchIndex): Promise<(SemanticWindow | null)[]> => {
    if (dailyExhausted) return batch.map(() => null);
    // Small stagger between batch kickoffs to smooth request bursts against the rate limit.
    if (batchIndex > 0) await sleep(INTER_BATCH_DELAY_MS);

    const label = `gemini-semantic-batch[${batch[0].start}-${batch[batch.length - 1].end}] (${batch.length} windows)`;
    try {
      const results = await withRetry(
        async () => {
          const key = pool.next();
          if (!key) throw new Error('no Gemini API keys available');
          try {
            const res = await modelFor(key).generateContent(buildBatchPrompt(batch));
            const text = res.response.text();
            const parsed = parseGeminiBatch(text);
            if (!parsed) throw new Error('failed to parse Gemini batch JSON array response');
            pool.reportSuccess(key);
            return parsed;
          } catch (e) {
            if (isDailyQuotaError(e)) {
              // Per-day cap: mark the key exhausted for a long time so the pool stops picking it.
              pool.reportRateLimited(key, 6 * 60 * 60 * 1000);
            } else if (isRateLimitError(e)) {
              const delay = parseRetryDelayMs(e) ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
              pool.reportRateLimited(key, delay);
              logger.warn(`[${label}] key rate-limited, cooling down ${delay}ms and rotating to next key`);
            }
            throw e;
          }
        },
        { attempts: Math.max(4, pool.size()), label, shouldRetry: (e) => !isDailyQuotaError(e) },
      );

      // Map what we can by index; skip the rest rather than crashing on a short/garbled batch.
      return batch.map((chunk, i) => {
        const item = results[i];
        if (!item || !item.scores) return null;
        return toWindow(chunk, item);
      });
    } catch (e) {
      if (isDailyQuotaError(e) && !dailyExhausted) {
        dailyExhausted = true;
        logger.warn('Gemini free-tier DAILY quota exhausted (20 req/day per project) — stopping semantic layer. Add more keys from SEPARATE Google projects (GEMINI_API_KEYS), use a paid key, or SEMANTIC_PROVIDER=none. Falling back to audio+trigger scoring.');
      }
      logger.warn(`[${label}] failed after retries: ${e instanceof Error ? e.message : String(e)}`);
      return batch.map(() => null);
    }
  });

  const ok = batchResults.flat().filter((w): w is SemanticWindow => w !== null);
  if (ok.length === 0) {
    logger.warn('All Gemini semantic batches failed — falling back to Slice-1 scoring');
    return [];
  }

  if (opts.outPath) {
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, JSON.stringify(ok, null, 2));
  }

  return ok;
}
