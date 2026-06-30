import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';

export function parseVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function buildYtdlpArgs(url: string, outDir: string): string[] {
  return [
    url,
    '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    '--merge-output-format', 'mp4',
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en,en-US,en-GB,en-orig', '--sub-format', 'json3',
    '--write-info-json', '--no-playlist',
    '--retries', '5', '--fragment-retries', '5',
    '--newline', '-o', join(outDir, 'video.%(ext)s'),
  ];
}

export async function download(url: string, outDir: string) {
  await mkdir(outDir, { recursive: true });
  const videoPath = join(outDir, 'video.mp4');
  const infoJsonPath = join(outDir, 'video.info.json');
  if (existsSync(videoPath) && existsSync(infoJsonPath)) {
    logger.info('Reusing cached download');
  } else {
    await withRetry(() => run('yt-dlp', buildYtdlpArgs(url, outDir), {
      onStdout: (l) => { if (l.includes('%')) process.stderr.write(`\r${l.trim()}`); },
    }), { attempts: 3, label: 'yt-dlp' });
  }
  // json3 subs land as video.en.json3 / video.en-US.json3 — pick the first.
  const files = await readdir(outDir);
  const sub = files.find((f) => f.endsWith('.json3')) ?? null;
  return { videoPath, infoJsonPath, subtitlePath: sub ? join(outDir, sub) : null };
}
