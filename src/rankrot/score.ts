/**
 * RankRot scoring — five layers, each 0–10, pool-normalized, weighted into the final
 * rank score (spec weights). NO Claude here: Gemini Flash for virality, everything else
 * is local signal analysis (ffmpeg motion/audio, face-api reaction, aHash novelty).
 */
import { PNG } from 'pngjs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import { detectFrameObs } from '../extraction/faceTracker.js';
import { askGeminiJson } from '../broll/llmJson.js';
import type { BrollCandidate } from '../types/index.js';
import { percentile, type CurvePoint } from './signals.js';

export const WEIGHTS = { visual: 0.35, audio: 0.20, reaction: 0.20, virality: 0.15, novelty: 0.10 } as const;

export interface LayerScores {
  visual: number; audio: number; reaction: number; virality: number; novelty: number;
}

export interface ScoredClip {
  candidate: BrollCandidate;
  momentFile: string;
  momentStart: number;
  momentEnd: number;
  layers: LayerScores;
  final: number;
}

/** PURE: min-max normalize raw layer values across the pool to 0..10 (flat → all 5). */
export function poolNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-9) return values.map(() => 5);
  return values.map((v) => +((10 * (v - min)) / (max - min)).toFixed(2));
}

/** PURE: raw visual impact — sustained motion level plus spike sharpness. */
export function rawVisualImpact(motion: CurvePoint[]): number {
  if (motion.length === 0) return 0;
  const p95 = percentile(motion, 95);
  const med = Math.max(1e-6, percentile(motion, 50));
  return p95 * (1 + Math.min(4, p95 / med)); // explosive spikes over calm baselines win
}

/** PURE: raw audio hype — loudness peak lift over the median plus bass punch. */
export function rawAudioHype(audio: CurvePoint[], bass: CurvePoint[]): number {
  if (audio.length === 0) return 0;
  const lift = Math.max(0, percentile(audio, 95) - percentile(audio, 50));
  return lift + 0.5 * percentile(bass, 95);
}

/** Reaction: faces on the trimmed moment — presence + biggest face-area jump (shock zoom). */
export async function reactionScore(momentFile: string, w: number, h: number): Promise<number> {
  try {
    const frames = await detectFrameObs(momentFile, w, h, 2);
    if (frames.length === 0) return 0;
    const areas = frames.map((f) => f.faces.reduce((a, o) => a + o.box.w * o.box.h, 0) / (w * h));
    const present = frames.filter((f) => f.faces.length > 0).length / frames.length;
    let maxJump = 0;
    for (let i = 1; i < areas.length; i++) maxJump = Math.max(maxJump, areas[i] - areas[i - 1]);
    return +(Math.min(10, present * 5 + maxJump * 40)).toFixed(2);
  } catch (e) {
    logger.warn(`[rankrot-reaction] ${momentFile}: ${e instanceof Error ? e.message : String(e)} — scoring 0`);
    return 0;
  }
}

// ---- novelty: average-hash on sampled frames (local "embedding") ----

/** PURE: 64-bit average hash from an 8x8 grayscale buffer (row-major, any channel count). */
export function aHash(gray8x8: Uint8Array | number[]): bigint {
  const px = Array.from(gray8x8).slice(0, 64);
  const mean = px.reduce((a, b) => a + b, 0) / Math.max(1, px.length);
  let bits = 0n;
  for (let i = 0; i < 64; i++) bits = (bits << 1n) | (px[i] > mean ? 1n : 0n);
  return bits;
}

/** PURE: hamming distance between two 64-bit hashes. */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** Sample 3 frames of the moment as 8x8 gray PNGs → aHashes. [] on failure (fail-soft).
 *  Goes through a temp file — run() captures stdout as text, which corrupts binary PNGs. */
