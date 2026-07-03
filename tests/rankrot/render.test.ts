import { describe, it, expect } from 'vitest';
import { buildRankRotSfxPlan, planRankRotSfx, buildRankRotProps, type RankRotRenderItem } from '../../src/rankrot/render.js';
import { rankrotSfxSeconds, buildRankRotTimeline, totalRankRotFrames, type RankRotItem } from '../../remotion/src/rankrotLogic.js';

const items: RankRotRenderItem[] = [
  { file: '/m/5.mp4', rank: 5, durationSec: 4, microTitle: 'OH MY', replay: false },
  { file: '/m/4.mp4', rank: 4, durationSec: 6, microTitle: 'DESTROYED', replay: true },
  { file: '/m/1.mp4', rank: 1, durationSec: 8, microTitle: 'GG', replay: true },
];

/** The node-side SFX plan MUST mirror the Remotion timeline exactly (house contract). */
describe('SFX mirror: src/rankrot/render.ts ↔ remotion/src/rankrotLogic.ts', () => {
  it('produces identical event times at 30fps', () => {
    const fps = 30;
    const nodePlan = buildRankRotSfxPlan(items, fps);
    const remotionItems: RankRotItem[] = items.map((it) => ({
      videoPath: 'x', rank: it.rank, microTitle: it.microTitle, replay: it.replay,
      durationInFrames: Math.max(1, Math.round(it.durationSec * fps)),
    }));
    const remotionPlan = rankrotSfxSeconds(remotionItems, fps);
    expect(nodePlan.whooshes).toEqual(remotionPlan.whooshes);
    expect(nodePlan.impacts).toEqual(remotionPlan.impacts);
    expect(nodePlan.riser).toEqual(remotionPlan.riser);
    expect(nodePlan.bass).toEqual(remotionPlan.bass);
  });
});

describe('planRankRotSfx', () => {
  const lib = { whoosh: ['/s/w.mp3'], impact: ['/s/i.mp3'], riser: ['/s/r.mp3'], bass: ['/s/b.mp3'] };
  it('maps plan times to library one-shots, sorted', () => {
    const events = planRankRotSfx(buildRankRotSfxPlan(items, 30), lib, 'seed');
    expect(events.length).toBe(3 + 3 + 1 + 1); // whoosh×3 + impact×3 + riser + bass
    for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
  });
  it('missing kinds are skipped silently', () => {
    const events = planRankRotSfx(buildRankRotSfxPlan(items, 30), { impact: ['/s/i.mp3'] }, 'seed');
    expect(events).toHaveLength(3);
  });
});

describe('buildRankRotProps / timeline shape', () => {
  it('converts seconds to frames and keeps countdown order', () => {
    const props = buildRankRotProps(items, ['input/a.mp4', 'input/b.mp4', 'input/c.mp4'], 30, 'RANKING X', '(sub)', '#FFE81A');
    expect(props.items[0]).toMatchObject({ rank: 5, durationInFrames: 120, videoPath: 'input/a.mp4' });
    expect(props.items[2].rank).toBe(1);
    const segs = buildRankRotTimeline(props.items);
    expect(segs.filter((s) => s.kind === 'replay')).toHaveLength(2);
    expect(totalRankRotFrames(props.items)).toBe(segs[segs.length - 1].from + segs[segs.length - 1].durationInFrames);
  });
});
