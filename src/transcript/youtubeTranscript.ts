import type { TranscriptSegment, TranscriptWord } from '../types/index.js';

interface Seg { utf8: string; tOffsetMs?: number; }
interface Event { tStartMs?: number; dDurationMs?: number; segs?: Seg[]; }

export function parseJson3(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as { events?: Event[] };
  const norm = (s: string) => s.trim().toLowerCase();

  // Build per-event word lists, then dedup YouTube rolling cues at the EVENT level:
  // when a new event's leading words repeat the tail of what we've already kept (by text
  // sequence), that prefix is the rollover — drop it. This models the rolling-cue
  // mechanism without discarding legitimate in-speech repetition (e.g. "stay hard, stay hard").
  const kept: TranscriptWord[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    const eventWords: TranscriptWord[] = [];
    for (const seg of ev.segs) {
      const text = seg.utf8;
      if (!text || text.trim() === '') continue; // skip newline/whitespace-only segs
      const start = (ev.tStartMs + (seg.tOffsetMs ?? 0)) / 1000;
      eventWords.push({ start, end: start, word: text, probability: 1 });
    }
    if (eventWords.length === 0) continue;
    // largest K where the last K kept words (text) equal the first K event words (text)
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
  for (let i = 0; i < kept.length; i++) {
    const w = kept[i];
    cur.push(w);
    const endsSentence = /[.!?]"?$/.test(w.word.trim());
    const next = kept[i + 1];
    const gap = next ? next.start - w.end : 0;
    if (endsSentence || gap > 0.8) flush();
  }
  flush();
  return segments;
}
