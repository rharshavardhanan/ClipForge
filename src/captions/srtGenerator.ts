import type { CaptionWord } from '../types/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function formatTimestamp(sec: number): string {
  const msTotal = Math.round(sec * 1000);
  const ms = msTotal % 1000;
  const total = Math.floor(msTotal / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms).padStart(3, '0')}`;
}

export function groupCues(words: CaptionWord[], maxPerLine: number) {
  const cues: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < words.length; i += maxPerLine) {
    const chunk = words.slice(i, i + maxPerLine);
    cues.push({ start: chunk[0].start, end: chunk[chunk.length - 1].end, text: chunk.map((w) => w.text).join(' ') });
  }
  return cues;
}

export async function writeSrt(words: CaptionWord[], outPath: string): Promise<void> {
  const cues = groupCues(words, 4);
  const body = cues.map((c, i) =>
    `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}\n`).join('\n');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, body);
}
