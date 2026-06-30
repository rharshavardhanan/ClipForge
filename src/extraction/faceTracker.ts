import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import { mouthOpenness, associateTracks, pickActiveSpeaker } from './activeSpeaker.js';
import type { ActiveSample, CropKeyframe, FaceBox, FaceSample, FrameObs } from '../types/index.js';

const MIN_CROP_H_FRACTION = 0.2; // floor for cropH as a fraction of srcH, avoids degenerate tiny windows
const MAX_CROP_H_FRACTION = 0.9; // ceiling for cropH as a fraction of srcH, avoids ever showing the full wide shot
const FACE_HEIGHT_FRACTION = 0.34; // target: face height ~34% of cropH (tighter framing)
const FACE_VERTICAL_POSITION = 0.38; // target: face vertical center sits at ~38% from top of crop (upper third)

// Speaker-switch transition: a center jump larger than this fraction of srcW
// between consecutive samples is treated as a speaker change and gets eased
// in over SWITCH_TRANSITION_SEC instead of snapping.
const SWITCH_JUMP_FRACTION = 0.15;
const SWITCH_TRANSITION_SEC = 0.5;
// Shot hysteresis: hold cropH unless the new value differs by more than this
// fraction of the current value (kills "breathing").
const ZOOM_DEADBAND = 0.06;

/**
 * Forward-backward (zero-lag, non-causal) EMA smoothing: runs a causal EMA
 * left-to-right, another causal EMA right-to-left, and averages the two.
 * Offline (whole series known up front), so a step input is smoothed
 * symmetrically around the step instead of lagging behind it like a
 * one-pass EMA would. PURE.
 */
export function smoothSeriesBidirectional(values: number[], alpha: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0]];

  const forward: number[] = new Array(n);
  forward[0] = values[0];
  for (let i = 1; i < n; i++) {
    forward[i] = alpha * values[i] + (1 - alpha) * forward[i - 1];
  }

  const backward: number[] = new Array(n);
  backward[n - 1] = values[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    backward[i] = alpha * values[i] + (1 - alpha) * backward[i + 1];
  }

  return forward.map((f, i) => (f + backward[i]) / 2);
}

/**
 * Shot hysteresis: walks a cropH series holding the previous value unless the
 * new (raw) value differs from the held value by more than `deadband` as a
 * fraction of the held value — then snaps to the new value. Kills small
 * zoom "breathing" while still tracking real zoom changes. PURE.
 */
export function applyZoomHysteresis(cropH: number[], deadband = 0.06): number[] {
  if (cropH.length === 0) return [];

  const result: number[] = new Array(cropH.length);
  let held = cropH[0];
  result[0] = held;
  for (let i = 1; i < cropH.length; i++) {
    const v = cropH[i];
    const threshold = Math.abs(held) * deadband;
    if (Math.abs(v - held) > threshold) {
      held = v;
    }
    result[i] = held;
  }
  return result;
}

/** Raw (unsmoothed) crop window {cx, cy, cropH} for a single face box, using the shared geometry. */
function desiredWindowForBox(
  box: FaceBox,
  minCropH: number,
  maxCropH: number,
): { cx: number; cy: number; cropH: number } {
  const cx = box.x + box.w / 2;
  const faceCenterY = box.y + box.h / 2;
  const cropH = clamp(box.h / FACE_HEIGHT_FRACTION, minCropH, maxCropH);
  // Position the face in the upper third: crop center sits below the face
  // center by (0.5 - FACE_VERTICAL_POSITION) * cropH.
  const cy = faceCenterY + (0.5 - FACE_VERTICAL_POSITION) * cropH;
  return { cx, cy, cropH };
}

/**
 * Smooths a (possibly sparse/gappy) sequence of face samples into a per-sample
 * sequence of 9:16 crop windows: zero-lag (forward-backward) smoothed and
 * clamped to the source frame, with zoom hysteresis to kill breathing.
 * PURE — no I/O.
 */
export function smoothTrack(
  samples: FaceSample[],
  srcW: number,
  srcH: number,
  alpha = 0.15,
): CropKeyframe[] {
  if (samples.length === 0) return [];
  if (samples.every((s) => s.box === null)) return [];

  // Gap-fill: hold last known box; before the first detection, hold the first non-null box.
  const firstNonNull = samples.find((s) => s.box !== null)!.box as FaceBox;
  const filled: FaceBox[] = [];
  let lastKnown: FaceBox = firstNonNull;
  for (const s of samples) {
    if (s.box !== null) {
      lastKnown = s.box;
      filled.push(s.box);
    } else {
      filled.push(lastKnown);
    }
  }

  const minCropH = srcH * MIN_CROP_H_FRACTION;
  const maxCropH = srcH * MAX_CROP_H_FRACTION;

  // Desired (raw, unsmoothed) crop window per sample.
  const desired = filled.map((box) => desiredWindowForBox(box, minCropH, maxCropH));

  const smoothedCx = smoothSeriesBidirectional(desired.map((d) => d.cx), alpha);
  const smoothedCy = smoothSeriesBidirectional(desired.map((d) => d.cy), alpha);
  const smoothedCropH = applyZoomHysteresis(
    smoothSeriesBidirectional(desired.map((d) => d.cropH), alpha),
    ZOOM_DEADBAND,
  );

  return samples.map((s, i) => {
    return {
      time: s.time,
      ...clampCropWindow(smoothedCx[i], smoothedCy[i], smoothedCropH[i], srcW, srcH),
    };
  });
}

