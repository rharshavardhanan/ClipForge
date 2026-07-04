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

// Regression coverage for BUG I-1: reframe.ts used to hardcode FRAME_W=1080/FRAME_H=1920,
// so a 3:4 (1080x1440) composition still centered content around y=960 instead of y=720 —
// a ~240px vertical mis-centering. reframeStyle/coverLayout now take frameW/frameH explicitly
// (CaptionedClip.tsx passes useVideoConfig()'s real width/height); these default to 1080x1920
// so every pre-existing 9:16 call site (and the tests above) is byte-identical to before.
describe('reframeStyle — output frame dimensions (aspect-aware)', () => {
  it('omitting frameW/frameH defaults to 9:16 (1080x1920) — byte-identical to passing them explicitly', () => {
    const srcW = 1920;
    const srcH = 1080;
    const cropW = 600;
    const track: CropKeyframe[] = [{ time: 0, cx: 700, cy: 500, cropW, cropH: (cropW * 16) / 9 }];

    expect(reframeStyle(track, 0, srcW, srcH, 1080, 1920)).toEqual(reframeStyle(track, 0, srcW, srcH));
    expect(reframeStyle([], 0, srcW, srcH, 1080, 1920)).toEqual(reframeStyle([], 0, srcW, srcH));
  });

  it('empty track on a 3:4 frame (1080x1440) centers vertically at (1440-height)/2, not the old 1920-based value', () => {
    const srcW = 1920;
    const srcH = 1080;
    const frameW = 1080;
    const frameH = 1440;
    const layout = reframeStyle([], 0, srcW, srcH, frameW, frameH);
    const expectedScale = Math.max(frameW / srcW, frameH / srcH);
    expect(layout.width).toBeCloseTo(srcW * expectedScale, 5);
    expect(layout.height).toBeCloseTo(srcH * expectedScale, 5);
    expect(layout.left).toBeCloseTo((frameW - layout.width) / 2, 5);
    expect(layout.top).toBeCloseTo((frameH - layout.height) / 2, 5);
    // The bug: centering against a hardcoded FRAME_H=1920 instead of the real 1440 frame.
    expect(layout.top).not.toBeCloseTo((1920 - layout.height) / 2, 2);
  });

  it('a face-track keyframe on a 3:4 frame centers on frameH/2=720, not the old 1920/2=960', () => {
    const srcW = 1920;
    const srcH = 1080;
    const cropW = 600;
    const frameW = 1080;
    const frameH = 1440;
    const cy = 700;
    const track: CropKeyframe[] = [{ time: 0, cx: srcW / 2, cy, cropW, cropH: (cropW * 16) / 9 }];
    const layout = reframeStyle(track, 0, srcW, srcH, frameW, frameH);
    const s = frameW / cropW;
    expect(layout.top).toBeCloseTo(frameH / 2 - cy * s, 5);
    expect(layout.top).not.toBeCloseTo(1920 / 2 - cy * s, 2);
  });
});
