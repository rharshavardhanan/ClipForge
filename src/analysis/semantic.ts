import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
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

const MAX_CHARS = 3000;
const BATCH_SIZE = 15;
const BATCH_CONCURRENCY = 2;
const INTER_BATCH_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SYSTEM_PROMPT = `You are a viral content analyst. You study short-form video clips (TikTok, Reels, Shorts) and know exactly what makes a moment scroll-stopping. Given a list of transcript windows, score each one for viral/emotional potential and extract a clip-ready hook. Return ONLY valid JSON, no markdown, no commentary.`;

function buildBatchPrompt(chunks: TranscriptChunk[]): string {
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
function batchChunks(chunks: TranscriptChunk[], batchSize: number): TranscriptChunk[][] {
  const batches: TranscriptChunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }
  return batches;
}

function toWindow(chunk: TranscriptChunk, result: SemanticChunkResult): SemanticWindow {
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

  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping semantic layer (falling back to Slice-1 scoring)');
    return [];
  }

  const chunks = chunkTranscript(segments);
  if (chunks.length === 0) return [];

  const modelName = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  const batches = batchChunks(chunks, BATCH_SIZE);

  const batchResults = await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch, batchIndex): Promise<(SemanticWindow | null)[]> => {
    // Small stagger between batch kickoffs to smooth request bursts against the rate limit.
    if (batchIndex > 0) await sleep(INTER_BATCH_DELAY_MS);

    const label = `gemini-semantic-batch[${batch[0].start}-${batch[batch.length - 1].end}] (${batch.length} windows)`;
    try {
      const results = await withRetry(
        async () => {
          const res = await model.generateContent(buildBatchPrompt(batch));
          const text = res.response.text();
          const parsed = parseGeminiBatch(text);
          if (!parsed) throw new Error('failed to parse Gemini batch JSON array response');
          return parsed;
        },
        { attempts: 4, label },
      );

      // Map what we can by index; skip the rest rather than crashing on a short/garbled batch.
      return batch.map((chunk, i) => {
        const item = results[i];
        if (!item || !item.scores) return null;
        return toWindow(chunk, item);
      });
    } catch (e) {
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
