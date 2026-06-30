import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import type { CropKeyframe, FaceBox, FaceSample } from '../types/index.js';

const MIN_CROP_H_FRACTION = 0.2; // floor for cropH as a fraction of srcH, avoids degenerate tiny windows
const MAX_CROP_H_FRACTION = 0.9; // ceiling for cropH as a fraction of srcH, avoids ever showing the full wide shot
const FACE_HEIGHT_FRACTION = 0.34; // target: face height ~34% of cropH (tighter framing)
const FACE_VERTICAL_POSITION = 0.38; // target: face vertical center sits at ~38% from top of crop (upper third)

/**
 * Smooths a (possibly sparse/gappy) sequence of face samples into a per-sample
 * sequence of 9:16 crop windows, EMA-smoothed and clamped to the source frame.
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
  const desired = filled.map((box) => {
    const cx = box.x + box.w / 2;
    const faceCenterY = box.y + box.h / 2;
    const cropH = clamp(box.h / FACE_HEIGHT_FRACTION, minCropH, maxCropH);
    // Position the face in the upper third: crop center sits below the face
    // center by (0.5 - FACE_VERTICAL_POSITION) * cropH.
    const cy = faceCenterY + (0.5 - FACE_VERTICAL_POSITION) * cropH;
    return { cx, cy, cropH };
  });

  // EMA smoothing across cx, cy, cropH.
  const smoothed: { cx: number; cy: number; cropH: number }[] = [];
  let prev = desired[0];
  smoothed.push(prev);
  for (let i = 1; i < desired.length; i++) {
    const d = desired[i];
    const next = {
      cx: alpha * d.cx + (1 - alpha) * prev.cx,
      cy: alpha * d.cy + (1 - alpha) * prev.cy,
      cropH: alpha * d.cropH + (1 - alpha) * prev.cropH,
    };
    smoothed.push(next);
    prev = next;
  }

  return samples.map((s, i) => {
    const { cx, cy, cropH } = smoothed[i];
    return { time: s.time, ...clampCropWindow(cx, cy, cropH, srcW, srcH) };
  });
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

/**
 * Samples frames from `videoPath` via ffmpeg, runs a face detector on each,
 * picks the dominant (largest-area) face per frame, and returns a smoothed
 * crop-track. Returns [] if no faces were found anywhere (caller falls back
 * to center-crop).
 */
export async function detectFaceTrack(
  videoPath: string,
  srcW: number,
  srcH: number,
  fps = 3,
): Promise<CropKeyframe[]> {
  const dir = await mkdtemp(join(tmpdir(), 'clipforge-facetrack-'));
  try {
    await mkdir(dir, { recursive: true });
    await run('ffmpeg', [
      '-y', '-i', videoPath,
      '-vf', `fps=${fps}`,
      join(dir, 'f_%04d.png'),
    ]);

    const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) return [];

    const detector = await loadDetector();
    const samples: FaceSample[] = [];
    for (let i = 0; i < files.length; i++) {
      const buf = await readFile(join(dir, files[i]));
      const box = await detector.detectDominantFace(buf);
      samples.push({ time: i / fps, box });
    }

    return smoothTrack(samples, srcW, srcH);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface Detector {
  detectDominantFace(pngBuffer: Buffer): Promise<FaceBox | null>;
}

let cachedDetector: Detector | null = null;

async function loadDetector(): Promise<Detector> {
  if (cachedDetector) return cachedDetector;

  const faceapi = await import('@vladmandic/face-api/dist/face-api.node-wasm.js');
  const { PNG } = await import('pngjs');

  const tf = (faceapi as any).tf;
  await tf.setBackend('wasm');
  await tf.ready();

  // Models ship inside the package — no network fetch needed at runtime.
  const modelPath = new URL('../../node_modules/@vladmandic/face-api/model', import.meta.url).pathname;
  await (faceapi as any).nets.tinyFaceDetector.loadFromDisk(modelPath);

  cachedDetector = {
    async detectDominantFace(pngBuffer: Buffer): Promise<FaceBox | null> {
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
        const results = await (faceapi as any).detectAllFaces(
          tensor,
          new (faceapi as any).TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }),
        );
        if (!results || results.length === 0) return null;
        const dominant = results.reduce((best: any, r: any) =>
          r.box.width * r.box.height > best.box.width * best.box.height ? r : best,
        );
        return {
          x: dominant.box.x,
          y: dominant.box.y,
          w: dominant.box.width,
          h: dominant.box.height,
        };
      } finally {
        tensor.dispose();
      }
    },
  };

  return cachedDetector;
}
