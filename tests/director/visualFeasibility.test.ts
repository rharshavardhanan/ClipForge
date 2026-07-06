import { describe, it, expect } from 'vitest';
import { scoreVisualFeasibility, MAX_CUTS_PER_SEC } from '../../src/director/visualFeasibility.js';
import type { FrameObs } from '../../src/types/index.js';

const frameWithFace = (time: number): FrameObs => ({ time, faces: [{ box: { x: 0, y: 0, w: 10, h: 10 }, mouthOpenness: 0.1 }] });
const frameNoFace = (time: number): FrameObs => ({ time, faces: [] });

describe('scoreVisualFeasibility', () => {
  it('all frames have a face + no cuts → perfect', () => {
    const frames = [0, 1, 2].map(frameWithFace);
    const v = scoreVisualFeasibility(frames, [], 0, 10);
    expect(v.facePresence).toBe(1);
    expect(v.shotStability).toBe(1);
    expect(v.score).toBe(1);
  });

  it('no faces → zero face presence', () => {
    const frames = [0, 1, 2].map(frameNoFace);
    expect(scoreVisualFeasibility(frames, [], 0, 10).facePresence).toBe(0);
  });

  it('a cut every 2s (0.5/s) → zero shot stability', () => {
    const frames = [0, 5].map(frameWithFace);
    const cuts = [1, 3, 5, 7, 9]; // 5 cuts in a 10s window = 0.5/s = MAX
    const v = scoreVisualFeasibility(frames, cuts, 0, 10);
    expect(v.shotStability).toBeCloseTo(1 - (0.5 / MAX_CUTS_PER_SEC));
    expect(v.shotStability).toBe(0);
  });

  it('half the frames have faces, one cut → blended score in (0,1)', () => {
    const frames = [frameWithFace(0), frameNoFace(1), frameWithFace(2), frameNoFace(3)];
    const v = scoreVisualFeasibility(frames, [5], 0, 10);
    expect(v.facePresence).toBe(0.5);
    expect(v.score).toBeGreaterThan(0);
    expect(v.score).toBeLessThan(1);
  });

  it('empty frames → score 0 (no evidence of a subject)', () => {
    expect(scoreVisualFeasibility([], [], 0, 10).score).toBe(0);
  });
});
