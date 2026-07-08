import { describe, expect, it } from 'vitest';
import { clipReactionEvents } from '../../src/perception/query.js';
import type { AudioEvent } from '../../src/perception/timeline.js';

const ev = (start: number, kind: AudioEvent['kind'], score: number): AudioEvent =>
  ({ start, end: start + 1, kind, score });

describe('clipReactionEvents', () => {
  it('filters to reaction kinds within the window and rebases to clip-relative time', () => {
    const events = [
      ev(12, 'laughter', 0.9),   // in window → t=2
      ev(5, 'laughter', 0.9),    // before window
      ev(14, 'speech', 1.0),     // not a reaction kind
      ev(15, 'impact', 0.6),     // in window → t=5
      ev(16, 'applause', 0.3),   // below scoreMin
      ev(60, 'cheer', 0.9),      // after window
    ];
    const out = clipReactionEvents(events, 10, 40);
    expect(out).toEqual([
      { t: 2, kind: 'laughter', score: 0.9 },
      { t: 5, kind: 'impact', score: 0.6 },
    ]);
  });

  it('returns [] for empty input (perception-off identity)', () => {
    expect(clipReactionEvents([], 0, 30)).toEqual([]);
  });
});
