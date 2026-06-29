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
});
