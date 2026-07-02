/**
 * Post-render SFX mix: delay each one-shot to its event time and mix under the clip audio.
 * Video is stream-copied so the Remotion encode is untouched.
 */
import { run } from '../utils/cmd.js';
import type { SfxEvent } from './events.js';

/** PURE: ffmpeg args — one adelay+volume chain per event, amix'd with the clip audio. */
export function buildSfxMixArgs(
  videoPath: string, events: SfxEvent[], outPath: string, opts: { sfxVolume: number },
): string[] {
  const inputs = events.flatMap((e) => ['-i', e.path]);
  const chains = events.map((e, i) => {
    const ms = Math.round(e.time * 1000);
    return `[${i + 1}:a]adelay=${ms}|${ms},volume=${opts.sfxVolume}[s${i}]`;
  });
  const mixIn = `[0:a]${events.map((_, i) => `[s${i}]`).join('')}`;
  const filter = [
    ...chains,
    `${mixIn}amix=inputs=${events.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`,
  ].join(';');
  return [
    '-i', videoPath, ...inputs,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-y', outPath,
  ];
}

/** Mix the planned one-shots into `videoPath` → `outPath`. No events → no-op. */
export async function mixSfx(
  videoPath: string, events: SfxEvent[], outPath: string, opts: { sfxVolume?: number } = {},
): Promise<void> {
  if (!events.length) return;
  await run('ffmpeg', buildSfxMixArgs(videoPath, events, outPath, { sfxVolume: opts.sfxVolume ?? 0.6 }));
}
