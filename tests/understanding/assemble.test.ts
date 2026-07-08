import { describe, expect, it } from 'vitest';
import {
  assembleUnderstanding, meanImportance01, sliceImportance, type ChunkUnderstanding,
} from '../../src/understanding/assemble.js';

const sc = (start: number, end: number, label: string, importance = 0.5, participants: string[] = []) =>
  ({ span: { start, end }, label, participants, goal: '', emotion: '', events: [], importance });
const SIG = { rms: [], motion: [], events: [], durationSec: 100, useSceneTerm: true };

describe('assembleUnderstanding', () => {
  it('assigns global ids and remaps per-chunk edge refs by offsets', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: '0-540', chunkSpan: { start: 0, end: 50 }, arcs: [], scenes: [sc(0, 10, 'a'), sc(10, 20, 'b')],
        edges: [{ from: 'sc0', to: 'sc1', type: 'setup_for', confidence: 0.8 }] },
      { chunkKey: '480-1020', chunkSpan: { start: 50, end: 100 }, arcs: [], scenes: [sc(50, 60, 'c')],
        edges: [] },
    ];
    const u = assembleUnderstanding(chunks, SIG, 'gemini');
    expect(u.scenes.map((s) => s.id)).toEqual(['sc0', 'sc1', 'sc2']);
    expect(u.edges).toEqual([{ from: 'sc0', to: 'sc1', type: 'setup_for', confidence: 0.8 }]);
    expect(u.provider).toBe('gemini');
  });

  it('merges seam scenes with same label + participant overlap, remapping edges to the survivor', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 50 }, arcs: [], scenes: [sc(0, 49.5, 'Gym Bet', 0.4, ['S0', 'S1'])],
        edges: [] },
      { chunkKey: 'b', chunkSpan: { start: 50, end: 100 }, arcs: [], scenes: [sc(50, 80, 'gym bet', 0.9, ['S0'])],
        edges: [{ from: 'sc0', to: 'sc0', type: 'callback', confidence: 0.9 }] }, // self after remap → dropped
    ];
    const u = assembleUnderstanding(chunks, SIG, 'gemini');
    expect(u.scenes).toHaveLength(1);
    expect(u.scenes[0].span).toEqual({ start: 0, end: 80 });
    expect(u.scenes[0].importance).toBe(0.9);           // max
    expect(u.scenes[0].participants.sort()).toEqual(['S0', 'S1']);
    expect(u.edges).toEqual([]);                        // merged-away → self-loop → dropped
  });

  it('does not merge across a >1s gap or different labels', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 100 }, arcs: [],
        scenes: [sc(0, 10, 'a'), sc(12, 20, 'a'), sc(20, 30, 'b')], edges: [] },
    ];
    const u = assembleUnderstanding(chunks, SIG, 'gemini');
    expect(u.scenes).toHaveLength(3);
  });

  it('does not merge when the union would exceed the 180s cap', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 200 }, arcs: [],
        scenes: [sc(0, 100, 'long'), sc(100.5, 190, 'long')], edges: [] },
    ];
    const u = assembleUnderstanding(chunks, { ...SIG, durationSec: 200 }, 'gemini');
    expect(u.scenes).toHaveLength(2);
  });

  it('does not merge when participant overlap is below 50%', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 300 }, arcs: [],
        scenes: [sc(0, 100, 'same', 0.5, ['S0', 'S1']), sc(100, 200, 'same', 0.5, ['S2', 'S3'])], edges: [] },
    ];
    const u = assembleUnderstanding(chunks, { ...SIG, durationSec: 300 }, 'gemini');
    expect(u.scenes).toHaveLength(2);
  });

  it('importance: scene term dominates where anchored; renormalizes when useSceneTerm=false', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 100 }, arcs: [], scenes: [sc(0, 50, 'hot', 1.0)], edges: [] },
    ];
    const withScene = assembleUnderstanding(chunks, { ...SIG }, 'gemini');
    const at10 = withScene.importance.find((p) => p.t === 10)!;
    const at80 = withScene.importance.find((p) => p.t === 80)!;
    expect(at10.v).toBeGreaterThan(at80.v);             // inside the hot scene > outside

    const noScene = assembleUnderstanding(chunks, { ...SIG, useSceneTerm: false }, 'none');
    // no rms/motion/events either → renormalized terms are all 0
    expect(noScene.importance.every((p) => p.v === 0)).toBe(true);
    expect(noScene.importance).toHaveLength(101);       // 0..100 inclusive at 1s
  });

  it('event term lifts the curve at audience events', () => {
    const chunks: ChunkUnderstanding[] = [];
    const u = assembleUnderstanding(chunks, {
      rms: [], motion: [], durationSec: 30, useSceneTerm: false,
      events: [{ start: 10, end: 12, kind: 'laughter', score: 1.0 }],
    }, 'none');
    const at11 = u.importance.find((p) => p.t === 11)!;
    const at20 = u.importance.find((p) => p.t === 20)!;
    expect(at11.v).toBeGreaterThan(at20.v);
  });
});

describe('sliceImportance / meanImportance01', () => {
  const curve = [{ t: 0, v: 0.2 }, { t: 1, v: 0.4 }, { t: 2, v: 0.6 }, { t: 3, v: 0.8 }];
  it('slices clip-relative', () => {
    expect(sliceImportance(curve, 1, 3)).toEqual([{ t: 0, v: 0.4 }, { t: 1, v: 0.6 }]);
  });
  it('means over the span, 0 on empty', () => {
    expect(meanImportance01(curve, 1, 3)).toBeCloseTo(0.5, 5);
    expect(meanImportance01([], 0, 10)).toBe(0);
  });
});
