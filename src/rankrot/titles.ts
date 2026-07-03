/**
 * RankRot titles — brainrot top title + subtext, per-clip meme micro-captions, and the
 * SEO pack. Gemini Flash polishes when available (NO Claude in this engine); seeded
 * template fallbacks keep everything deterministic offline.
 */
import { createHash } from 'node:crypto';
import { askGeminiJson } from '../broll/llmJson.js';

/** Seeded meme captions (spec register) — fallback when Gemini is unavailable. */
export const MICRO_FALLBACKS = [
  'OH MY', 'BRO GOT COOKED', 'HE FELL HARD', 'DESTROYED', 'NOT LIKE THIS',
  'BRO TRIPPING', 'NAH THIS CRAZY', 'HE AINT RECOVERING', 'GG', 'CERTIFIED INSANE',
];

/** PURE: deterministic pick from the fallback pool. */
export function seededMicro(seed: string, exclude: string[] = []): string {
  const pool = MICRO_FALLBACKS.filter((m) => !exclude.includes(m));
  const src = pool.length > 0 ? pool : MICRO_FALLBACKS;
  const n = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
  return src[n % src.length];
}

/** PURE: RANKING <TOPIC> top title + spec subtext. */
export function buildTopTitle(topic: string): { title: string; subtext: string } {
  const clean = topic.trim().replace(/\s+/g, ' ').replace(/^top\s+\d+\s+/i, '').replace(/^ranking\s+/i, '');
  return { title: `RANKING ${clean.toUpperCase()}`, subtext: '(last one is insane)' };
}

export interface RankRotSeo { title: string; description: string; hashtags: string[]; }

/** PURE: templated SEO pack for a topic (Gemini may replace the title later). */
export function buildRankrotSeo(topic: string, top: number): RankRotSeo {
  const clean = topic.trim().replace(/\s+/g, ' ').replace(/^top\s+\d+\s+/i, '').replace(/^best\s+/i, '');
  const cap = clean.replace(/\b\w/g, (c) => c.toUpperCase());
  const nicheTag = '#' + clean.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).slice(0, 2).join('');
  const hashtags = ['#shorts', nicheTag, '#viral', '#top' + top, '#ranking', '#fyp'];
  return {
    title: `Top ${top} Craziest ${cap} 😱 ${hashtags.slice(0, 2).join(' ')}`,
    description: [
      `Ranking the top ${top} ${clean} — number 1 is absolutely insane. Which one is your favorite?`,
      '',
      'Watch till the end for #1 🤯',
      '',
      hashtags.join(' '),
    ].join('\n'),
    hashtags,
  };
}

/** PURE: prompt asking Gemini for micro-captions + a punchier title in ONE call. */
export function buildTitlesPrompt(topic: string, clipTitles: string[], top: number): string {
  const list = clipTitles.map((t, i) => `${i}: "${t}"`).join('\n');
  return `Topic: "${topic}" — a Top-${top} brainrot ranking Short. Source clips (countdown order, #${top} first, #1 last):

${list}

1) For EACH clip, one meme micro-caption: 2-4 words, ALL CAPS, reaction-driven, funny (register: "BRO GOT COOKED", "HE FELL HARD", "NOT THE ANKLES"). No hashtags, no punctuation except ?!.
2) One viral video title under 60 chars with one emoji, ending with #shorts.

Return {"micros":[{"i":<index>,"text":"..."}],"title":"..."}.`;
}

/** PURE: fold the LLM payload into micro list + title, seeded fallbacks filling gaps. */
export function parseTitles(
  raw: unknown, clipCount: number, seedPrefix: string, fallbackTitle: string,
): { micros: string[]; title: string } {
  const used: string[] = [];
  const micros: string[] = [];
  for (let i = 0; i < clipCount; i++) {
    micros.push(seededMicro(`${seedPrefix}_${i}`, used));
    used.push(micros[i]);
  }
  let title = fallbackTitle;
  const obj = raw as { micros?: unknown; title?: unknown } | null;
  if (obj && Array.isArray(obj.micros)) {
    for (const m of obj.micros) {
      const { i, text } = (m ?? {}) as Record<string, unknown>;
      if (typeof i === 'number' && typeof text === 'string' && i >= 0 && i < clipCount && text.trim()) {
        micros[i] = text.trim().toUpperCase().slice(0, 28);
      }
    }
  }
  if (obj && typeof obj.title === 'string' && obj.title.trim().length > 8) title = obj.title.trim();
  return { micros, title };
}

export async function buildTitles(
  topic: string, clipTitles: string[], top: number,
): Promise<{ micros: string[]; seo: RankRotSeo; top: { title: string; subtext: string } }> {
  const seo = buildRankrotSeo(topic, top);
  const raw = await askGeminiJson({
    system: 'You write brainrot shorts captions. Return ONLY valid JSON.',
    prompt: buildTitlesPrompt(topic, clipTitles, top),
    schema: {
      type: 'object', additionalProperties: false, required: ['micros', 'title'],
      properties: {
        micros: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['i', 'text'],
            properties: { i: { type: 'integer' }, text: { type: 'string' } },
          },
        },
        title: { type: 'string' },
      },
    },
    label: 'rankrot-titles',
  });
  const { micros, title } = parseTitles(raw, clipTitles.length, topic, seo.title);
  return { micros, seo: { ...seo, title }, top: buildTopTitle(topic) };
}
