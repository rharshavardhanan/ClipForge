import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { probe } from '../utils/ffmpeg.js';
import type { RankingProps } from '../types/index.js';
import { copyFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REMOTION_DIR = resolve('remotion');

export interface RankingEntry {
  clipPath: string; // absolute path to an already-rendered 9:16 final clip
  rank: number;
  title?: string;
}

export function buildRankingRenderArgs(propsPath: string, outPath: string): string[] {
  return [
    'remotion', 'render', 'src/index.ts', 'RankingVideo',
    `--props=${propsPath}`,
    `--output=${outPath}`,
    '--codec=h264',
    '--crf=18',
    '--pixel-format=yuv420p',
  ];
}

/**
 * PURE: build RankingVideo props from entries + their probed durations (seconds, aligned with
 * the entries array). Plays the highest rank number first (#N → … → #1).
 */
export function buildRankingProps(
  entries: RankingEntry[], durationsSec: number[], fps: number, cardSec: number, accent: string,
): RankingProps {
  const items = entries
    .map((e, i) => ({
      videoPath: join('input', `rank_${e.rank}.mp4`),
      rank: e.rank,
      durationInFrames: Math.max(1, Math.round(durationsSec[i] * fps)),
      ...(e.title ? { title: e.title } : {}),
    }))
    .sort((a, b) => b.rank - a.rank);
  return { items, fps, cardFrames: Math.max(1, Math.round(cardSec * fps)), accentColor: accent };
}

export async function renderRanking(
  entries: RankingEntry[],
  outPath: string,
  opts: { fps?: number; cardSec?: number; accent?: string } = {},
): Promise<void> {
  if (entries.length === 0) throw new Error('renderRanking: no clips to rank');
  const fps = opts.fps ?? 30;

  const durations: number[] = [];
  for (const e of entries) durations.push((await probe(e.clipPath)).duration);
  const props = buildRankingProps(entries, durations, fps, opts.cardSec ?? 1.5, opts.accent ?? '#FFD700');

  const publicDir = join(REMOTION_DIR, 'public', 'input');
  await mkdir(publicDir, { recursive: true });
  const copies = entries.map((e) => join(publicDir, `rank_${e.rank}.mp4`));
  const propsPath = join(REMOTION_DIR, 'props_ranking.json');

  try {
    await Promise.all(entries.map((e, i) => copyFile(e.clipPath, copies[i])));
    await writeFile(propsPath, JSON.stringify(props));
    await withRetry(
      () =>
        run('npx', buildRankingRenderArgs(propsPath, resolve(outPath)), {
          cwd: REMOTION_DIR,
          onStdout: (l) => {
            if (l.includes('Rendered')) logger.info(l.trim());
          },
        }),
      { attempts: 2, label: 'remotion-ranking' },
    );
  } finally {
    await Promise.all([...copies.map((c) => rm(c, { force: true })), rm(propsPath, { force: true })]);
  }
}
