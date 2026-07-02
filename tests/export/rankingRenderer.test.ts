import { describe, it, expect } from 'vitest';
import { buildRankingProps, buildRankingRenderArgs, type RankingEntry } from '../../src/export/rankingRenderer.js';

const entries: RankingEntry[] = [
  { clipPath: '/x/clip_001_final.mp4', rank: 1, title: 'Winner' },
  { clipPath: '/x/clip_003_final.mp4', rank: 3 },
  { clipPath: '/x/clip_002_final.mp4', rank: 2, title: 'Runner up' },
];

describe('buildRankingProps', () => {
  it('plays highest rank number first (#3 → #1) regardless of input order', () => {
    const props = buildRankingProps(entries, [10, 30, 20], 30, 1.5, '#FFD700');
    expect(props.items.map((i) => i.rank)).toEqual([3, 2, 1]);
    expect(props.items[0].videoPath).toBe('input/rank_3.mp4');
    expect(props.items[2].title).toBe('Winner');
  });

  it('converts probed seconds to frames per entry and sets card frames', () => {
    const props = buildRankingProps(entries, [10, 30, 20], 30, 1.5, '#FFD700');
    // durations array is aligned with the INPUT entries order
    expect(props.items.find((i) => i.rank === 1)!.durationInFrames).toBe(300);
    expect(props.items.find((i) => i.rank === 3)!.durationInFrames).toBe(900);
    expect(props.cardFrames).toBe(45);
    expect(props.fps).toBe(30);
    expect(props.accentColor).toBe('#FFD700');
  });
});

describe('buildRankingRenderArgs', () => {
  it('targets the RankingVideo composition with h264/crf18 like the clip renderer', () => {
    const args = buildRankingRenderArgs('/tmp/props.json', '/out/ranking_final.mp4');
    const j = args.join(' ');
    expect(j).toContain('remotion render src/index.ts RankingVideo');
    expect(j).toContain('--props=/tmp/props.json');
    expect(j).toContain('--output=/out/ranking_final.mp4');
    expect(j).toContain('--codec=h264');
    expect(j).toContain('--crf=18');
  });
});