export async function frameHashes(momentFile: string, durSec: number): Promise<bigint[]> {
  const out: bigint[] = [];
  const tmp = join(tmpdir(), `rr_hash_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
  for (const frac of [0.25, 0.5, 0.75]) {
    try {
      await run('ffmpeg', [
        '-y', '-ss', String(Math.max(0, durSec * frac)), '-i', momentFile,
        '-frames:v', '1', '-vf', 'scale=8:8,format=gray', tmp,
      ]);
      const png = PNG.sync.read(await readFile(tmp));
      const gray: number[] = [];
      for (let i = 0; i < 64; i++) gray.push(png.data[i * 4]); // R of RGBA (gray → R=G=B)
      out.push(aHash(gray));
    } catch { /* frame grab failed — fewer hashes is fine */ }
  }
  await rm(tmp, { force: true });
  return out;
}

/** PURE: min hamming distance between two clips' hash sets (64 = nothing comparable). */
export function clipDistance(a: bigint[], b: bigint[]): number {
  if (a.length === 0 || b.length === 0) return 64;
  let min = 64;
  for (const x of a) for (const y of b) min = Math.min(min, hamming(x, y));
  return min;
}

/** PURE: word-overlap similarity of two titles (0..1, denominator = smaller set). */
export function titleOverlap(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const wb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

export const DUPE_HASH_DIST = 10;   // ≤ this hamming distance = same footage
export const DUPE_TITLE_SIM = 0.75;

/**
 * PURE: collapse near-duplicates (same footage reposted) keeping the higher provisional
 * score, and derive each survivor's novelty as its min distance to OTHER survivors (0-10).
 */
export function collapseDupes<T extends { hashes: bigint[]; title: string; provisional: number }>(
  clips: T[],
): { kept: T[]; novelty: number[] } {
  const kept: T[] = [];
  for (const clip of [...clips].sort((a, b) => b.provisional - a.provisional)) {
    const dupe = kept.some((k) =>
      clipDistance(clip.hashes, k.hashes) <= DUPE_HASH_DIST || titleOverlap(clip.title, k.title) >= DUPE_TITLE_SIM);
    if (!dupe) kept.push(clip);
  }
  const novelty = kept.map((clip) => {
    const others = kept.filter((k) => k !== clip);
    if (others.length === 0) return 10;
    const minDist = Math.min(...others.map((o) => clipDistance(clip.hashes, o.hashes)));
    return +Math.min(10, (minDist / 32) * 10).toFixed(2);
  });
  return { kept, novelty };
}

// ---- virality: one Gemini Flash batch call (spec layer 4) ----

/** PURE: virality prompt over the whole pool. */
export function buildViralityPrompt(items: { title: string; channel?: string; durationSec: number }[], topic: string): string {
  const list = items.map((c, i) => `${i}: "${c.title}"${c.channel ? ` — ${c.channel}` : ''} (${Math.round(c.durationSec)}s)`).join('\n');
  return `Topic: "${topic}". These clips are candidates for a Top-5 ranking Short.

${list}

Rate EACH clip 1-10 for viral potential based on: skill, shock, uniqueness, replayability, hype. Judge from the title/channel. Be decisive — spread your scores.

Return {"scores":[{"i":<index>,"score":<1-10>}]} covering every index.`;
}

/** PURE: parse virality scores; missing/invalid entries → fallback value. */
export function parseVirality(raw: unknown, n: number, fallback: number[]): number[] {
  const out = [...fallback];
  const scores = (raw as { scores?: unknown })?.scores;
  if (!Array.isArray(scores)) return out;
  for (const s of scores) {
    const { i, score } = (s ?? {}) as Record<string, unknown>;
    if (typeof i === 'number' && typeof score === 'number' && i >= 0 && i < n) {
      out[i] = Math.max(0, Math.min(10, score));
    }
  }
  return out;
}

/** PURE: log-scaled view-count fallback when Gemini is unavailable (0 views → 5 neutral). */
export function viewFallback(views: (number | undefined)[]): number[] {
  return views.map((v) => (v && v > 0 ? +Math.min(10, Math.log10(v) * 1.4).toFixed(2) : 5));
}

export async function viralityScores(
  items: { title: string; channel?: string; durationSec: number; viewCount?: number }[], topic: string,
): Promise<number[]> {
  const fallback = viewFallback(items.map((c) => c.viewCount));
  const raw = await askGeminiJson({
    system: 'You are a ruthless viral-shorts curator. Return ONLY valid JSON.',
    prompt: buildViralityPrompt(items, topic),
    schema: {
      type: 'object', additionalProperties: false, required: ['scores'],
      properties: {
        scores: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['i', 'score'],
            properties: { i: { type: 'integer' }, score: { type: 'number' } },
          },
        },
      },
    },
    label: 'rankrot-virality',
  });
  return parseVirality(raw, items.length, fallback);
}

/** PURE: weighted final score (spec weights). */
export function finalScore(l: LayerScores): number {
  return +(WEIGHTS.visual * l.visual + WEIGHTS.audio * l.audio + WEIGHTS.reaction * l.reaction
    + WEIGHTS.virality * l.virality + WEIGHTS.novelty * l.novelty).toFixed(3);
}

/** PURE: top-N by final score, returned in COUNTDOWN order (#N first … #1 last). */
export function pickCountdown(clips: ScoredClip[], top = 5): ScoredClip[] {
  const best = [...clips].sort((a, b) => b.final - a.final).slice(0, top);
  return best.reverse(); // weakest of the winners first → #1 revealed last (never early)
}
