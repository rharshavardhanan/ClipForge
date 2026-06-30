import { describe, it, expect } from 'vitest';
import { parseTimestamps, commentBoosts } from '../../src/analysis/commentSignals.js';

describe('parseTimestamps', () => {
  it('extracts mm:ss and h:mm:ss', () => {
    expect(parseTimestamps('best part at 3:42 and again 1:02:15')).toEqual([222, 3735]);
  });
  it('allows minutes >= 60 in mm:ss (long videos)', () => {
    expect(parseTimestamps('75:30 is gold')).toEqual([75 * 60 + 30]);
  });
  it('rejects impossible seconds/minutes', () => {
    expect(parseTimestamps('1:99 nope, 1:75:10 nope')).toEqual([]);
  });
  it('returns [] when no timestamps', () => {
    expect(parseTimestamps('great video, subscribed!')).toEqual([]);
  });
});

describe('commentBoosts', () => {
  it('clusters nearby timestamps and weights by likes', () => {
    const boosts = commentBoosts([
      { text: 'best moment 3:40', likes: 500 },
      { text: 'yeah 3:45 🔥', likes: 300 },
      { text: 'also 10:00 was ok', likes: 2 },
    ]);
    expect(boosts).toHaveLength(2);
    // the 3:4x cluster (lots of likes) is the strongest -> normalized to 10
    const strong = boosts.find((b) => b.time >= 215 && b.time <= 230);
    const weak = boosts.find((b) => b.time >= 595 && b.time <= 605);
    expect(strong?.weight).toBeCloseTo(10, 5);
    expect(weak!.weight).toBeLessThan(strong!.weight);
  });
  it('drops timestamps beyond the video duration', () => {
    const boosts = commentBoosts([{ text: 'at 99:00', likes: 10 }], 30, 60); // 99min > 60s maxTime
    expect(boosts).toEqual([]);
  });
  it('returns [] for comments without timestamps', () => {
    expect(commentBoosts([{ text: 'love it', likes: 9 }])).toEqual([]);
  });
});
