import { describe, it, expect } from 'vitest';
import {
  buildRankRotTimeline, totalRankRotFrames, railState, shakeOffset, punchInScale,
  CARD_FRAMES, FINAL_CARD_FRAMES, SHAKE_FRAMES, PUNCH_IN_FRAMES, type RankRotItem,
} from './rankrotLogic';

const items: RankRotItem[] = [
  { videoPath: 'a', rank: 3, durationInFrames: 90, microTitle: 'A', replay: false },
  { videoPath: 'b', rank: 2, durationInFrames: 120, microTitle: 'B', replay: true },
  { videoPath: 'c', rank: 1, durationInFrames: 150, microTitle: 'C', replay: false },
];

describe('buildRankRotTimeline', () => {
  const segs = buildRankRotTimeline(items);
  it('card → clip (→ replay) per item; #1 card holds longer', () => {
    expect(segs.map((s) => s.kind)).toEqual(['card', 'clip', 'card', 'clip', 'replay', 'card', 'clip']);
    expect(segs[0].durationInFrames).toBe(CARD_FRAMES);
    expect(segs[5].durationInFrames).toBe(FINAL_CARD_FRAMES); // #1 stinger
  });
  it('replay = 60% of the clip at half speed (double the frames)', () => {
    const replay = segs.find((s) => s.kind === 'replay')!;
    expect(replay.durationInFrames).toBe(Math.round((120 * 0.6) / 0.5));
  });
  it('segments are contiguous and total matches', () => {
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].from).toBe(segs[i - 1].from + segs[i - 1].durationInFrames);
    }
    expect(totalRankRotFrames(items)).toBeGreaterThan(0);
  });
});

describe('railState', () => {
  const segs = buildRankRotTimeline(items);
  it('fills ranks as the countdown progresses — #1 never lit early', () => {
    const atStart = railState(items, segs, 0);
    expect(atStart.activeRank).toBe(3);
    expect(atStart.doneRanks).toEqual([]);

    const secondClip = segs.find((s) => s.kind === 'clip' && s.itemIndex === 1)!;
    const mid = railState(items, segs, secondClip.from + 5);
    expect(mid.activeRank).toBe(2);
    expect(mid.doneRanks).toEqual([3]);
    expect(mid.doneRanks).not.toContain(1);

    const last = segs[segs.length - 1];
    const past = railState(items, segs, last.from + last.durationInFrames + 10);
    expect(past.activeRank).toBe(1);
  });
});

describe('shake + punch-in', () => {
  it('shake decays to zero after SHAKE_FRAMES and is deterministic', () => {
    expect(shakeOffset(0, 3)).toEqual(shakeOffset(0, 3));
    expect(shakeOffset(SHAKE_FRAMES, 3)).toEqual({ x: 0, y: 0 });
    expect(Math.abs(shakeOffset(1, 3).x)).toBeGreaterThan(Math.abs(shakeOffset(SHAKE_FRAMES - 1, 3).x));
  });
  it('punch-in eases 1.12 → 1', () => {
    expect(punchInScale(0)).toBeCloseTo(1.12);
    expect(punchInScale(PUNCH_IN_FRAMES)).toBe(1);
  });
});
