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
const CONCURRENCY = 5;

const SYSTEM_PROMPT = `You are a viral content analyst. You study short-form video clips (TikTok, Reels, Shorts) and know exactly what makes a moment scroll-stopping. Given a transcript window, score it for viral/emotional potential and extract a clip-ready hook. Return ONLY valid JSON, no markdown, no commentary.`;

function buildUserPrompt(chunk: TranscriptChunk): string {
  return `Analyze this transcript window (${chunk.start.toFixed(1)}s - ${chunk.end.toFixed(1)}s) from a longer video.

TRANSCRIPT:
"""
${chunk.text}
"""

Score each dimension 0-10 (0 = none, 10 = extreme):
- emotional_intensity: how strong/raw the emotion is
- controversy: how likely to spark disagreement or debate
- humor: how funny/entertaining
- surprise: how unexpected/novel
- wisdom: how insightful/quotable
- storytelling_tension: how much narrative pull (setup, conflict, stakes)
- argument_peak: how strong/sharp the rhetorical point is
- relatability: how much an average viewer would relate

Also extract:
- hook_moment: the single sharpest, most scroll-stopping sentence, verbatim from the transcript
- clip_titles: exactly 3 short clip title ideas, each under 8 words
- is_standalone: true if this window makes sense without any other context from the video
- recommended_duration: best clip length in seconds — one of 30, 45, 60, 90
- sentiment: one of "serious", "funny", "intense", "neutral"
- reason: one sentence explaining why this window would or wouldn't work as a clip

Return ONLY this JSON shape:
{
  "scores": { "emotional_intensity":0,"controversy":0,"humor":0,"surprise":0,"wisdom":0,"storytelling_tension":0,"argument_peak":0,"relatability":0 },
  "hook_moment":"", "clip_titles":["","",""], "is_standalone":true, "recommended_duration":60, "sentiment":"neutral", "reason":""
}`;
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

/** PURE: strip markdown fences and parse Gemini's JSON response. Returns null on any failure. */
export function parseGeminiJson(raw: string): SemanticChunkResult | null {
  try {
    const stripped = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(stripped);
    if (!parsed || typeof parsed !== 'object' || !parsed.scores) return null;
    return parsed as SemanticChunkResult;
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

  const windows = await mapWithConcurrency(chunks, CONCURRENCY, async (chunk): Promise<SemanticWindow | null> => {
    try {
      const result = await withRetry(
        async () => {
          const res = await model.generateContent(buildUserPrompt(chunk));
          const text = res.response.text();
          const parsed = parseGeminiJson(text);
          if (!parsed) throw new Error('failed to parse Gemini JSON response');
          return parsed;
        },
        { attempts: 3, label: `gemini-semantic[${chunk.start}-${chunk.end}]` },
      );
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
    } catch (e) {
      logger.warn(`[gemini-semantic] chunk ${chunk.start}-${chunk.end} failed after retries: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  });

  const ok = windows.filter((w): w is SemanticWindow => w !== null);
  if (ok.length === 0) {
    logger.warn('All Gemini semantic chunks failed — falling back to Slice-1 scoring');
    return [];
  }

  if (opts.outPath) {
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, JSON.stringify(ok, null, 2));
  }

  return ok;
}
