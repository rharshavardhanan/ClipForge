/**
 * Post-render music mix: loop/trim a music bed to the clip, fade it in/out, duck it under
 * speech with sidechain compression keyed by the clip's voice track, and mix. Video is
 * stream-copied so the Remotion encode is untouched.
 */
import { run } from '../utils/cmd.js';
import { probe } from '../utils/ffmpeg.js';

export interface MixOpts {
  durationSec: number;
  musicVolume: number; // 0-1 music bed level before ducking
  fadeSec: number;
}

/** PURE: ffmpeg args for the duck-under-speech music mix. */
export function buildMusicMixArgs(videoPath: string, musicPath: string, outPath: string, opts: MixOpts): string[] {
  const d = opts.durationSec;
  const f = opts.fadeSec;
  const fadeOutStart = Math.max(0, d - f);
  const filter = [
    `[1:a]aloop=loop=-1:size=2147483647,atrim=0:${d},afade=t=in:st=0:d=${f},afade=t=out:st=${fadeOutStart}:d=${f},volume=${opts.musicVolume}[mus]`,
    `[0:a]asplit=2[voice][sc]`,
    `[mus][sc]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=400[duck]`,
    `[voice][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
  ].join(';');
  return [
    '-i', videoPath,
    '-i', musicPath,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-y', outPath,
  ];
}

/** Mix `musicPath` under `videoPath`'s speech into `outPath`. */
export async function mixMusic(
  videoPath: string, musicPath: string, outPath: string,
  opts: { musicVolume?: number; fadeSec?: number } = {},
): Promise<void> {
  const { duration } = await probe(videoPath);
  await run('ffmpeg', buildMusicMixArgs(videoPath, musicPath, outPath, {
    durationSec: duration,
    musicVolume: opts.musicVolume ?? 0.25,
    fadeSec: opts.fadeSec ?? 1.5,
  }));
}
