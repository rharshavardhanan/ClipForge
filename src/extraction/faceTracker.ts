import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import { mouthOpenness, associateTracks, pickActiveSpeaker } from './activeSpeaker.js';
import { summarizeFraming, chooseFramingMode, type FramingMode } from './framing.js';
import { detectSceneCuts, segmentByCuts } from './sceneCuts.js';
import { smoothCameraAxis } from './camera.js';
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

/** Raw (unsmoothed) crop window {cx, cy, cropH} for a single face box, using the shared geometry.
 *  Edge-aware: when the face sits near the top/bottom of the source, a large window CANNOT
 *  hold it at the upper-third position (the frame clamp would pin the face to the window's
 *  edge — the "ceiling shot" bug). Shrink cropH so the upper-third placement actually fits. */
function desiredWindowForBox(
  box: FaceBox,
  minCropH: number,
  maxCropH: number,
  srcH: number,
): { cx: number; cy: number; cropH: number } {
  const cx = box.x + box.w / 2;
  const faceCenterY = box.y + box.h / 2;
  // Largest window that keeps the face at FACE_VERTICAL_POSITION fully inside the frame:
  //   bottom: faceCenterY + (1 - POS)·cropH <= srcH ;  top: faceCenterY - POS·cropH >= 0
  const bottomLimit = (srcH - faceCenterY) / (1 - FACE_VERTICAL_POSITION);
  const topLimit = faceCenterY / FACE_VERTICAL_POSITION;
  const fitH = Math.min(box.h / FACE_HEIGHT_FRACTION, bottomLimit, topLimit);
  const cropH = clamp(fitH, minCropH, maxCropH);
  // Position the face in the upper third: crop center sits below the face
  // center by (0.5 - FACE_VERTICAL_POSITION) * cropH.
  const cy = faceCenterY + (0.5 - FACE_VERTICAL_POSITION) * cropH;
  return { cx, cy, cropH };
}

/**
 * Smooths a (possibly sparse/gappy) sequence of face samples into a per-sample
 * sequence of crop windows (aspect, default 9:16): zero-lag (forward-backward) smoothed and
 * clamped to the source frame, with zoom hysteresis to kill breathing.
 * PURE — no I/O.
 */
export function smoothTrack(
  samples: FaceSample[],
  srcW: number,
  srcH: number,
  alpha = 0.15,
  aspect = 9 / 16,
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
  const desired = filled.map((box) => desiredWindowForBox(box, minCropH, maxCropH, srcH));

  // Camera v2 (v4 Slice D): cx/cy follow a lock-on/hold-then-glide path instead of drifting
  // continuously with the subject; cropH keeps its zoom hysteresis (already a hold behavior).
  const smoothedCx = smoothCameraAxis(desired.map((d) => d.cx), srcW);
  const smoothedCy = smoothCameraAxis(desired.map((d) => d.cy), srcH);
  const smoothedCropH = applyZoomHysteresis(
    smoothSeriesBidirectional(desired.map((d) => d.cropH), alpha),
    ZOOM_DEADBAND,
  );

  return samples.map((s, i) => {
    return {
      time: s.time,
      ...clampCropWindow(smoothedCx[i], smoothedCy[i], smoothedCropH[i], srcW, srcH, aspect),
    };
  });
}

/**
 * Builds a crop track (aspect, default 9:16) from an active-speaker box series (MS2). For each
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
  aspect = 9 / 16,
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

  const desired = filled.map((box) => desiredWindowForBox(box, minCropH, maxCropH, srcH));

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

  // Camera v2 (v4 Slice D): lock-on/hold-then-glide over the (switch-eased) desired path.
  const smoothedCx = smoothCameraAxis(eased.map((d) => d.cx), srcW);
  const smoothedCy = smoothCameraAxis(eased.map((d) => d.cy), srcH);
  const smoothedCropH = applyZoomHysteresis(
    smoothSeriesBidirectional(eased.map((d) => d.cropH), alpha),
    ZOOM_DEADBAND,
  );

  return active.map((s, i) => ({
    time: s.time,
    ...clampCropWindow(smoothedCx[i], smoothedCy[i], smoothedCropH[i], srcW, srcH, aspect),
  }));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Builds a crop window (default 9:16) from a center + height, clamped fully inside the source. */
