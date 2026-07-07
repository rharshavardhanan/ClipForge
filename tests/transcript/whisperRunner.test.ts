import { describe, it, expect } from 'vitest';
import { mapWhisperJson } from '../../src/transcript/whisperRunner.js';

const whisperOut = {
  transcription: [
    { offsets: { from: 0, to: 1200 }, text: ' Stay hard.', tokens: [
      { text: ' Stay', offsets: { from: 0, to: 600 } },
      { text: ' hard.', offsets: { from: 600, to: 1200 } },
    ]},
  ],
};

describe('mapWhisperJson', () => {
  it('maps tokens to words with seconds timing', () => {
    const segs = mapWhisperJson(whisperOut);
    expect(segs[0].words.map((w) => w.word.trim())).toEqual(['Stay', 'hard.']);
    expect(segs[0].words[0].start).toBeCloseTo(0);
    expect(segs[0].words[1].end).toBeCloseTo(1.2);
    expect(segs[0].text).toBe('Stay hard.');
  });

  it('filters out bracketed and empty/whitespace tokens', () => {
    const noisy = {
      transcription: [
        { offsets: { from: 0, to: 2000 }, text: ' Stay hard.', tokens: [
          { text: ' Stay', offsets: { from: 0, to: 600 } },
          { text: '[BLANK_AUDIO]', offsets: { from: 600, to: 1000 } },
          { text: '   ', offsets: { from: 1000, to: 1100 } },
          { text: ' hard.', offsets: { from: 1100, to: 2000 } },
        ]},
      ],
    };
    const segs = mapWhisperJson(noisy);
    expect(segs[0].words.map((w) => w.word.trim())).toEqual(['Stay', 'hard.']);
  });

  it('filters special tokens even with leading whitespace (real -ojf output)', () => {
    const noisy = {
      transcription: [
        { offsets: { from: 0, to: 1500 }, text: ' Stay hard.', tokens: [
          { text: ' [_BEG_]', offsets: { from: 0, to: 0 } },
          { text: ' Stay', offsets: { from: 0, to: 600 } },
          { text: ' [_TT_42]', offsets: { from: 600, to: 600 } },
          { text: ' hard.', offsets: { from: 600, to: 1500 } },
        ]},
      ],
    };
    const segs = mapWhisperJson(noisy);
    expect(segs[0].words.map((w) => w.word.trim())).toEqual(['Stay', 'hard.']);
  });
});
