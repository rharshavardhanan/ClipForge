import { describe, it, expect } from 'vitest';
import { snapStart, snapEnd, coldOpenTrim, clampDuration, clampToSentences, buildClips } from '../../src/clipDetection/merger.js';
import type { TranscriptSegment, WindowScore, AudioEnergyLayer } from '../../src/types/index.js';

const segs: TranscriptSegment[] = [
  { id: 0, start: 0, end: 9, text: 'a', words: [] },
  { id: 1, start: 10, end: 19, text: 'b', words: [] },
  { id: 2, start: 20, end: 29, text: 'c', words: [] },
];

describe('boundary helpers', () => {
  it('snapStart moves to the enclosing/next segment start', () => {
    expect(snapStart(12, segs)).toBe(10);
    expect(snapStart(9.5, segs)).toBe(10);
  });
  it('snapEnd moves to the enclosing/previous segment end', () => {
    expect(snapEnd(15, segs)).toBe(19);
  });
  it('coldOpenTrim pushes past a leading silence', () => {
    expect(coldOpenTrim(10, [{ start: 9, end: 11 }])).toBe(11);
    expect(coldOpenTrim(10, [{ start: 30, end: 31 }])).toBe(10);
  });
  it('clampDuration hard-caps at 60s (extended ceiling)', () => {
    expect(clampDuration(0, 200)).toEqual({ start: 0, end: 60 });
  });
});

describe('buildClips', () => {
  it('produces a candidate around a high-score window', () => {
    const windows: WindowScore[] = [
      { start: 0, end: 30, triggerScore: 0, audioScore: 1, composite: 1 },
      { start: 15, end: 45, triggerScore: 9, audioScore: 8, composite: 8.6 },
      { start: 30, end: 60, triggerScore: 0, audioScore: 1, composite: 1 },
    ];
    const longSegs: TranscriptSegment[] = Array.from({ length: 12 }, (_, i) =>
      ({ id: i, start: i * 5, end: i * 5 + 4.5, text: `s${i}`, words: [] }));
    const audio: AudioEnergyLayer = { rms_curve: [], silence_regions: [] };
    const clips = buildClips(windows, longSegs, audio, 5);
    expect(clips.length).toBeGreaterThanOrEqual(1);
    expect(clips[0].end - clips[0].start).toBeGreaterThanOrEqual(15);
    expect(clips[0].end - clips[0].start).toBeLessThanOrEqual(30);
  });

  it('clampDuration pulls a very short clip up to the 15s floor', () => {
    expect(clampDuration(0, 5)).toEqual({ start: 0, end: 15 });
  });

  it('buildClips returns [] for empty windows and for all-below-threshold', () => {
    const audio = { rms_curve: [], silence_regions: [] };
    expect(buildClips([], [], audio, 5)).toEqual([]);
    const weak = [
      { start: 0, end: 30, triggerScore: 0, audioScore: 1, composite: 1 },
      { start: 15, end: 45, triggerScore: 0, audioScore: 1, composite: 1 },
    ];
    expect(buildClips(weak, [], audio, 5)).toEqual([]);
  });

  it('buildClips expands across consecutive high-score windows (multi-window arc)', () => {
    const windows = [
      { start: 0,  end: 30, triggerScore: 0, audioScore: 8, composite: 8 },
      { start: 15, end: 45, triggerScore: 0, audioScore: 8, composite: 8 },
      { start: 30, end: 60, triggerScore: 9, audioScore: 8, composite: 9 }, // peak
      { start: 45, end: 75, triggerScore: 0, audioScore: 8, composite: 8 },
      { start: 60, end: 90, triggerScore: 0, audioScore: 1, composite: 1 }, // drops below floor
    ];
    // segments every 5s so snapping does not distort much
    const segs = Array.from({ length: 18 }, (_, i) => ({ id: i, start: i * 5, end: i * 5 + 4.5, text: `s${i}`, words: [] }));
    const audio = { rms_curve: [], silence_regions: [] };
    const clips = buildClips(windows, segs, audio, 5);
    // Adaptive length: these neighbors hold peak-level heat (composite >= threshold), so the
    // arc may extend past the 30s soft cap — but never past the 60s hard cap.
    expect(clips.length).toBeGreaterThanOrEqual(1);
    for (const c of clips) {
      expect(c.end - c.start).toBeGreaterThanOrEqual(15);
      expect(c.end - c.start).toBeLessThanOrEqual(60);
    }
  });

  it('expansion past 30s requires peak-level neighbors (soft cap)', () => {
    // floor-level heat only around the peak → capped at the soft 30s
    const floorWindows = [
      { start: 0, end: 15, triggerScore: 0, audioScore: 6, composite: 6 },
      { start: 15, end: 30, triggerScore: 0, audioScore: 9, composite: 9 }, // peak
      { start: 30, end: 45, triggerScore: 0, audioScore: 6, composite: 6 },
    ];
    const clips = buildClips(floorWindows, [], { rms_curve: [], silence_regions: [] }, 8);
    expect(clips.length).toBeGreaterThanOrEqual(1);
    for (const c of clips) expect(c.end - c.start).toBeLessThanOrEqual(30);
  });

  it('sustained peak-level heat extends past 30s but never past 60s', () => {
    const hotWindows = Array.from({ length: 5 }, (_, k) => (
      { start: k * 15, end: (k + 1) * 15, triggerScore: 9, audioScore: 9, composite: 9 }
    ));
    const clips = buildClips(hotWindows, [], { rms_curve: [], silence_regions: [] }, 8);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips[0].end - clips[0].start).toBeGreaterThan(30);
    for (const c of clips) expect(c.end - c.start).toBeLessThanOrEqual(60);
  });

  it('carries the peak window commentScore onto the candidate', () => {
    const windows = [{ start: 0, end: 30, triggerScore: 9, audioScore: 9, composite: 9, commentScore: 7 }];
    const segs = [{ id: 0, start: 0, end: 30, text: 'a', words: [] }];
    const audio = { rms_curve: [], silence_regions: [] };
    const clips = buildClips(windows, segs, audio, 5, 60);
    expect(clips[0].commentScore).toBe(7);
  });

  it('buildClips caps end at the provided video duration', () => {
    const windows = [{ start: 0, end: 30, triggerScore: 9, audioScore: 9, composite: 9 }];
    const segs = [{ id: 0, start: 0, end: 25, text: 'a', words: [] }];
    const audio = { rms_curve: [], silence_regions: [] };
    const clips = buildClips(windows, segs, audio, 5, 25); // duration = 25
    expect(clips[0].end).toBeLessThanOrEqual(25);
  });
});

