/**
 * Semantic match validation (v6) — Claude scores each cue's search candidates for real
 * relevance; only matches scoring >8/10 are used (spec). One batched call per clip. When the
 * LLM is unavailable a token-overlap heuristic fills in with a slightly lower bar.
 */
import type { BrollCandidate, BrollCue } from '../types/index.js';
import { askJson } from './llmJson.js';

/** Spec threshold for LLM-scored matches ("Only use >8"). */
export const LLM_THRESHOLD = 8;
/** Heuristic fallback is cruder — require a strong token overlap instead. */
export const HEURISTIC_THRESHOLD = 7;

export interface CueMatch { cueIndex: number; candidate: BrollCandidate; score: number; }

export const VALIDATE_SYSTEM_PROMPT =
  'You are a strict video researcher. Judge whether a YouTube result ACTUALLY shows the requested footage, from its title/channel alone. Return ONLY valid JSON.';

/** PURE: batched validation prompt — every cue with its numbered candidates. */
export function buildValidatePrompt(cues: BrollCue[], candidates: BrollCandidate[][]): string {
  const blocks = cues.map((cue, i) => {
    const list = (candidates[i] ?? [])
      .map((c, j) => `  ${j}: "${c.title}"${c.channel ? ` — ${c.channel}` : ''} (${Math.round(c.durationSec)}s)`)
      .join('\n');
    return `CUE ${i}: needs footage of "${cue.entity}" (${cue.kind}) — search was "${cue.query}"\n${list || '  (no candidates)'}`;
  }).join('\n\n');
  return `For each cue below, pick the ONE candidate most likely to actually contain that footage, and score the match 0-10 (10 = certainly shows exactly this, 0 = unrelated/clickbait). Be strict: compilations, reactions to unrelated things, and thumbnails-only bait score low.

${blocks}

Return {"results":[{"cue":<cue index>,"best":<candidate index or -1 if none fit>,"score":<0-10>}]} covering every cue.`;
}

/** PURE: JSON schema for the validation response. */
export function buildValidateSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['cue', 'best', 'score'],
          properties: {
            cue: { type: 'integer' }, best: { type: 'integer' }, score: { type: 'number' },
          },
        },
      },
    },
  };
}

/** PURE: fold a raw LLM validation response into kept matches (score > LLM_THRESHOLD). */
export function applyValidation(raw: unknown, cues: BrollCue[], candidates: BrollCandidate[][]): CueMatch[] {
  const results = (raw as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: CueMatch[] = [];
  for (const r of results) {
    const { cue, best, score } = (r ?? {}) as Record<string, unknown>;
    if (typeof cue !== 'number' || typeof best !== 'number' || typeof score !== 'number') continue;
    if (cue < 0 || cue >= cues.length || best < 0) continue;
    const cand = candidates[cue]?.[best];
    if (!cand || score <= LLM_THRESHOLD) continue;
    out.push({ cueIndex: cue, candidate: cand, score });
  }
  return out;
}

/** PURE: token-overlap relevance 0-10 — shared query tokens / query tokens. */
export function heuristicScore(query: string, title: string): number {
  const qt = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (qt.length === 0) return 0;
  const tt = new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const shared = qt.filter((w) => tt.has(w)).length;
  return +(10 * (shared / qt.length)).toFixed(1);
}

/** PURE: heuristic fallback — best title-overlap candidate per cue, bar HEURISTIC_THRESHOLD. */
export function heuristicValidation(cues: BrollCue[], candidates: BrollCandidate[][]): CueMatch[] {
  const out: CueMatch[] = [];
  cues.forEach((cue, i) => {
    let best: BrollCandidate | null = null;
    let bestScore = 0;
    for (const c of candidates[i] ?? []) {
      const s = heuristicScore(cue.query, c.title);
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (best && bestScore >= HEURISTIC_THRESHOLD) out.push({ cueIndex: i, candidate: best, score: bestScore });
  });
  return out;
}

/** Validate cue↔candidate matches via LLM (heuristic fallback). Never throws. */
export async function validateMatches(cues: BrollCue[], candidates: BrollCandidate[][]): Promise<CueMatch[]> {
  if (cues.length === 0 || candidates.every((c) => !c || c.length === 0)) return [];
  const raw = await askJson({
    system: VALIDATE_SYSTEM_PROMPT,
    prompt: buildValidatePrompt(cues, candidates),
    schema: buildValidateSchema(),
    label: 'broll-validate',
  });
  if (raw !== null) return applyValidation(raw, cues, candidates);
  return heuristicValidation(cues, candidates);
}
