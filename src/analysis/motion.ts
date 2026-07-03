/**
 * Motion analysis layer (v7) — RankRot's ffmpeg signalstats YDIF curve promoted
 * to the main pipeline, cached like other analysis layers (layer_motion.json).
 * No LLM involved.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { motionCurve, type CurvePoint } from '../rankrot/signals.js';

export async function motionLayer(
  videoPath: string, outPath: string, curveFn: typeof motionCurve = motionCurve,
): Promise<CurvePoint[]> {
  try {
    const cached = JSON.parse(await readFile(outPath, 'utf8'));
    if (Array.isArray(cached)) return cached as CurvePoint[];
  } catch { /* cold or corrupt cache */ }
  const curve = await curveFn(videoPath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(curve));
  return curve;
}