describe('mode lengths (v6)', () => {
  it('clampDuration honors custom min/max', () => {
    expect(clampDuration(0, 200, { min: 15, soft: 25, max: 45 })).toEqual({ start: 0, end: 45 });
    expect(clampDuration(0, 5, { min: 20, soft: 45, max: 60 })).toEqual({ start: 0, end: 20 });
  });
  it('buildClips caps expansion at the mode max (clippies 45s)', () => {
    const longSegs = Array.from({ length: 30 }, (_, i) =>
      ({ id: i, start: i * 5, end: i * 5 + 4.9, text: `s${i}`, words: [] }));
    const windows = Array.from({ length: 20 }, (_, i) =>
      ({ start: i * 10, end: i * 10 + 10, triggerScore: 9, audioScore: 9, composite: 9 }));
    const audio = { rms_curve: [], silence_regions: [] };
    const clips = buildClips(windows, longSegs, audio, 5, Infinity, { min: 15, soft: 25, max: 45 });
    expect(clips.length).toBeGreaterThanOrEqual(1);
    for (const c of clips) expect(c.end - c.start).toBeLessThanOrEqual(45);
  });
});

describe('clampToSentences (never cut mid-sentence)', () => {
  // Sentences: [0,10) [10,22) [22,31) [31,44) [44,58) [58,63)
  const sentSegs: TranscriptSegment[] = [
    { id: 0, start: 0, end: 10, text: 'a', words: [] },
    { id: 1, start: 10, end: 22, text: 'b', words: [] },
    { id: 2, start: 22, end: 31, text: 'c', words: [] },
    { id: 3, start: 31, end: 44, text: 'd', words: [] },
    { id: 4, start: 44, end: 58, text: 'e', words: [] },
    { id: 5, start: 58, end: 63, text: 'f', words: [] },
  ];
  const L = { min: 15, soft: 25, max: 45 };

  it('over max: finishes the straddling sentence when overshoot is small', () => {
    // cap = 45, sentence [44,58) straddles → 58-0=58 > 45+3 → too big, retreat to 44
    expect(clampToSentences(0, 63, sentSegs, L).end).toBe(44);
    // cap = 10+45=55, straddling [44,58) ends at 58 ≤ 55+3 → sentence finishes
    expect(clampToSentences(10, 63, sentSegs, L).end).toBe(58);
  });

  it('over max: retreats to the last sentence boundary under the cap', () => {
    const { end } = clampToSentences(0, 63, sentSegs, L);
    expect(sentSegs.some((s) => s.end === end)).toBe(true); // lands ON a boundary
  });

  it('under min: extends to the sentence end that reaches the minimum', () => {
    // start 0, end 10 (9s < min 15) → sentence [10,22) reaches 15 → end 22
    expect(clampToSentences(0, 10, sentSegs, L).end).toBe(22);
  });

  it('degenerate transcript (one giant segment) falls back to the hard cap', () => {
    const giant: TranscriptSegment[] = [{ id: 0, start: 0, end: 300, text: 'x', words: [] }];
    expect(clampToSentences(0, 300, giant, L).end).toBe(45);
  });

  it('buildClips output always ends on a sentence boundary (or hard cap fallback)', () => {
    // Windows stay within the transcript span (0-63s), as scoreWindows produces in practice.
    const windows = Array.from({ length: 6 }, (_, i) =>
      ({ start: i * 10, end: Math.min(63, i * 10 + 10), triggerScore: 9, audioScore: 9, composite: 9 }));
    const audio = { rms_curve: [], silence_regions: [] };
    const clips = buildClips(windows, sentSegs, audio, 5, Infinity, L);
    for (const c of clips) {
      expect(sentSegs.some((s) => s.end === c.end) || c.end - c.start === L.max).toBe(true);
    }
  });
});
