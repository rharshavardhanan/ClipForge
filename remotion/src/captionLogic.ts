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

// Which caption line to show at a given time. During a gap (no active word),
// anchor on the most recent word that has started, so captions hold the current
// line instead of snapping back to line 0.
export function visibleLineIndex(
  words: CaptionWord[], maxPerLine: number, timeSec: number, leadMs: number,
): number {
  if (words.length === 0) return 0;
  let anchor = findActiveIndex(words, timeSec, leadMs);
  if (anchor === -1) {
    const t = timeSec + leadMs / 1000;
    anchor = 0;
    for (let k = 0; k < words.length; k++) {
      if (words[k].start <= t) anchor = k;
      else break;
    }
  }
  const lines = groupIntoLines(words, maxPerLine);
  let count = 0;
  for (let li = 0; li < lines.length; li++) {
    if (anchor >= count && anchor < count + lines[li].length) return li;
    count += lines[li].length;
  }
  return lines.length - 1;
}
