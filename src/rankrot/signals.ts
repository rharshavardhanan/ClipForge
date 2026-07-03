/**
 * RankRot local signal layers — motion (visual impact) and audio hype, pure ffmpeg
 * (house pivots: OpenCV → signalstats YDIF, Librosa → astats). Curves are {time, v}
 * samples used by the moment detector and the scoring layers.
 */
import { run } from '../utils/cmd.js';
import { parseRmsLevels, normalizeRms } from '../analysis/audioEnergy.js';

export interface CurvePoint { time: number; v: number; }

export const MOTION_FPS = 8;
export const AUDIO_WIN_SEC = 0.5;

/** PURE: parse `signalstats` YDIF values from ffmpeg -vf metadata=print stderr. */
export function parseYdif(stderr: string, fps = MOTION_FPS): CurvePoint[] {
  const out: CurvePoint[] = [];
  let i = 0;
  for (const m of stderr.matchAll(/lavfi\.signalstats\.YDIF=(-?\d+(?:\.\d+)?)/g)) {
    out.push({ time: i / fps, v: Number(m[1]) });
    i++;
  }
  return out;
}

/** Motion curve: inter-frame luma difference at MOTION_FPS on a 160px proxy — fast, local. */
export async function motionCurve(videoPath: string): Promise<CurvePoint[]> {
  const { stderr } = await run('ffmpeg', [
    '-i', videoPath,
    '-vf', `fps=${MOTION_FPS},scale=160:-2,signalstats,metadata=print`,
    '-an', '-f', 'null', '-',
  ]);
  return parseYdif(stderr);
}

/** Audio curve at 0.5s resolution (finer than the pipeline's 1s layer): loudness 0-10. */
export async function audioCurve(videoPath: string, bass = false): Promise<CurvePoint[]> {
  const pre = bass ? 'lowpass=f=150,' : '';
  const { stderr } = await run('ffmpeg', [
    '-i', videoPath,
    '-af', `${pre}aresample=16000,astats=metadata=1:reset=8000,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level`,
    '-vn', '-f', 'null', '-',
  ]);
  return parseRmsLevels(stderr).map((db, i) => ({ time: i * AUDIO_WIN_SEC, v: normalizeRms(db) }));
}

/** PURE: p-th percentile of a curve's values (0 when empty). */
export function percentile(points: CurvePoint[], p: number): number {
  if (points.length === 0) return 0;
  const sorted = points.map((x) => x.v).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** PURE: value of a curve at time t (nearest sample; 0 when empty). */
export function curveAt(points: CurvePoint[], t: number): number {
  if (points.length === 0) return 0;
  let best = points[0];
  for (const pt of points) if (Math.abs(pt.time - t) < Math.abs(best.time - t)) best = pt;
  return best.v;
}
