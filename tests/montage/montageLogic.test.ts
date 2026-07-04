import { describe, it, expect } from 'vitest';
import { totalMontageFrames } from '../../remotion/src/montageLogic.js';

describe('totalMontageFrames', () => {
  it('total frames = end of the last segment', () => {
    expect(totalMontageFrames([
      { videoPath: 'a', from: 0, durationInFrames: 30, startFromFrames: 0, playbackRate: 1, freeze: false, zoom: false, shake: false },
      { videoPath: 'b', from: 30, durationInFrames: 45, startFromFrames: 0, playbackRate: 2, freeze: false, zoom: true, shake: true },
    ])).toBe(75);
    expect(totalMontageFrames([])).toBe(1);
  });
});
