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
});
