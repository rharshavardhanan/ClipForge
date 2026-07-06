/**
 * Loudness normalization (v4 Part 3 §8): two-pass ffmpeg `loudnorm` to a platform target
 * (-14 LUFS, true-peak ≤ -1 dBTP). Pass 1 measures (print_format=json), pass 2 applies with
 * measured values seeded + linear=true so it's a single linear gain (no dynamics mangling).
 * Fail-soft: normalizeLoudness returns null on any failure and the caller ships the original.
 */
import { run } from '../utils/cmd.js';

export interface LoudnessMeasurement {
  input_i: number; input_tp: number; input_lra: number; input_thresh: number; target_offset: number;
}

export const TARGET_LUFS = -14;
export const TRUE_PEAK_CEILING = -1.0;
const LRA = 11;

/** PURE: measurement-pass args (JSON print, null output). */
export function buildLoudnessMeasureArgs(input: string): string[] {
  return [
    '-hide_banner', '-i', input,
    '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK_CEILING}:LRA=${LRA}:print_format=json`,
    '-f', 'null', '-',
  ];
}

/** PURE: pull the last JSON object out of loudnorm's stderr; null if absent/unparseable. */
export function parseLoudnessJson(stderr: string): LoudnessMeasurement | null {
  const open = stderr.lastIndexOf('{');
  const close = stderr.lastIndexOf('}');
  if (open < 0 || close < open) return null;
  try {
    const j = JSON.parse(stderr.slice(open, close + 1));
    const num = (v: unknown) => Number(v);
    const m: LoudnessMeasurement = {
      input_i: num(j.input_i), input_tp: num(j.input_tp), input_lra: num(j.input_lra),
      input_thresh: num(j.input_thresh), target_offset: num(j.target_offset),
    };
    if (Object.values(m).some((n) => !Number.isFinite(n))) return null;
    return m;
  } catch { return null; }
}

/** PURE: apply-pass args seeded with the measurement (linear gain, re-encode audio only). */
export function buildLoudnessApplyArgs(
  input: string, output: string, m: LoudnessMeasurement, targetLufs: number = TARGET_LUFS,
): string[] {
  const filter = `loudnorm=I=${targetLufs}:TP=${TRUE_PEAK_CEILING}:LRA=${LRA}`
    + `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`
    + `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
  return ['-y', '-i', input, '-af', filter, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', output];
}

/** Two-pass normalize; returns the measurement or null (caller keeps the original file). */
export async function normalizeLoudness(
  input: string, output: string, targetLufs: number = TARGET_LUFS,
): Promise<LoudnessMeasurement | null> {
  try {
    const { stderr } = await run('ffmpeg', buildLoudnessMeasureArgs(input));
    const m = parseLoudnessJson(stderr);
    if (!m) return null;
    await run('ffmpeg', buildLoudnessApplyArgs(input, output, m, targetLufs));
    return m;
  } catch {
    return null;
  }
}
