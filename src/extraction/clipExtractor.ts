import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { buildAudioFilter } from './audioProcessor.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { KeepSegment } from '../editor/timeMap.js';

export function buildVideoFilter(width: number, height: number): string {
  const isVertical = width / height <= 9 / 16 + 0.01;
  if (isVertical) {
    // already portrait — fill to 1080x1920 via crop (no letterbox)
    return 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1';
  }
  return 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1';
}

export function buildExtractArgs(video: string, start: number, dur: number, vf: string, af: string, outPath: string): string[] {
  return [
    '-y', '-ss', String(start), '-i', video, '-t', String(dur),
    '-vf', vf, '-af', af,
    '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr', '-c:a', 'aac', '-b:a', '192k', outPath,
  ];
}

export function buildFullFrameExtractArgs(video: string, start: number, dur: number, af: string, outPath: string): string[] {
  return [
    '-y', '-ss', String(start), '-i', video, '-t', String(dur),
    '-af', af,
    '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr', '-c:a', 'aac', '-b:a', '192k', outPath,
  ];
}

export async function extractRaw(
  video: string, start: number, end: number, dims: { width: number; height: number }, outPath: string,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const vf = buildVideoFilter(dims.width, dims.height);
  const args = buildExtractArgs(video, start, end - start, vf, buildAudioFilter(), outPath);
  await withRetry(() => run('ffmpeg', args), { attempts: 3, label: 'ffmpeg-extract' });
}

/**
 * Extracts [start,end] with NO crop filter — keeps the source's full 16:9 frame
 * at source resolution. Used as the input to face-tracked reframing in Remotion.
 */
export async function extractFullFrame(
  video: string, start: number, end: number, outPath: string,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const args = buildFullFrameExtractArgs(video, start, end - start, buildAudioFilter(), outPath);
  await withRetry(() => run('ffmpeg', args), { attempts: 3, label: 'ffmpeg-extract-fullframe' });
}

/**
 * PURE: full-frame extract that CONCATENATES only the kept segments (clip-relative source
 * times) in a single ffmpeg pass — the editor's internal cuts (v4 Slice C). `-ss clipStart`
 * makes select's `t` clip-relative; `-t clipDur` bounds the decode to the clip window (never
 * reads to EOF of a long source). No crop filter — the full source frame is preserved for
 * the reframing stage, exactly like buildFullFrameExtractArgs.
 */
export function buildSegmentedExtractArgs(
  video: string, clipStart: number, keep: KeepSegment[], af: string, outPath: string,
): string[] {
  const clipDur = keep.length ? Math.max(...keep.map((k) => k.end)) : 0;
  const sel = keep.map((k) => `between(t,${k.start},${k.end})`).join('+');
  return [
    '-y', '-ss', String(clipStart), '-i', video, '-t', String(clipDur),
    '-vf', `select='${sel}',setpts=N/FRAME_RATE/TB`,
    '-af', `aselect='${sel}',asetpts=N/SR/TB,${af}`,
    '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr', '-c:a', 'aac', '-b:a', '192k', outPath,
  ];
}

/** Extract the clip keeping only `keep` (clip-relative). A single full [0,clipDur] span
 *  delegates to the plain full-frame path (no filter overhead). */
export async function extractTightened(
  video: string, clipStart: number, clipDur: number, keep: KeepSegment[], outPath: string,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const identity = keep.length === 1 && keep[0].start === 0;
  const args = identity
    ? buildFullFrameExtractArgs(video, clipStart, clipDur, buildAudioFilter(), outPath)
    : buildSegmentedExtractArgs(video, clipStart, keep, buildAudioFilter(), outPath);
  await withRetry(() => run('ffmpeg', args), { attempts: 3, label: 'ffmpeg-extract-tightened' });
}
