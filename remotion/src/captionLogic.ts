export interface CaptionWord { text: string; start: number; end: number; emphasized: boolean; }

export function groupIntoLines(words: CaptionWord[], maxPerLine: number): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  for (let i = 0; i < words.length; i += maxPerLine) lines.push(words.slice(i, i + maxPerLine));
  return lines;
}

export function findActiveIndex(words: CaptionWord[], timeSec: number, leadMs: number): number {
  const t = timeSec + leadMs / 1000;
  return words.findIndex((w) => t >= w.start && t < w.end);
}
