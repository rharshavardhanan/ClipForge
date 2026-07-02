import { describe, it, expect } from 'vitest';
import { buildTimeline, totalFrames, type RankingItem } from './rankingLogic';

const items: RankingItem[] = [
  { videoPath: 'input/rank_3.mp4', rank: 3, durationInFrames: 900 },
  { videoPath: 'input/rank_2.mp4', rank: 2, durationInFrames: 600 },
  { videoPath: 'input/rank_1.mp4', rank: 1, durationInFrames: 1200, title: 'The winner' },
];

describe('buildTimeline', () => {
  it('emits card+clip per item in given order with accumulating offsets', () => {
    const segs = buildTimeline(items, 45);
    expect(segs).toHaveLength(6);
    expect(segs[0]).toEqual({ kind: 'card', itemIndex: 0, from: 0, durationInFrames: 45 });
    expect(segs[1]).toEqual({ kind: 'clip', itemIndex: 0, from: 45, durationInFrames: 900 });
    expect(segs[2]).toEqual({ kind: 'card', itemIndex: 1, from: 945, durationInFrames: 45 });
    expect(segs[3]).toEqual({ kind: 'clip', itemIndex: 1, from: 990, durationInFrames: 600 });
    expect(segs[4]).toEqual({ kind: 'card', itemIndex: 2, from: 1590, durationInFrames: 45 });
    expect(segs[5]).toEqual({ kind: 'clip', itemIndex: 2, from: 1635, durationInFrames: 1200 });
  });

  it('returns [] for no items', () => {
    expect(buildTimeline([], 45)).toEqual([]);
  });
});

describe('totalFrames', () => {
  it('sums clips + one card per clip', () => {
    expect(totalFrames(items, 45)).toBe(900 + 600 + 1200 + 3 * 45);
  });
  it('is at least 1 for empty items (Remotion requires a positive duration)', () => {
    expect(totalFrames([], 45)).toBe(1);
  });
});