function clampCropWindow(
  cx: number,
  cy: number,
  cropH: number,
  srcW: number,
  srcH: number,
  aspect = 9 / 16,
): { cx: number; cy: number; cropW: number; cropH: number } {
  let h = clamp(cropH, 1, srcH);
  let w = h * aspect;
  if (w > srcW) {
    w = srcW;
    h = clamp(w / aspect, 1, srcH);
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
  maxSec?: number,
  aspect = 9 / 16,
): Promise<CropKeyframe[]> {
  const frames = await detectFrameObs(videoPath, srcW, srcH, fps, maxSec);
  if (frames.length === 0) return [];
  if (frames.every((f) => f.faces.length === 0)) return [];

  const tracks = associateTracks(frames, srcW * TRACK_ASSOCIATION_DIST_FRACTION);
  if (tracks.length === 0) return [];

  if (tracks.length === 1) {
    const samples: FaceSample[] = tracks[0].samples.map((s) => ({ time: s.time, box: s.box }));
    return smoothTrack(samples, srcW, srcH, 0.15, aspect);
  }

  const active = pickActiveSpeaker(frames, tracks);
  return buildActiveSpeakerTrack(active, srcW, srcH, 0.15, aspect);
}

/** PURE: a single centered full-height crop keyframe (aspect, default 9:16) — the no-face fallback
 *  for forced full-screen framing (a constant window; reframe holds it). */
export function centerCropTrack(srcW: number, srcH: number, time = 0, aspect = 9 / 16): CropKeyframe[] {
  return [{ time, ...clampCropWindow(srcW / 2, srcH / 2, srcH, srcW, srcH, aspect) }];
}

/** PURE: cut-aware single-face smoothing — smooth INSIDE each shot, snap at cuts.
 *  Smoothing across a hard cut drags the window through no-man's land. */
export function smoothTrackSegmented(
  samples: FaceSample[],
  cuts: number[],
  srcW: number,
  srcH: number,
  aspect = 9 / 16,
): CropKeyframe[] {
  if (cuts.length === 0) return smoothTrack(samples, srcW, srcH, 0.15, aspect);
  const out: CropKeyframe[] = [];
  for (const seg of segmentByCuts(samples, cuts)) out.push(...smoothTrack(seg, srcW, srcH, 0.15, aspect));
  return out;
}

/**
 * PURE: best-available full-screen crop track (aspect, default 9:16) when the user FORCES crop framing.
 * Frames are segmented at scene cuts and each shot is handled independently
 * (face tracks must not survive a layout change):
 *  - 2+ people in the shot → follow the active speaker (eased switches)
 *  - 1 person → smooth face track
 *  - no faces → centered full-height crop for that shot
 * Never returns an empty track, so forced crop can never fall back to blur.
 */
export function forcedCropTrack(
  frames: FrameObs[],
  cuts: number[],
  srcW: number,
  srcH: number,
  aspect = 9 / 16,
): CropKeyframe[] {
  const out: CropKeyframe[] = [];
  for (const seg of segmentByCuts(frames, cuts)) {
    const tracks = associateTracks(seg, srcW * TRACK_ASSOCIATION_DIST_FRACTION);
    let track: CropKeyframe[] = [];
    if (tracks.length >= 2) {
      track = buildActiveSpeakerTrack(pickActiveSpeaker(seg, tracks), srcW, srcH, 0.15, aspect);
    } else if (tracks.length === 1) {
      track = smoothTrack(tracks[0].samples.map((s) => ({ time: s.time, box: s.box })), srcW, srcH, 0.15, aspect);
    }
    out.push(...(track.length > 0 ? track : centerCropTrack(srcW, srcH, seg[0].time, aspect)));
  }
  return out.length > 0 ? out : centerCropTrack(srcW, srcH, 0, aspect);
}

/**
 * Decide the base framing for a clip and, only when smart-crop is warranted, build the
 * crop-track. Blur-background is the default (natural, no face cutting); a single stable
 * close-up dominant face earns 'crop'; two-or-more people stay in blur. This is the
 * framing decision engine wired to real detections — see src/extraction/framing.ts.
 * `force` (--framing flag) overrides the auto decision: 'crop' always produces a
 * full-screen track (active-speaker → single-face → center fallback), 'blur' never crops.
 */
export async function planFraming(
  videoPath: string,
  srcW: number,
  srcH: number,
  fps = 3,
  force?: FramingMode,
  aspect = 9 / 16,
): Promise<{ mode: FramingMode; track: CropKeyframe[]; faces: FaceSample[] }> {
  const frames = await detectFrameObs(videoPath, srcW, srcH, fps);
  const tracks = frames.length > 0 ? associateTracks(frames, srcW * TRACK_ASSOCIATION_DIST_FRACTION) : [];

  // Dominant face samples power the arrow callouts (and thumbnail zoom) in BOTH modes.
  const dominant = tracks.length > 0 ? [...tracks].sort((a, b) => b.samples.length - a.samples.length)[0] : null;
  const faces: FaceSample[] = dominant ? dominant.samples.map((s) => ({ time: s.time, box: s.box })) : [];

  if (force === 'crop') {
    const cuts = await detectSceneCuts(videoPath);
    return { mode: 'crop', track: forcedCropTrack(frames, cuts, srcW, srcH, aspect), faces };
  }
  if (force === 'blur' || frames.length === 0) return { mode: 'blur', track: [], faces };

  const signal = summarizeFraming(tracks, frames.length, srcW, srcH);
  const mode = chooseFramingMode(signal);

  if (mode === 'crop' && dominant) {
    const cuts = await detectSceneCuts(videoPath);
    const track = smoothTrackSegmented(faces, cuts, srcW, srcH, aspect);
    if (track.length > 0) return { mode: 'crop', track, faces };
  }
  return { mode: 'blur', track: [], faces };
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
  maxSec?: number,
  startSec?: number,
): Promise<FrameObs[]> {
  const dir = await mkdtemp(join(tmpdir(), 'clipforge-frameobs-'));
  try {
    await mkdir(dir, { recursive: true });
    await run('ffmpeg', [
      '-y',
      // -ss before -i is a fast (keyframe) seek — cheap windowed sampling (v4 Slice B).
      ...(startSec !== undefined ? ['-ss', String(startSec)] : []),
      '-i', videoPath,
      ...(maxSec !== undefined ? ['-t', String(maxSec)] : []),
      '-vf', `fps=${fps}`,
      join(dir, 'f_%04d.png'),
    ]);

    const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) return [];

    const detector = await loadMultiFaceDetector();
    const frames: FrameObs[] = [];
    const base = startSec ?? 0;
    for (let i = 0; i < files.length; i++) {
      const buf = await readFile(join(dir, files[i]));
      const faces = await detector.detectAllFacesWithLandmarks(buf);
      frames.push({ time: base + i / fps, faces });
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
