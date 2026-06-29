import { runFfmpegNull } from '../utils/ffmpeg.js';
import type { AudioEnergyLayer, RmsPoint, SilenceRegion } from '../types/index.js';

// Accept BOTH "lavfi.astats.Overall.RMS_level" and "lavfi.astats.RMS_level".
const RMS_RE = /lavfi\.astats\.(?:Overall\.)?RMS_level=(-?\d+(?:\.\d+)?|-?inf)/g;

export function parseRmsLevels(stderr: string): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(RMS_RE)) {
    const v = m[1];
    out.push(v.includes('inf') ? -100 : Number(v));
  }
  return out;
}

export function normalizeRms(db: number): number {
  const score = ((db + 50) / 40) * 10;
  return Math.max(0, Math.min(10, score));
}

export function parseSilenceRegions(stderr: string): SilenceRegion[] {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const regions: SilenceRegion[] = [];
  for (let i = 0; i < starts.length; i++) {
    if (ends[i] !== undefined) regions.push({ start: starts[i], end: ends[i] });
  }
  return regions;
}

export async function analyzeAudio(videoPath: string): Promise<AudioEnergyLayer> {
  // Per-second RMS: reset astats every 16000 samples (1s @ 16kHz), print the metadata key.
  const rmsErr = await runFfmpegNull(
    videoPath,
    'aresample=16000,astats=metadata=1:reset=16000,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level',
  );
  const levels = parseRmsLevels(rmsErr);
  // time is in seconds: reset=16000 @ 16kHz = 1s windows
  const rms_curve: RmsPoint[] = levels.map((db, i) => ({ time: i, rms: normalizeRms(db) }));

  const silErr = await runFfmpegNull(
    videoPath,
    'silencedetect=noise=-40dB:d=0.5',
  );
  const silence_regions = parseSilenceRegions(silErr);

  return { rms_curve, silence_regions };
}
