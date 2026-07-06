/**
 * Filler-word detection (v4 Part 2 §4.1 `filler_penalty`, Part 3 §3.2 removal). Discourse
 * fillers add no content; a filler-dense candidate reads as rambling. Slice B uses the ratio
 * to penalize selection; Slice C reuses the lexicon to actually cut them. PURE.
 */

/** Single-word fillers (lowercase, apostrophe-kept). "so"/"well"/"right"/"actually" are
 *  context-dependent but count here — the ratio, not any single word, drives the penalty. */
export const FILLER_LEXICON: ReadonlySet<string> = new Set([
  'um', 'uh', 'er', 'ah', 'hmm', 'mm', 'like', 'basically', 'literally',
  'actually', 'right', 'so', 'well', 'anyway', 'okay', 'ok',
]);

/** Two-word phrase fillers checked as adjacent bigrams. */
const FILLER_BIGRAMS: ReadonlySet<string> = new Set([
  'you know', 'i mean', 'kind of', 'sort of', 'you see',
]);

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, '');
}

/** PURE: is this single token a filler word? */
export function isFillerWord(word: string): boolean {
  return FILLER_LEXICON.has(normalize(word));
}

/** PURE: fraction (0-1) of tokens that are filler — single words + known 2-grams. */
export function fillerRatio(text: string): number {
  const tokens = text.split(/\s+/).map(normalize).filter(Boolean);
  if (tokens.length === 0) return 0;
  let filler = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (i + 1 < tokens.length && FILLER_BIGRAMS.has(`${tokens[i]} ${tokens[i + 1]}`)) {
      filler += 2;
      i++; // consume both tokens of the bigram
      continue;
    }
    if (FILLER_LEXICON.has(tokens[i])) filler++;
  }
  return filler / tokens.length;
}
