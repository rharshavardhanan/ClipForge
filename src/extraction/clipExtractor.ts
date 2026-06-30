import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { buildAudioFilter } from './audioProcessor.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function buildVideoFilter(width: number, height: number): string {
  const isVertical = width / height <= 9 / 16 + 0.01;
  if (isVertical) {
    // already portrait — fit into 1080x1920, pad if needed
    return 'scale=1080:1920:force_original_aspect_ratio=increase,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1';
  }
  return 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1';
}

export function buildExtractArgs(video: string, start: number, dur: number, vf: string, af: string, outPath: string): string[] {
  return [
    '-y', '-ss', String(start), '-i', video, '-t', String(dur),
    '-vf', vf, '-af', af,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', outPath,
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
