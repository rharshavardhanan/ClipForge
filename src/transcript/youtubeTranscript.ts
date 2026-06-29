import type { TranscriptSegment, TranscriptWord } from '../types/index.js';

interface Seg { utf8: string; tOffsetMs?: number; }
interface Event { tStartMs?: number; dDurationMs?: number; segs?: Seg[]; }

export function parseJson3(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as { events?: Event[] };
  const flat: TranscriptWord[] = [];

  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    for (const seg of ev.segs) {
      const text = seg.utf8;
      if (!text || text.trim() === '') continue; // skip newline-only segs
      const start = (ev.tStartMs + (seg.tOffsetMs ?? 0)) / 1000;
      flat.push({ start, end: start, word: text, probability: 1 });
    }
  }

  // Dedup rolling cues: drop a word whose trimmed text + ~start matches the previous kept word.
  const deduped: TranscriptWord[] = [];
  for (const w of flat) {
    const prev = deduped[deduped.length - 1];
    const t = w.word.trim();
    if (prev && prev.word.trim() === t && Math.abs(prev.start - w.start) < 1.5) continue;
    // also skip if this exact word already appeared very recently at a near-identical time (rolling repeat)
    const recent = deduped.slice(-6).some((d) => d.word.trim() === t && Math.abs(d.start - w.start) < 1.5);
    if (recent) continue;
    deduped.push(w);
  }

  // Assign end = next word start; last word gets +0.4s.
  for (let i = 0; i < deduped.length; i++) {
    deduped[i].end = i + 1 < deduped.length ? deduped[i + 1].start : deduped[i].start + 0.4;
  }

  // Group into sentence-ish segments on terminal punctuation or gap > 0.8s.
  const segments: TranscriptSegment[] = [];
  let cur: TranscriptWord[] = [];
  let id = 0;
  const flush = () => {
    if (!cur.length) return;
    segments.push({
      id: id++, start: cur[0].start, end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word).join('').trim(), words: cur,
    });
    cur = [];
  };
  for (let i = 0; i < deduped.length; i++) {
    const w = deduped[i];
    cur.push(w);
    const endsSentence = /[.!?]"?$/.test(w.word.trim());
    const next = deduped[i + 1];
    const gap = next ? next.start - w.end : 0;
    if (endsSentence || gap > 0.8) flush();
  }
  flush();
  return segments;
}
