import { run } from '../../src/utils/cmd.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function makeTestAsset(outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  // video: testsrc 6s; audio: tone, then 1.2s silence, then tone (via volume envelope)
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=6:size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-af', "volume='if(between(t,2,3.2),0,1)':eval=frame",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    outPath,
  ]);
}
