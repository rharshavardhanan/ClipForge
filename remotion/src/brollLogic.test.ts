import { describe, it, expect } from 'vitest';
import { brollOpacityAt, brollScaleAt, brollActiveAt, FADE_FRAMES, KEN_BURNS_SCALE } from './brollLogic';

describe('brollOpacityAt', () => {
  it('fades in over FADE_FRAMES, holds at 1, fades out at the tail', () => {
    expect(brollOpacityAt(0, 120)).toBe(0);
    expect(brollOpacityAt(3, 120)).toBeCloseTo(0.5);
    expect(brollOpacityAt(60, 120)).toBe(1);
    expect(brollOpacityAt(120 - 3, 120)).toBeCloseTo(0.5);
  });
  it('short windows still fade sanely', () => {
    expect(brollOpacityAt(0, 8)).toBe(0);
    expect(brollOpacityAt(4, 8)).toBe(1);
  });
});

describe('brollScaleAt', () => {
  it('pushes linearly from 1 to 1+KEN_BURNS_SCALE', () => {
    expect(brollScaleAt(0, 100)).toBe(1);
    expect(brollScaleAt(50, 100)).toBeCloseTo(1 + KEN_BURNS_SCALE / 2);
    expect(brollScaleAt(100, 100)).toBeCloseTo(1 + KEN_BURNS_SCALE);
    expect(brollScaleAt(5, 0)).toBe(1);
  });
});

describe('brollActiveAt', () => {
  const windows = [{ videoPath: 'x', from: 30, durationInFrames: 60 }];
  it('is true inside a window, false outside (end exclusive)', () => {
    expect(brollActiveAt(windows, 29)).toBe(false);
    expect(brollActiveAt(windows, 30)).toBe(true);
    expect(brollActiveAt(windows, 89)).toBe(true);
    expect(brollActiveAt(windows, 90)).toBe(false);
  });
  it('FADE_FRAMES is short enough to read as a cut', () => {
    expect(FADE_FRAMES).toBeLessThanOrEqual(8);
  });
});
