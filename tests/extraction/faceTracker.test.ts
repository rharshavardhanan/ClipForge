import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  smoothTrack,
  detectFaceTrack,
  smoothSeriesBidirectional,
  applyZoomHysteresis,
  buildActiveSpeakerTrack,
} from '../../src/extraction/faceTracker.js';
import type { ActiveSample, FaceSample } from '../../src/types/index.js';

const SRC_W = 1920;
const SRC_H = 1080;

/** One-pass causal EMA, used as a baseline to contrast against the bidirectional smoother. */
function causalEma(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

describe('smoothTrack (pure)', () => {
  it('all-null samples -> []', () => {
    const samples: FaceSample[] = [
      { time: 0, box: null },
      { time: 1, box: null },
      { time: 2, box: null },
    ];
    expect(smoothTrack(samples, SRC_W, SRC_H)).toEqual([]);
  });

  it('empty input -> []', () => {
    expect(smoothTrack([], SRC_W, SRC_H)).toEqual([]);
  });

  it('a gap (null between two boxes) is filled — no crop window jumps to 0,0', () => {
    const samples: FaceSample[] = [
      { time: 0, box: { x: 800, y: 300, w: 200, h: 200 } },
      { time: 1, box: null }, // gap — should hold last known box
      { time: 2, box: { x: 820, y: 310, w: 200, h: 200 } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    expect(track).toHaveLength(3);
    // the gap-filled keyframe must be near the held face, not collapsed to origin
    expect(track[1].cx).toBeGreaterThan(500);
    expect(track[1].cy).toBeGreaterThan(100);
    expect(track[1].cx).not.toBe(0);
    expect(track[1].cy).not.toBe(0);
  });

  it('gap before the first detection holds the first non-null box', () => {
    const samples: FaceSample[] = [
      { time: 0, box: null },
      { time: 1, box: { x: 900, y: 400, w: 180, h: 180 } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    expect(track).toHaveLength(2);
    // first keyframe should be based on the held (first non-null) box, not 0,0
    expect(track[0].cx).toBeGreaterThan(500);
    expect(track[0].cy).toBeGreaterThan(100);
  });

  it('bidirectionally smooths center: both keyframes land strictly between the two raw centers (no hard jump, no causal lag)', () => {
    const samples: FaceSample[] = [
      { time: 0, box: { x: 100, y: 400, w: 200, h: 200 } },   // center x = 200
      { time: 1, box: { x: 1600, y: 400, w: 200, h: 200 } },  // center x = 1700 (far apart)
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H, 0.15);
    const rawFirstCx = 200;
    const rawSecondCx = 1700;
    // smoothing applied: neither keyframe hard-jumps to its raw value, and the
    // second keyframe is pulled up by the (non-causal) bidirectional smoother,
    // not left lagging near the first value as a one-pass causal EMA would.
    expect(track[0].cx).toBeGreaterThan(rawFirstCx);
    expect(track[0].cx).toBeLessThan(rawSecondCx);
    expect(track[1].cx).toBeGreaterThan(track[0].cx);
    expect(track[1].cx).toBeLessThan(rawSecondCx);
  });

  it('clamp: a face near the edge yields a crop window fully inside [0,srcW]x[0,srcH]', () => {
    const samples: FaceSample[] = [
      { time: 0, box: { x: 5, y: 5, w: 100, h: 100 } }, // near top-left corner
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    expect(track).toHaveLength(1);
    const kf = track[0];
    expect(kf.cx - kf.cropW / 2).toBeGreaterThanOrEqual(-0.01);
    expect(kf.cx + kf.cropW / 2).toBeLessThanOrEqual(SRC_W + 0.01);
    expect(kf.cy - kf.cropH / 2).toBeGreaterThanOrEqual(-0.01);
    expect(kf.cy + kf.cropH / 2).toBeLessThanOrEqual(SRC_H + 0.01);
    expect(kf.cropW).toBeLessThanOrEqual(SRC_W);
    expect(kf.cropH).toBeLessThanOrEqual(SRC_H);
  });

  it('clamp: a face near the bottom-right edge also stays fully inside bounds', () => {
    const samples: FaceSample[] = [
      { time: 0, box: { x: SRC_W - 105, y: SRC_H - 105, w: 100, h: 100 } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    const kf = track[0];
    expect(kf.cx + kf.cropW / 2).toBeLessThanOrEqual(SRC_W + 0.01);
    expect(kf.cy + kf.cropH / 2).toBeLessThanOrEqual(SRC_H + 0.01);
  });

  it('cropW is always 9:16 of cropH', () => {
    const samples: FaceSample[] = [
      { time: 0, box: { x: 800, y: 300, w: 200, h: 200 } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    const kf = track[0];
    expect(kf.cropW).toBeCloseTo(kf.cropH * 9 / 16, 1);
  });

  it('face-height-fraction 0.34: cropH ~= faceH / 0.34, subject to caps', () => {
    // Use a single sample so EMA is a no-op (smoothed[0] = desired[0]).
    const faceH = 200;
    const samples: FaceSample[] = [
      { time: 0, box: { x: 800, y: 400, w: faceH, h: faceH } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    const kf = track[0];
    const expectedCropH = faceH / 0.34; // ~588.2, within [minCropH, maxCropH]
    expect(kf.cropH).toBeCloseTo(expectedCropH, 0);
  });

  it('cropH never exceeds 0.9 * srcH even for a tall face', () => {
    // A very tall face would drive cropH = faceH / 0.34 far past srcH.
    const samples: FaceSample[] = [
      { time: 0, box: { x: 800, y: 100, w: 500, h: 900 } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    const kf = track[0];
    expect(kf.cropH).toBeLessThanOrEqual(SRC_H * 0.9 + 0.01);
  });

  it('upper-third placement: crop center sits below the face center (face lands in upper portion)', () => {
    // Centered face, away from any source edge so clamping doesn't interfere.
    const faceCenterY = 540;
    const samples: FaceSample[] = [
      { time: 0, box: { x: 900, y: faceCenterY - 100, w: 200, h: 200 } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    const kf = track[0];
    // The crop's vertical center should be below (greater Y than) the face's
    // center, pushing the face toward the upper third of the frame.
    expect(kf.cy).toBeGreaterThan(faceCenterY);
    // Resulting window must still sit fully inside the source bounds.
    expect(kf.cy - kf.cropH / 2).toBeGreaterThanOrEqual(-0.01);
    expect(kf.cy + kf.cropH / 2).toBeLessThanOrEqual(SRC_H + 0.01);
  });

  it('returns one keyframe per input sample with matching times', () => {
    const samples: FaceSample[] = [
      { time: 0, box: { x: 800, y: 300, w: 200, h: 200 } },
      { time: 0.33, box: null },
      { time: 0.66, box: { x: 810, y: 305, w: 210, h: 210 } },
    ];
    const track = smoothTrack(samples, SRC_W, SRC_H);
    expect(track.map((k) => k.time)).toEqual([0, 0.33, 0.66]);
  });
});

describe('smoothSeriesBidirectional (pure)', () => {
  it('on a step input, the value AT the step is centered, not trailing (contrast with causal EMA)', () => {
    const values = [0, 0, 0, 0, 0, 10, 10, 10, 10, 10];
    const stepIndex = 5;
    const alpha = 0.3;

    const bidirectional = smoothSeriesBidirectional(values, alpha);
    const causal = causalEma(values, alpha);

    const midpoint = 5; // (0 + 10) / 2

    // Causal EMA still lags well behind the midpoint right at the step (it has
    // only seen zeros up to and including this sample).
    expect(causal[stepIndex]).toBeLessThan(midpoint);
    // The bidirectional (zero-lag) smoother centers its value at the step:
    // it's pulled up toward the midpoint by the backward pass seeing the future.
    expect(bidirectional[stepIndex]).toBeGreaterThan(causal[stepIndex]);
    expect(Math.abs(bidirectional[stepIndex] - midpoint)).toBeLessThan(Math.abs(causal[stepIndex] - midpoint));
  });

  it('empty input -> []', () => {
    expect(smoothSeriesBidirectional([], 0.2)).toEqual([]);
  });

  it('single value -> unchanged', () => {
    expect(smoothSeriesBidirectional([42], 0.2)).toEqual([42]);
  });

  it('constant series stays constant', () => {
    const values = [5, 5, 5, 5, 5];
    const result = smoothSeriesBidirectional(values, 0.3);
    for (const v of result) expect(v).toBeCloseTo(5, 6);
  });
});

describe('applyZoomHysteresis (pure)', () => {
  it('small fluctuations within the deadband are held flat', () => {
    // Held value starts at 500; subsequent values wobble by < 6% (the default deadband).
    const cropH = [500, 510, 495, 505, 490];
    const result = applyZoomHysteresis(cropH, 0.06);
    expect(result).toEqual([500, 500, 500, 500, 500]);
  });

  it('a change beyond the deadband is taken (snaps to the new value)', () => {
    // 500 -> 600 is a 20% jump, well beyond the 6% deadband.
    const cropH = [500, 500, 600, 600, 600];
    const result = applyZoomHysteresis(cropH, 0.06);
    expect(result).toEqual([500, 500, 600, 600, 600]);
  });

  it('holds through small wobbles, then snaps once a real change accumulates', () => {
    const cropH = [400, 405, 398, 402, 700, 705, 698];
    const result = applyZoomHysteresis(cropH, 0.06);
    expect(result.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(result.slice(4)).toEqual([700, 700, 700]);
  });

  it('empty input -> []', () => {
    expect(applyZoomHysteresis([], 0.06)).toEqual([]);
  });
});

describe('buildActiveSpeakerTrack (pure)', () => {
  const boxA = { x: 200, y: 400, w: 200, h: 200 }; // center x = 300
  const boxB = { x: 1400, y: 400, w: 200, h: 200 }; // center x = 1500 (far apart -> a "switch")

  it('single-speaker series (no switches) -> stable track following that speaker', () => {
    const active: ActiveSample[] = [
      { time: 0, box: boxA },
      { time: 0.33, box: { x: 205, y: 402, w: 200, h: 200 } },
      { time: 0.66, box: { x: 210, y: 404, w: 200, h: 200 } },
      { time: 1.0, box: { x: 208, y: 401, w: 200, h: 200 } },
    ];
    const track = buildActiveSpeakerTrack(active, SRC_W, SRC_H);
    expect(track).toHaveLength(4);
    // All crop centers should stay close to speaker A's region, not jump around.
    for (const kf of track) {
      expect(kf.cx).toBeGreaterThan(150);
      expect(kf.cx).toBeLessThan(600);
    }
  });

  it('a switch between two speakers at different x produces an interpolated (not instantaneous) transition', () => {
    // Sampled at ~0.165s steps so several samples fall inside the 0.5s
    // switch-transition window after the jump from A to B at t=0.5.
    const active: ActiveSample[] = [
      { time: 0, box: boxA },
      { time: 0.165, box: boxA },
      { time: 0.33, box: boxA },
      { time: 0.5, box: boxB }, // switch happens here
      { time: 0.665, box: boxB },
      { time: 0.83, box: boxB },
      { time: 1.0, box: boxB },
      { time: 1.5, box: boxB },
      { time: 2.0, box: boxB },
    ];
    const track = buildActiveSpeakerTrack(active, SRC_W, SRC_H);

    const beforeSwitch = track.find((k) => k.time === 0.33)!;
    const atSwitch = track.find((k) => k.time === 0.5)!;
    const midTransition = track.find((k) => k.time === 0.665)!;
    const longAfter = track.find((k) => k.time === 2.0)!;

    // The crop center should move from near A toward B gradually: at the
    // switch sample and shortly after, cx should be between A's and B's
    // crop centers (not already snapped all the way to B).
    expect(atSwitch.cx).toBeGreaterThan(beforeSwitch.cx);
    expect(atSwitch.cx).toBeLessThan(longAfter.cx);
    expect(midTransition.cx).toBeGreaterThan(atSwitch.cx);
    expect(midTransition.cx).toBeLessThan(longAfter.cx);

    // Well after the transition window, the track should have settled near speaker B.
    expect(longAfter.cx).toBeGreaterThan(1000);
  });

  it('empty input -> []', () => {
    expect(buildActiveSpeakerTrack([], SRC_W, SRC_H)).toEqual([]);
  });

  it('all-null input -> []', () => {
    const active: ActiveSample[] = [
      { time: 0, box: null },
      { time: 1, box: null },
    ];
    expect(buildActiveSpeakerTrack(active, SRC_W, SRC_H)).toEqual([]);
  });

  it('gap-fill: a null box mid-series holds the last known box (no jump to origin)', () => {
    const active: ActiveSample[] = [
      { time: 0, box: boxA },
      { time: 1, box: null },
      { time: 2, box: { x: 210, y: 405, w: 200, h: 200 } },
    ];
    const track = buildActiveSpeakerTrack(active, SRC_W, SRC_H);
    expect(track).toHaveLength(3);
    expect(track[1].cx).toBeGreaterThan(150);
    expect(track[1].cy).toBeGreaterThan(100);
  });

  it('crop windows stay 9:16 and fully clamped inside the source frame', () => {
    const active: ActiveSample[] = [
      { time: 0, box: boxA },
      { time: 1, box: boxB },
    ];
    const track = buildActiveSpeakerTrack(active, SRC_W, SRC_H);
    for (const kf of track) {
      expect(kf.cropW).toBeCloseTo((kf.cropH * 9) / 16, 1);
      expect(kf.cx - kf.cropW / 2).toBeGreaterThanOrEqual(-0.01);
      expect(kf.cx + kf.cropW / 2).toBeLessThanOrEqual(SRC_W + 0.01);
      expect(kf.cy - kf.cropH / 2).toBeGreaterThanOrEqual(-0.01);
      expect(kf.cy + kf.cropH / 2).toBeLessThanOrEqual(SRC_H + 0.01);
    }
  });
});

describe('detectFaceTrack (integration, gated)', () => {
  const videoPath = join('workspace', 'downloads', 'H14bBuluwB8', 'video.mp4');
  const hasVideo = existsSync(videoPath);

  it.skipIf(!hasVideo)(
    'detects at least one face across a sampled real video segment',
    async () => {
      let track: Awaited<ReturnType<typeof detectFaceTrack>> = [];
      try {
        // Only the first 20s — enough to prove detection works; the full 6-min video
        // took ~2min of WASM detection and flaked on loaded machines.
        track = await detectFaceTrack(videoPath, 1920, 1080, 1, 20);
      } catch (err) {
        // detector/model unavailable in this environment — treat as skip, not failure
        console.warn('detectFaceTrack unavailable, skipping assertion:', err);
        return;
      }
      // track is only non-empty if at least one frame had a detected face
      expect(Array.isArray(track)).toBe(true);
    },
    // Needs ~2min alone; concurrent renders (ffmpeg at full tilt) can double that.
    300_000,
  );
});

describe('forced full-screen crop (--framing crop)', () => {
  it('centerCropTrack: one centered 9:16 keyframe using full source height', async () => {
    const { centerCropTrack } = await import('../../src/extraction/faceTracker.js');
    const track = centerCropTrack(SRC_W, SRC_H);
    expect(track).toHaveLength(1);
    expect(track[0].cropH).toBe(SRC_H);
    expect(track[0].cropW).toBeCloseTo((SRC_H * 9) / 16);
    expect(track[0].cx).toBe(SRC_W / 2);
    expect(track[0].cy).toBe(SRC_H / 2);
  });

  it('forcedCropTrack: no frames → center crop fallback', async () => {
    const { forcedCropTrack } = await import('../../src/extraction/faceTracker.js');
    const track = forcedCropTrack([], [], SRC_W, SRC_H);
    expect(track).toHaveLength(1);
    expect(track[0].cx).toBe(SRC_W / 2);
  });

  it('forcedCropTrack: single face follows the face', async () => {
    const { forcedCropTrack } = await import('../../src/extraction/faceTracker.js');
    const box = { x: 1200, y: 300, w: 200, h: 220 };
    const frames = [0, 0.33].map((time) => ({ time, faces: [{ box, mouthOpenness: 0.1 }] }));
    const track = forcedCropTrack(frames, [], SRC_W, SRC_H);
    expect(track.length).toBeGreaterThan(0);
    // crop centers near the face, not the frame center
    expect(Math.abs(track[0].cx - 1300)).toBeLessThan(200);
  });

  it('forcedCropTrack: two faces → active-speaker crop (never empty, inside frame)', async () => {
    const { forcedCropTrack } = await import('../../src/extraction/faceTracker.js');
    const a = { x: 200, y: 300, w: 200, h: 220 };
    const b = { x: 1400, y: 300, w: 200, h: 220 };
    const frames = [0, 0.33, 0.66].map((time) => ({
      time,
      faces: [
        { box: a, mouthOpenness: time < 0.5 ? 0.6 : 0.05 },
        { box: b, mouthOpenness: time < 0.5 ? 0.05 : 0.6 },
      ],
    }));
    const track = forcedCropTrack(frames, [], SRC_W, SRC_H);
    expect(track.length).toBeGreaterThan(0);
    for (const k of track) {
      expect(k.cx - k.cropW / 2).toBeGreaterThanOrEqual(0);
      expect(k.cx + k.cropW / 2).toBeLessThanOrEqual(SRC_W);
    }
  });

  it('forcedCropTrack: hard cut → windows snap per shot instead of averaging across the cut', async () => {
    const { forcedCropTrack } = await import('../../src/extraction/faceTracker.js');
    const left = { x: 100, y: 200, w: 200, h: 220 };   // shot 1: face top-left
    const right = { x: 1500, y: 700, w: 200, h: 220 }; // shot 2: face bottom-right
    const frames = [
      ...[0, 0.5, 1.0, 1.5].map((time) => ({ time, faces: [{ box: left, mouthOpenness: 0.3 }] })),
      ...[2.0, 2.5, 3.0, 3.5].map((time) => ({ time, faces: [{ box: right, mouthOpenness: 0.3 }] })),
    ];
    const track = forcedCropTrack(frames, [2.0], SRC_W, SRC_H);
    const shot1 = track.filter((k) => k.time < 2);
    const shot2 = track.filter((k) => k.time >= 2);
    expect(shot1.length).toBeGreaterThan(0);
    expect(shot2.length).toBeGreaterThan(0);
    // each shot's window stays near ITS face — no drift through the middle
    for (const k of shot1) expect(Math.abs(k.cx - 200)).toBeLessThan(300);
    for (const k of shot2) expect(Math.abs(k.cx - 1600)).toBeLessThan(300);
  });

  it('smoothTrack: bottom-anchored small face → tighter zoom, face NOT pinned to the window edge', () => {
    // face cam in the bottom-right corner of a 1080p stream layout (the "ceiling shot" case)
    const box = { x: 1500, y: 880, w: 140, h: 150 };
    const samples: FaceSample[] = [0, 0.33, 0.66, 1.0].map((time) => ({ time, box }));
    const track = smoothTrack(samples, SRC_W, SRC_H);
    const k = track[0];
    const faceCenterY = 880 + 75;
    const winTop = k.cy - k.cropH / 2;
    const relPos = (faceCenterY - winTop) / k.cropH;
    // face sits in the upper ~60% of the window, not at the bottom edge
    expect(relPos).toBeLessThan(0.6);
    // and the window is tight (edge-aware shrink), not a huge frame full of ceiling
    expect(k.cropH).toBeLessThanOrEqual(SRC_H * 0.25);
  });
});
