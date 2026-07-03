/**
 * RankRot render — stages the 5 moment files into remotion/public, renders the
 * RankRotVideo composition, and lays SFX under the countdown.
 *
 * TIMING MIRROR: the constants and segment math here MUST mirror
 * remotion/src/rankrotLogic.ts buildRankRotTimeline (a vitest cross-checks them).
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { pickSfx, type SfxKind } from '../sfx/library.js';
import type { SfxEvent } from '../sfx/events.js';

const REMOTION_DIR = resolve('remotion');

// —— mirror of remotion/src/rankrotLogic.ts (keep in sync; tested) ——
export const CARD_FRAMES = 21;
export const FINAL_CARD_FRAMES = 33;
export const REPLAY_SPEED = 0.5;
export const REPLAY_FRACTION = 0.6;

export interface RankRotRenderItem {
  file: string;          // absolute path of the trimmed moment
  rank: number;          // 5..1
  durationSec: number;   // moment duration
  microTitle: string;
  replay: boolean;
}

export type RankRotSfxPlan = { whooshes: number[]; impacts: number[]; riser: number | null; bass: number | null };

/** PURE (mirror): card/clip/replay start times in seconds at the comp fps. */
export function buildRankRotSfxPlan(items: RankRotRenderItem[], fps: number): RankRotSfxPlan {
  const plan: RankRotSfxPlan = { whooshes: [], impacts: [], riser: null, bass: null };
  let from = 0;
  items.forEach((item, i) => {
    const final = i === items.length - 1;
    const card = final ? FINAL_CARD_FRAMES : CARD_FRAMES;
    const cardT = +(from / fps).toFixed(3);
    plan.whooshes.push(cardT);
    if (final) plan.riser = cardT;
    from += card;
    const clipT = +(from / fps).toFixed(3);
    plan.impacts.push(clipT);
    if (final) plan.bass = clipT;
    const clipFrames = Math.max(1, Math.round(item.durationSec * fps));
    from += clipFrames;
    if (item.replay) from += Math.max(1, Math.round((clipFrames * REPLAY_FRACTION) / REPLAY_SPEED));
  });
  return plan;
}

/** PURE: SFX plan → concrete events from whatever one-shots the ./sfx library has. */
export function planRankRotSfx(
  plan: RankRotSfxPlan, lib: Partial<Record<SfxKind, string[]>>, seed: string,
): SfxEvent[] {
  const events: SfxEvent[] = [];
  const add = (time: number | null, kind: SfxKind, salt: string) => {
    if (time === null) return;
    const path = pickSfx(lib, kind, `${seed}_${salt}`);
    if (path) events.push({ time, path });
  };
  plan.whooshes.forEach((t, i) => add(t, 'whoosh', `w${i}`));
  plan.impacts.forEach((t, i) => add(t, 'impact', `i${i}`));
  add(plan.riser, 'riser', 'riser');
  add(plan.bass, 'bass', 'bass');
  return events.sort((a, b) => a.time - b.time);
}

/** PURE: composition props from items + staged public-relative paths. */
export function buildRankRotProps(
  items: RankRotRenderItem[], stagedRel: string[], fps: number,
  topTitle: string, subtext: string, accentColor: string,
) {
  return {
    items: items.map((it, i) => ({
      videoPath: stagedRel[i],
      rank: it.rank,
      durationInFrames: Math.max(1, Math.round(it.durationSec * fps)),
      microTitle: it.microTitle,
      replay: it.replay,
    })),
    fps, topTitle, subtext, accentColor,
  };
}

export async function renderRankRot(
  items: RankRotRenderItem[],
  opts: { outPath: string; topTitle: string; subtext: string; accent: string; fps?: number },
): Promise<void> {
  const fps = opts.fps ?? 30;
  const publicDir = join(REMOTION_DIR, 'public', 'input');
  await mkdir(publicDir, { recursive: true });
  const copies = items.map((it, i) => join(publicDir, `rankrot_${i}_${basename(it.file)}`));
  const rel = copies.map((c) => join('input', basename(c)));
  const props = buildRankRotProps(items, rel, fps, opts.topTitle, opts.subtext, opts.accent);
  const propsPath = join(REMOTION_DIR, `props_rankrot_${Date.now()}.json`);

  try {
    for (let i = 0; i < items.length; i++) await copyFile(items[i].file, copies[i]);
    await writeFile(propsPath, JSON.stringify(props));
    let lastLog = 0;
    await withRetry(
      () => run('npx', [
        'remotion', 'render', 'src/index.ts', 'RankRotVideo',
        `--props=${propsPath}`, `--output=${resolve(opts.outPath)}`,
        '--codec=h264', '--crf=18', '--pixel-format=yuv420p',
      ], {
        cwd: REMOTION_DIR,
        stallMs: 180_000,
        onStdout: (l) => {
          if (l.includes('Rendered') && Date.now() - lastLog > 1000) { logger.info(l.trim()); lastLog = Date.now(); }
        },
      }),
      { attempts: 2, label: 'remotion-rankrot' },
    );
  } finally {
    for (const c of copies) await rm(c, { force: true });
    await rm(propsPath, { force: true });
  }
}