/**
 * Builds a 9:16 crop track from an active-speaker box series (MS2). For each
 * sample, computes a desired crop window from its box using the same
 * geometry as `smoothTrack` (gap-filling null boxes by holding the last
 * known box). When the active speaker switches — detected as a large jump
 * in box center between consecutive samples — the crop center+size are eased
 * across ~SWITCH_TRANSITION_SEC of samples instead of snapping. The result is
 * then zero-lag smoothed (cx, cy, cropH) and zoom-hysteresis applied to
 * cropH, then clamped inside the source frame. PURE — no I/O.
 */
export function buildActiveSpeakerTrack(
  active: ActiveSample[],
  srcW: number,
  srcH: number,
  alpha = 0.15,
): CropKeyframe[] {
  if (active.length === 0) return [];
  if (active.every((s) => s.box === null)) return [];

  const firstNonNull = active.find((s) => s.box !== null)!.box as FaceBox;
  const filled: FaceBox[] = [];
  let lastKnown: FaceBox = firstNonNull;
  for (const s of active) {
    if (s.box !== null) {
      lastKnown = s.box;
      filled.push(s.box);
    } else {
      filled.push(lastKnown);
    }
  }

  const minCropH = srcH * MIN_CROP_H_FRACTION;
  const maxCropH = srcH * MAX_CROP_H_FRACTION;

  const desired = filled.map((box) => desiredWindowForBox(box, minCropH, maxCropH));

  // Detect speaker-switch jumps and ease the transition across ~0.5s of
  // samples instead of snapping straight to the new speaker's window.
  const jumpThreshold = srcW * SWITCH_JUMP_FRACTION;
  const eased: { cx: number; cy: number; cropH: number }[] = desired.map((d) => ({ ...d }));

  for (let i = 1; i < desired.length; i++) {
    const prevBox = filled[i - 1];
    const curBox = filled[i];
    const prevCenterX = prevBox.x + prevBox.w / 2;
    const curCenterX = curBox.x + curBox.w / 2;
    const jump = Math.abs(curCenterX - prevCenterX);
    if (jump <= jumpThreshold) continue;

    // Speaker switch detected at sample i: ease the crop window from the
    // pre-switch window (`from`) to the new speaker's window (`to`) across
    // the samples spanning the next SWITCH_TRANSITION_SEC, linear in time,
    // rather than snapping straight to `to` at sample i.
    const switchStartTime = active[i - 1].time;
    const from = eased[i - 1];
    const to = desired[i];
    let j = i;
    while (j < desired.length && active[j].time - switchStartTime <= SWITCH_TRANSITION_SEC) {
      const t = clamp((active[j].time - switchStartTime) / SWITCH_TRANSITION_SEC, 0, 1);
      eased[j] = {
        cx: from.cx + (to.cx - from.cx) * t,
        cy: from.cy + (to.cy - from.cy) * t,
        cropH: from.cropH + (to.cropH - from.cropH) * t,
      };
      j++;
    }
  }

  const smoothedCx = smoothSeriesBidirectional(eased.map((d) => d.cx), alpha);
  const smoothedCy = smoothSeriesBidirectional(eased.map((d) => d.cy), alpha);
  const smoothedCropH = applyZoomHysteresis(
    smoothSeriesBidirectional(eased.map((d) => d.cropH), alpha),
    ZOOM_DEADBAND,
  );

  return active.map((s, i) => ({
    time: s.time,
    ...clampCropWindow(smoothedCx[i], smoothedCy[i], smoothedCropH[i], srcW, srcH),
  }));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Builds a 9:16 crop window from a center + height, clamped fully inside [0,srcW]x[0,srcH]. */
function clampCropWindow(
  cx: number,
  cy: number,
  cropH: number,
  srcW: number,
  srcH: number,
): { cx: number; cy: number; cropW: number; cropH: number } {
  let h = clamp(cropH, 1, srcH);
  let w = (h * 9) / 16;
  if (w > srcW) {
    w = srcW;
    h = clamp((w * 16) / 9, 1, srcH);
  }

  const x = clamp(cx - w / 2, 0, srcW - w);
  const y = clamp(cy - h / 2, 0, srcH - h);

  return { cx: x + w / 2, cy: y + h / 2, cropW: w, cropH: h };
}

// Track-association distance threshold for `associateTracks`, as a fraction
// of source width (faces farther apart than this between sampled frames are
// treated as different people rather than the same face having moved).
const TRACK_ASSOCIATION_DIST_FRACTION = 0.25;

/**
 * Samples frames from `videoPath` via ffmpeg, detects all faces + landmarks
 * per frame, and associates them into tracks. Branches on the number of
 * distinct tracks found:
 *  - 0 tracks: returns [] (caller falls back to center-crop).
 *  - 1 track: single-subject path — `smoothTrack` on that track's samples.
 *  - >=2 tracks: multi-subject path — `pickActiveSpeaker` selects the active
 *    speaker per sample, then `buildActiveSpeakerTrack` builds the crop-track
 *    (with speaker-switch easing, zero-lag smoothing, zoom hysteresis).
 * Returns a smoothed crop-track either way; the return type and pipeline
 * usage are unchanged from MS1/RT3.
 */
export async function detectFaceTrack(
  videoPath: string,
  srcW: number,
  srcH: number,
  fps = 3,
): Promise<CropKeyframe[]> {
  const frames = await detectFrameObs(videoPath, srcW, srcH, fps);
  if (frames.length === 0) return [];
  if (frames.every((f) => f.faces.length === 0)) return [];

  const tracks = associateTracks(frames, srcW * TRACK_ASSOCIATION_DIST_FRACTION);
  if (tracks.length === 0) return [];

  if (tracks.length === 1) {
    const samples: FaceSample[] = tracks[0].samples.map((s) => ({ time: s.time, box: s.box }));
    return smoothTrack(samples, srcW, srcH);
  }

  const active = pickActiveSpeaker(frames, tracks);
  return buildActiveSpeakerTrack(active, srcW, srcH);
}

/**
 * Samples frames from `videoPath` via ffmpeg, runs multi-face detection +
 * 68-pt landmarks on each frame, and returns per-frame face observations
 * (box + mouthOpenness) for every detected face. Used by the multi-subject
 * / active-speaker path (MS1). Reuses the same sampling/cleanup approach as
 * `detectFaceTrack`.
 */
export async function detectFrameObs(
  videoPath: string,
  srcW: number,
  srcH: number,
  fps = 3,
): Promise<FrameObs[]> {
  const dir = await mkdtemp(join(tmpdir(), 'clipforge-frameobs-'));
  try {
    await mkdir(dir, { recursive: true });
    await run('ffmpeg', [
      '-y', '-i', videoPath,
      '-vf', `fps=${fps}`,
      join(dir, 'f_%04d.png'),
    ]);

    const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) return [];

    const detector = await loadMultiFaceDetector();
    const frames: FrameObs[] = [];
    for (let i = 0; i < files.length; i++) {
      const buf = await readFile(join(dir, files[i]));
      const faces = await detector.detectAllFacesWithLandmarks(buf);
      frames.push({ time: i / fps, faces });
    }

    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface MultiFaceDetector {
  detectAllFacesWithLandmarks(pngBuffer: Buffer): Promise<{ box: FaceBox; mouthOpenness: number }[]>;
}

let cachedMultiFaceDetector: MultiFaceDetector | null = null;

async function loadMultiFaceDetector(): Promise<MultiFaceDetector> {
  if (cachedMultiFaceDetector) return cachedMultiFaceDetector;

  const faceapi = await import('@vladmandic/face-api/dist/face-api.node-wasm.js');
  const { PNG } = await import('pngjs');

  const tf = (faceapi as any).tf;
  await tf.setBackend('wasm');
  await tf.ready();

  // Models ship inside the package — no network fetch needed at runtime.
  const modelPath = new URL('../../node_modules/@vladmandic/face-api/model', import.meta.url).pathname;
  await (faceapi as any).nets.tinyFaceDetector.loadFromDisk(modelPath);
  await (faceapi as any).nets.faceLandmark68Net.loadFromDisk(modelPath);

  cachedMultiFaceDetector = {
    async detectAllFacesWithLandmarks(pngBuffer: Buffer) {
      const png = PNG.sync.read(pngBuffer);
      const { width, height, data } = png;
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        rgb[j] = data[i];
        rgb[j + 1] = data[i + 1];
        rgb[j + 2] = data[i + 2];
      }
      const tensor = tf.tensor3d(rgb, [height, width, 3], 'int32');
      try {
        const results = await (faceapi as any)
          .detectAllFaces(tensor, new (faceapi as any).TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
          .withFaceLandmarks();
        if (!results || results.length === 0) return [];
        return results.map((r: any) => {
          const box: FaceBox = {
            x: r.detection.box.x,
            y: r.detection.box.y,
            w: r.detection.box.width,
            h: r.detection.box.height,
          };
          const positions = r.landmarks.positions.map((p: any) => ({ x: p.x, y: p.y }));
          return { box, mouthOpenness: mouthOpenness(positions) };
        });
      } finally {
        tensor.dispose();
      }
    },
  };

  return cachedMultiFaceDetector;
}
