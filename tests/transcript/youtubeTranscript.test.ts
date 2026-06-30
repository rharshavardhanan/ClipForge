import { describe, it, expect } from 'vitest';
import { parseJson3 } from '../../src/transcript/youtubeTranscript.js';

const sample = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1200, segs: [
      { utf8: 'Nobody', tOffsetMs: 0 }, { utf8: ' tells', tOffsetMs: 400 }, { utf8: ' you', tOffsetMs: 800 },
    ]},
    // rolling-cue duplicate of the first words + new word
    { tStartMs: 1200, dDurationMs: 900, segs: [
      { utf8: 'Nobody', tOffsetMs: 0 }, { utf8: ' tells', tOffsetMs: 100 }, { utf8: ' you', tOffsetMs: 200 },
      { utf8: ' this.', tOffsetMs: 500 },
    ]},
    { utf8: '\n' } as any, // newline-only event must be ignored
  ],
});

describe('parseJson3', () => {
  it('extracts word-level timing and dedups rolling cues', () => {
    const segs = parseJson3(sample);
    const words = segs.flatMap((s) => s.words.map((w) => w.word.trim()));
    expect(words).toEqual(['Nobody', 'tells', 'you', 'this.']);
    expect(segs[0].words[0].start).toBeCloseTo(0);
    expect(segs[0].words[1].start).toBeCloseTo(0.4);
  });

  it('splits segments on sentence-ending punctuation', () => {
    const segs = parseJson3(sample);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[segs.length - 1].text).toMatch(/this\.$/);
  });

  it('preserves legitimate in-line word repetition (no over-dedup)', () => {
    const emphatic = JSON.stringify({ events: [
      { tStartMs: 0, segs: [
        { utf8: 'Stay', tOffsetMs: 0 }, { utf8: ' hard', tOffsetMs: 300 },
        { utf8: ' stay', tOffsetMs: 700 }, { utf8: ' hard.', tOffsetMs: 1000 },
      ]},
    ]});
    const segs = parseJson3(emphatic);
    const words = segs.flatMap((s) => s.words.map((w) => w.word.trim().toLowerCase()));
    expect(words).toEqual(['stay', 'hard', 'stay', 'hard.']);
  });

  it('drops only the rollover prefix on partial cross-event overlap', () => {
    const sample = JSON.stringify({ events: [
      { tStartMs: 0, segs: [{ utf8: 'A', tOffsetMs: 0 }, { utf8: ' B', tOffsetMs: 200 }, { utf8: ' C', tOffsetMs: 400 }] },
      { tStartMs: 1000, segs: [{ utf8: 'B', tOffsetMs: 0 }, { utf8: ' C', tOffsetMs: 100 }, { utf8: ' D', tOffsetMs: 300 }, { utf8: ' E', tOffsetMs: 500 }] },
    ]});
    const words = parseJson3(sample).flatMap((s) => s.words.map((w) => w.word.trim()));
    expect(words).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('filters out [Applause]/[Music] bracket annotations', () => {
    const raw = JSON.stringify({ events: [
      { tStartMs: 0, segs: [{ utf8: '[Applause]', tOffsetMs: 0 }, { utf8: 'hello', tOffsetMs: 500 }, { utf8: ' world.', tOffsetMs: 900 }] },
    ]});
    const words = parseJson3(raw).flatMap((s) => s.words.map((w) => w.word.trim()));
    expect(words).not.toContain('[Applause]');
    expect(words).toEqual(['hello', 'world.']);
  });

  it('joins words with single spaces even when segs lack leading spaces', () => {
    const raw = JSON.stringify({ events: [
      { tStartMs: 0, segs: [{ utf8: 'very', tOffsetMs: 0 }, { utf8: 'demanding', tOffsetMs: 400 }, { utf8: ' job', tOffsetMs: 800 }] },
    ]});
    expect(parseJson3(raw)[0].text).toBe('very demanding job');
  });

  it('splits unpunctuated continuous captions into multiple phrase-sized segments', () => {
    // 20 continuous words, no punctuation, ~0.3s apart -> must NOT be one mega-segment
    const segs = Array.from({ length: 20 }, (_, i) => ({ utf8: (i === 0 ? 'w0' : ' w' + i), tOffsetMs: i * 300 }));
    const raw = JSON.stringify({ events: [{ tStartMs: 0, segs }] });
    const out = parseJson3(raw);
    expect(out.length).toBeGreaterThan(1);
    out.forEach((s) => expect(s.words.length).toBeLessThanOrEqual(12));
  });
});
