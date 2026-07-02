/**
 * B-roll cue extraction (v6) — for each clip, ask the LLM where switching the visual to
 * contextual B-roll would heighten the story while the speaker's voice continues (narrative
 * overlay), and what EXACT YouTube search finds that footage. Entities get real footage
 * ("Toto Wolff" → Toto Wolff Mercedes), abstractions get visual metaphors (discipline →
 * training montage), emotions get relatable reaction footage.
 */
import type { BrollCue, BrollKind, TranscriptSegment } from '../types/index.js';
import { askJson } from './llmJson.js';

export const MAX_CUES = 6;
const KINDS: BrollKind[] = ['person', 'place', 'company', 'object', 'action', 'emotion', 'concept', 'event'];

/** Abstract concept → visual-metaphor search phrasing, embedded in the prompt (spec table). */
export const METAPHOR_HINTS: Record<string, string> = {
  discipline: 'athlete training alone early morning',
  failure: 'athlete defeat losing moment',
  stress: 'person overwhelmed head in hands dark room',
  focus: 'studying late night desk lamp',
  money: 'counting money cash stacks',
  success: 'championship trophy winning celebration',
  grind: 'late night working laptop city',
};

export interface CueSentence { start: number; end: number; text: string; }

/** PURE: clip-relative sentences overlapping [clipStart, clipEnd), times clamped to the clip. */
export function clipSentences(segments: TranscriptSegment[], clipStart: number, clipEnd: number): CueSentence[] {
  return segments
    .filter((s) => s.end > clipStart && s.start < clipEnd)
    .map((s) => ({
      start: +(Math.max(0, s.start - clipStart)).toFixed(2),
      end: +(Math.min(clipEnd - clipStart, s.end - clipStart)).toFixed(2),
      text: s.text.trim(),
    }))
    .filter((s) => s.text.length > 0 && s.end - s.start > 0.2);
}

export const CUE_SYSTEM_PROMPT =
  'You are an elite short-form video editor (MrBeast / premium podcast-reel caliber) planning contextual B-roll for a vertical clip. Return ONLY valid JSON.';

/** PURE: the cue-extraction prompt for one clip. */
export function buildCuePrompt(sentences: CueSentence[], sentiment?: string): string {
  const lines = sentences.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  const metaphors = Object.entries(METAPHOR_HINTS).map(([k, v]) => `${k} → "${v}"`).join('; ');
  return `Clip transcript (times are seconds WITHIN the clip${sentiment ? `; overall tone: ${sentiment}` : ''}):

${lines}

Plan up to ${MAX_CUES} B-roll moments (narrative overlay: the voice continues, only the visual switches). For each, give:
- start/end: the seconds the overlay should cover — inside the sentence that mentions it, at least 1.5s long
- entity: the person/place/company/object/action/emotion/concept/event being spoken about
- kind: one of ${KINDS.join(' | ')}
- query: an EXACT YouTube search (2-6 words, no quotes/hashtags) that finds REAL footage of it

Query rules:
- Named people/companies → their real footage: "Toto Wolff" → "Toto Wolff Mercedes F1"
- Concrete actions/objects → literal footage: boxing → "boxing training session"
- Abstract concepts → visual metaphors: ${metaphors}
- Emotions → relatable reaction footage, e.g. "person shocked reaction"

Rules: never cue the first 3 seconds (the hook stays on the speaker); only cue sentences that dwell on the entity; prefer specific over generic. Fewer, stronger cues beat many weak ones. Return {"cues":[...]} and nothing else.`;
}

/** PURE: JSON schema for the cue response (Claude structured outputs). */
export function buildCueSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['cues'],
    properties: {
      cues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['start', 'end', 'entity', 'kind', 'query'],
          properties: {
            start: { type: 'number' }, end: { type: 'number' },
            entity: { type: 'string' },
            kind: { type: 'string', enum: KINDS },
            query: { type: 'string' },
          },
        },
      },
    },
  };
}

/** PURE: validate/clamp a raw LLM response into BrollCues (bad items dropped, ≤MAX_CUES, sorted). */
export function parseCues(raw: unknown, clipDurSec: number): BrollCue[] {
  const cues = (raw as { cues?: unknown })?.cues;
  if (!Array.isArray(cues)) return [];
  const out: BrollCue[] = [];
  for (const c of cues) {
    const { start, end, entity, kind, query } = (c ?? {}) as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number') continue;
    if (typeof entity !== 'string' || !entity.trim()) continue;
    if (typeof query !== 'string' || !query.trim()) continue;
    if (!KINDS.includes(kind as BrollKind)) continue;
    const s = Math.max(0, start);
    const e = Math.min(clipDurSec, end);
    if (e - s < 1) continue;
    out.push({ start: +s.toFixed(2), end: +e.toFixed(2), entity: entity.trim(), kind: kind as BrollKind, query: query.trim().replace(/["#]/g, '') });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_CUES);
}

/** Extract B-roll cues for one clip via Claude (Gemini fallback). Never throws; [] when unavailable. */
export async function extractCues(
  segments: TranscriptSegment[], clipStart: number, clipEnd: number, sentiment?: string,
): Promise<BrollCue[]> {
  const sentences = clipSentences(segments, clipStart, clipEnd);
  if (sentences.length === 0) return [];
  const raw = await askJson({
    system: CUE_SYSTEM_PROMPT,
    prompt: buildCuePrompt(sentences, sentiment),
    schema: buildCueSchema(),
    label: 'broll-cues',
  });
  return parseCues(raw, clipEnd - clipStart);
}
