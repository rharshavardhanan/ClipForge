/**
 * Montage counter engine — counts come from cycle detection (pure signals); the ONE
 * vision call here only decides WHAT is being counted ("PULLUP COUNTER") and whether
 * counting makes sense at all. Low confidence → counter off: silence beats a wrong label.
 *
 * Split for testability: `labelCounter` takes already-extracted keyframes so the
 * confidence/countable gate is directly testable with a fake askFn and no
 * filesystem/ffmpeg I/O; `labelCounterForMoment` is the thin real-file wrapper (extraction
 * + labelCounter) used by the pipeline and exercised only in live smoke.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { extractKeyframes } from '../analysis/keyframes.js';
import { askVisionJson, type AskVisionFn, type VisionImage } from '../broll/llmJson.js';

const MIN_CONFIDENCE = 0.6;

const SCHEMA = {
  type: 'object',
  properties: {
    countable: { type: 'boolean' },
    label: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['countable', 'label'],
  additionalProperties: false,
} as const;

const SYSTEM = 'You label repetitive actions in short sports/fitness/gaming clips for an on-screen counter.';
const PROMPT = `These frames come from one clip where a repeating motion was detected.
Decide if the repetitions are a countable action a viewer would enjoy counting (reps, jumps, hits, tricks).
Return EXACTLY this JSON shape (an object, not an array):
{"countable": true|false, "label": "SHORT ALL-CAPS COUNTER TITLE like PULLUP COUNTER", "confidence": 0.0-1.0}`;

/** PURE: free-tier Gemini shape tolerance (top-level arrays, missing confidence). */
export function normalizeCounterRaw(raw: unknown): { countable: boolean; label: string; confidence: number } | null {
  const obj = Array.isArray(raw) ? raw[0] : raw;
  if (obj === null || typeof obj !== 'object') return null;
  const r = obj as Record<string, unknown>;
  if (typeof r.countable !== 'boolean' || typeof r.label !== 'string') return null;
  return { countable: r.countable, label: r.label, confidence: typeof r.confidence === 'number' ? r.confidence : 0.5 };
}

/**
 * ONE vision call over already-extracted keyframes → counter label, or null (off).
 * Gate order: null result, OR not countable, OR confidence < MIN_CONFIDENCE, OR an empty
 * label ALL return null — a wrong or low-confidence label can never come out of this
 * function. Never throws (askFn failures and any other error degrade to null).
 */
export async function labelCounter(images: VisionImage[], askFn: AskVisionFn = askVisionJson): Promise<string | null> {
  try {
    const raw = await askFn({ system: SYSTEM, prompt: PROMPT, schema: SCHEMA as unknown as Record<string, unknown>, label: 'montage-counter', images });
    const res = normalizeCounterRaw(raw);
    if (!res || !res.countable || res.confidence < MIN_CONFIDENCE || res.label.trim() === '') return null;
    return res.label.trim().toUpperCase().slice(0, 24);
  } catch (e) {
    logger.warn(`[montage-counter] label failed — counter off: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Real-file wrapper: samples keyframes at 25/50/75% of the moment's duration, then
 * delegates to labelCounter. I/O + LLM — not unit tested (no ffmpeg in unit tests);
 * exercised in live smoke. Never throws.
 */
export async function labelCounterForMoment(momentFile: string, dur: number, askFn: AskVisionFn = askVisionJson): Promise<string | null> {
  try {
    const times = [dur * 0.25, dur * 0.5, dur * 0.75];
    const dir = await mkdtemp(join(tmpdir(), 'clipforge-counter-'));
    let images: VisionImage[];
    try { images = await extractKeyframes(momentFile, times, dir); }
    finally { await rm(dir, { recursive: true, force: true }); }
    return await labelCounter(images, askFn);
  } catch (e) {
    logger.warn(`[montage-counter] label failed — counter off: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
