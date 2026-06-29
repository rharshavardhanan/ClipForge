import type { CaptionWord, TranscriptWord } from '../types/index.js';

export function buildCaptionWords(words: TranscriptWord[], clipStart: number, triggerPhrases: string[]): CaptionWord[] {
  const norm = words.map((w) => w.word.trim().toLowerCase().replace(/[^a-z0-9']/g, ''));
  const emphasizedIdx = new Set<number>();
  for (const phrase of triggerPhrases) {
    const tokens = phrase.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z0-9']/g, '')).filter(Boolean);
    for (let i = 0; i + tokens.length <= norm.length; i++) {
      if (tokens.every((t, k) => norm[i + k] === t)) {
        for (let k = 0; k < tokens.length; k++) emphasizedIdx.add(i + k);
      }
    }
  }
  return words.map((w, i) => ({
    text: w.word.trim(),
    start: Math.max(0, w.start - clipStart),
    end: Math.max(0, w.end - clipStart),
    emphasized: emphasizedIdx.has(i),
  }));
}
