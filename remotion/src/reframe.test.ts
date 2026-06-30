import { describe, it, expect } from 'vitest';
import { reframeStyle, type CropKeyframe } from './reframe';

describe('reframeStyle', () => {
  it('empty track -> cover-fit centered layout', () => {
    const srcW = 1920;
    const srcH = 1080;
    const layout = reframeStyle([], 0, srcW, srcH);
    const expectedScale = Math.max(1080 / srcW, 1920 / srcH);
    expect(layout.width).toBeCloseTo(srcW * expectedScale, 5);
    expect(layout.height).toBeCloseTo(srcH * expectedScale, 5);
    expect(layout.width).toBeGreaterThanOrEqual(1080);
    expect(layout.height).toBeGreaterThanOrEqual(1920);
    expect(layout.left).toBeCloseTo((1080 - layout.width) / 2, 5);
    expect(layout.top).toBeCloseTo((1920 - layout.height) / 2, 5);
  });

  it('a centered single keyframe maps the crop window to fill the frame', () => {
    const srcW = 1920;
    const srcH = 1080;
    const cropW = 600;
    const track: CropKeyframe[] = [
      { time: 0, cx: srcW / 2, cy: srcH / 2, cropW, cropH: (cropW * 16) / 9 },
    ];
    const layout = reframeStyle(track, 0, srcW, srcH);
    const s = 1080 / cropW;
    expect(s).toBeCloseTo(1080 / cropW, 10);
    expect(layout.left + (srcW / 2) * s).toBeCloseTo(540, 5);
    expect(layout.top + (srcH / 2) * s).toBeCloseTo(960, 5);
  });

  it('an off-center keyframe (cx larger) shifts the video left vs the centered case', () => {
    const srcW = 1920;
    const srcH = 1080;
    const cropW = 600;
    const centeredTrack: CropKeyframe[] = [
      { time: 0, cx: srcW / 2, cy: srcH / 2, cropW, cropH: (cropW * 16) / 9 },
    ];
    const offCenterTrack: CropKeyframe[] = [
      { time: 0, cx: srcW / 2 + 300, cy: srcH / 2, cropW, cropH: (cropW * 16) / 9 },
    ];
    const centered = reframeStyle(centeredTrack, 0, srcW, srcH);
    const offCenter = reframeStyle(offCenterTrack, 0, srcW, srcH);
    expect(offCenter.left).toBeLessThan(centered.left);
  });

  it('interpolates cx between two keyframes at the midpoint time', () => {
    const srcW = 1920;
    const srcH = 1080;
    const cropW = 600;
    const track: CropKeyframe[] = [
      { time: 0, cx: 200, cy: 540, cropW, cropH: (cropW * 16) / 9 },
      { time: 2, cx: 800, cy: 540, cropW, cropH: (cropW * 16) / 9 },
    ];
    const layout = reframeStyle(track, 1, srcW, srcH);
    const s = 1080 / cropW;
    // recover implied cx from left: left = 540 - cx*s => cx = (540 - left) / s
    const impliedCx = (540 - layout.left) / s;
    expect(impliedCx).toBeGreaterThan(200);
    expect(impliedCx).toBeLessThan(800);
  });
});
