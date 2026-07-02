import { describe, it, expect } from 'vitest';
import { snapStart, snapEnd, coldOpenTrim, clampDuration, buildClips } from '../../src/clipDetection/merger.js';
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
  it('clampDuration hard-caps at 90s', () => {
    expect(clampDuration(0, 200)).toEqual({ start: 0, end: 90 });
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
    expect(clips[0].end - clips[0].start).toBeGreaterThanOrEqual(30);
    expect(clips[0].end - clips[0].start).toBeLessThanOrEqual(90);
  });

  it('clampDuration pulls a short clip up to 30s', () => {
    expect(clampDuration(0, 10)).toEqual({ start: 0, end: 30 });
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
    expect(clips.length).toBe(1);
    // expanded well beyond a single 30s window, but never past the 90s cap
    expect(clips[0].end - clips[0].start).toBeGreaterThanOrEqual(60);
    expect(clips[0].end - clips[0].start).toBeLessThanOrEqual(90);
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
