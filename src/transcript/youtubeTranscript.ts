import type { TranscriptSegment, TranscriptWord } from '../types/index.js';

interface Seg { utf8: string; tOffsetMs?: number; }
interface Event { tStartMs?: number; dDurationMs?: number; segs?: Seg[]; }

export function parseJson3(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as { events?: Event[] };
  const norm = (s: string) => s.trim().toLowerCase();
  const isBracket = (s: string) => /^\[.*\]$/.test(s.trim()); // [Applause], [Music], etc.

  // Build per-event word lists with event-level rolling-cue prefix dedup (unchanged behavior).
  const kept: TranscriptWord[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    const eventWords: TranscriptWord[] = [];
    for (const seg of ev.segs) {
      const text = seg.utf8;
      if (!text || text.trim() === '') continue;   // whitespace/newline-only
      if (isBracket(text)) continue;                // non-speech annotation
      const start = (ev.tStartMs + (seg.tOffsetMs ?? 0)) / 1000;
      eventWords.push({ start, end: start, word: text, probability: 1 });
    }
    if (eventWords.length === 0) continue;
    let overlap = 0;
    const maxK = Math.min(kept.length, eventWords.length);
    for (let k = maxK; k > 0; k--) {
      const keptTail = kept.slice(kept.length - k).map((w) => norm(w.word));
      const evHead = eventWords.slice(0, k).map((w) => norm(w.word));
      if (keptTail.every((t, idx) => t === evHead[idx])) { overlap = k; break; }
    }
    kept.push(...eventWords.slice(overlap));
  }

  // Assign end = next word start; last word gets +0.4s.
  for (let i = 0; i < kept.length; i++) {
    kept[i].end = i + 1 < kept.length ? kept[i + 1].start : kept[i].start + 0.4;
  }

  // Group into phrase-sized segments. Auto-captions lack punctuation and run continuously,
  // so also split on pauses and cap segment size/duration. Join text space-safely.
  const MAX_WORDS = 12;
  const MAX_DUR = 7;    // seconds
  const PAUSE = 0.6;    // seconds
  const segments: TranscriptSegment[] = [];
  let cur: TranscriptWord[] = [];
  let id = 0;
  const flush = () => {
    if (!cur.length) return;
    segments.push({
      id: id++,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word.trim()).filter(Boolean).join(' '),
      words: cur,
    });
    cur = [];
  };
  for (let i = 0; i < kept.length; i++) {
    const w = kept[i];
    cur.push(w);
    const next = kept[i + 1];
    const gap = next ? next.start - w.end : 0;
    const endsSentence = /[.!?]"?$/.test(w.word.trim());
    const dur = w.end - cur[0].start;
    if (endsSentence || gap > PAUSE || cur.length >= MAX_WORDS || dur >= MAX_DUR) flush();
  }
  flush();
  return segments;
}
