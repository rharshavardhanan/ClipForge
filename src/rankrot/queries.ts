/**
 * RankRot query engine — turn one topic into several search variations so the harvest
 * casts a wide net. Gemini Flash generates them (NO Claude in the RankRot path, per spec);
 * a pure template fallback keeps the engine fully offline-capable.
 */
import { askGeminiJson } from '../broll/llmJson.js';

export const QUERY_COUNT = 5;

/** PURE: deterministic template variations for a topic — biased toward popular REAL footage,
 *  including TikTok reposts (TikTok itself has no search API; its hits live on YouTube). */
export function templateQueries(topic: string): string[] {
  const t = topic.trim().replace(/\s+/g, ' ');
  const bare = t.replace(/^best\s+|^top\s+\d+\s+/i, '');
  const set = [
    t,
    `${bare} viral tiktok`,
    `funniest ${bare} caught on camera`,
    `${bare} shorts`,
    `best ${bare} ever`,
    `${bare} viral moments`,
  ];
  return [...new Set(set.map((q) => q.toLowerCase()))].slice(0, QUERY_COUNT + 1);
}

/** PURE: prompt for Gemini query variations. */
export function buildQueryPrompt(topic: string): string {
  return `Topic: "${topic}"

Generate ${QUERY_COUNT} DIFFERENT YouTube search queries that find the MOST POPULAR short clips of this topic — REAL footage people actually filmed (viral TikTok reposts, caught-on-camera moments, famous clips). NEVER phrasing that attracts AI-generated/animated content. Vary the wording (viral/funniest/famous/caught on camera/tiktok), 2-6 words each, no hashtags, no quotes.

Return {"queries":["...", ...]} and nothing else.`;
}

/** PURE: validate the LLM payload; falls back to [] on junk. */
export function parseQueries(raw: unknown): string[] {
  const qs = (raw as { queries?: unknown })?.queries;
  if (!Array.isArray(qs)) return [];
  return [...new Set(qs.filter((q): q is string => typeof q === 'string' && q.trim().length > 2)
    .map((q) => q.trim().toLowerCase().replace(/["#]/g, '')))].slice(0, QUERY_COUNT);
}

/** Query variations for a topic: Gemini first, templates always merged in (topic first). */
export async function queryVariants(topic: string): Promise<string[]> {
  const templates = templateQueries(topic);
  const raw = await askGeminiJson({
    system: 'You are a viral shorts researcher. Return ONLY valid JSON.',
    prompt: buildQueryPrompt(topic),
    schema: {
      type: 'object', additionalProperties: false, required: ['queries'],
      properties: { queries: { type: 'array', items: { type: 'string' } } },
    },
    label: 'rankrot-queries',
  });
  const llm = parseQueries(raw);
  return [...new Set([templates[0], ...llm, ...templates.slice(1)])].slice(0, QUERY_COUNT + 1);
}
