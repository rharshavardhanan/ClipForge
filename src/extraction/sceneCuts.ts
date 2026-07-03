/**
 * Hard-cut detection for crop-track segmentation. Compilations/stream highlights switch
 * layout completely every few seconds — smoothing a face track ACROSS such a cut drags
 * the crop window through no-man's land (the "ceiling shot" bug). We detect cuts with
 * ffmpeg's scene-change score and smooth each segment independently.
 */
import { run } from '../utils/cmd.js';

const SCENE_THRESHOLD = 0.3;

/** PURE: pts_time values out of ffmpeg showinfo stderr lines. */
export function parseShowinfoTimes(stderr: string): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) out.push(parseFloat(m[1]));
  return out;
}

/** PURE: split time-ordered items into segments at the given cut times.
 *  An item at exactly a cut time starts the new segment. Empty segments are dropped. */
export function segmentByCuts<T extends { time: number }>(items: T[], cuts: number[]): T[][] {
  const sorted = [...cuts].sort((a, b) => a - b);
  const segments: T[][] = [];
  let current: T[] = [];
  let cutIdx = 0;
  for (const item of items) {
    while (cutIdx < sorted.length && item.time >= sorted[cutIdx]) {
      if (current.length > 0) segments.push(current);
      current = [];
      cutIdx++;
    }
    current.push(item);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Scene-cut timestamps (seconds) of a clip. Fail-soft: any error → [] (no segmentation). */
export async function detectSceneCuts(videoPath: string): Promise<number[]> {
  try {
    const res = await run('ffmpeg', [
      '-i', videoPath,
      '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-f', 'null', '-',
    ]);
    return parseShowinfoTimes(res.stderr ?? '');
  } catch {
    return [];
  }
}
