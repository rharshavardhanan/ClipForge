/** PURE: split thumbnail text into at most two visual lines, last word highlighted. */
export function splitThumbLines(text: string): { lines: string[]; lastWord: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1] ?? '';
  if (words.length <= 2) return { lines: [words.join(' ')], lastWord };
  const mid = Math.ceil(words.length / 2);
  return { lines: [words.slice(0, mid).join(' '), words.slice(mid).join(' ')], lastWord };
}
