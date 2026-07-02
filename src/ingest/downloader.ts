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
    '-f', 'bestvideo[height<=1440][vcodec!*=av01]+bestaudio/bestvideo[height<=1440]+bestaudio/best[height<=1440]/best',
    '--merge-output-format', 'mp4',
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en,en-US,en-GB,en-orig', '--sub-format', 'json3',
    '--write-info-json', '--no-playlist',
    // Top comments feed the viewer-flagged-moment signal (commentSignals). Cap at 100
    // top-sorted top-level comments (no replies) to keep the fetch fast.
    '--write-comments', '--extractor-args', 'youtube:comment_sort=top;max_comments=100,all,0',
    // Parallel fragment downloads — YouTube throttles single connections hard, so pulling
    // several DASH fragments at once is typically 3-5x faster on large/long videos.
    '--concurrent-fragments', '5',
    '--retries', '10', '--fragment-retries', '10',
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
