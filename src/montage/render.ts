/**
 * Montage render bridge — converts a MontagePlan (wall-clock seconds) into Remotion
 * MontageVideo props (frames), stages the video/music/payoff assets into remotion/public,
 * and shells out to `npx remotion render` for the MontageVideo composition.
 *
 * STRUCTURAL MIRROR of src/rankrot/render.ts (stage -> write props json -> withRetry(run) ->
 * finally cleanup). Prop shape MUST mirror remotion/src/montageLogic.ts (MontageProps) — kept
 * in sync by convention, not by import: this file builds plain objects rather than importing
 * remotion/ types into src/.
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { CounterEvent, MontagePlan } from './types.js';

const REMOTION_DIR = resolve('remotion');

/**
 * PURE: MontagePlan (+ counter events/label/staged public-relative paths) -> MontageVideo
 * composition props. Converts every wall-clock second in the plan to frames at `fps`.
 */
export function buildMontageProps(
  plan: MontagePlan,
  counter: CounterEvent[],
  counterLabel: string,
  stagedRel: Map<string, string>,
  musicRel: string,
  payoffRel: string,
  fps: number,
  musicVolume: number,
): Record<string, unknown> {
  // Cumulative frame cursor: round each segment's own wall duration to frames, THEN
  // accumulate — so segment[i].from always equals the running sum of prior durationInFrames.
  let from = 0;
  const segments = plan.segments.map((s) => {
    const wallSec = s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
    const durationInFrames = Math.round(wallSec * fps);
    const segment = {
      videoPath: stagedRel.get(s.src) ?? s.src,
      from,
      durationInFrames,
      startFromFrames: Math.round(s.srcStart * fps),
      playbackRate: s.playbackRate,
      freeze: s.freeze,
      zoom: s.zoom,
      shake: s.shake,
    };
    from += durationInFrames;
    return segment;
  });

  return {
    segments,
    flashes: plan.flashes.map((f) => ({ at: Math.round(f.time * fps), frames: f.frames, kind: f.kind })),
    counter: counter.map((c) => ({ at: Math.round(c.time * fps), value: c.value })),
    counterLabel,
    musicPath: musicRel,
    musicVolume,
    musicStartFromFrames: Math.round(plan.musicOffset * fps),
    payoffImagePath: payoffRel,
    payoffAtFrame: Math.round(plan.payoffAt * fps),
    fps,
  };
}

export async function renderMontage(
  plan: MontagePlan,
  counter: CounterEvent[],
  counterLabel: string,
  musicPath: string,
  payoffImagePath: string,
  opts: { outPath: string; musicVolume?: number; fps?: number },
): Promise<void> {
  const fps = opts.fps ?? 30;
  const musicVolume = opts.musicVolume ?? 0.9;
  const publicDir = join(REMOTION_DIR, 'public', 'input');
  await mkdir(publicDir, { recursive: true });

  const srcs = [...new Set(plan.segments.map((s) => s.src))];
  const videoCopies = srcs.map((src, i) => join(publicDir, `montage_${i}_${basename(src)}`));
  const musicCopy = join(publicDir, `montage_music_${basename(musicPath)}`);
  const payoffCopy = payoffImagePath ? join(publicDir, `montage_payoff_${basename(payoffImagePath)}`) : null;

  const stagedRel = new Map(srcs.map((src, i) => [src, join('input', basename(videoCopies[i]))]));
  const musicRel = join('input', basename(musicCopy));
  const payoffRel = payoffCopy ? join('input', basename(payoffCopy)) : '';

  const props = buildMontageProps(plan, counter, counterLabel, stagedRel, musicRel, payoffRel, fps, musicVolume);
  const propsPath = join(REMOTION_DIR, `props_montage_${Date.now()}.json`);

  try {
    for (let i = 0; i < srcs.length; i++) await copyFile(srcs[i], videoCopies[i]);
    await copyFile(musicPath, musicCopy);
    if (payoffCopy) await copyFile(payoffImagePath, payoffCopy);
    await writeFile(propsPath, JSON.stringify(props));
    let lastLog = 0;
    await withRetry(
      () => run('npx', [
        'remotion', 'render', 'src/index.ts', 'MontageVideo',
        `--props=${propsPath}`, `--output=${resolve(opts.outPath)}`,
        '--codec=h264', '--crf=18', '--pixel-format=yuv420p',
      ], {
        cwd: REMOTION_DIR,
        stallMs: 180_000,
        onStdout: (l) => {
          if (l.includes('Rendered') && Date.now() - lastLog > 1000) { logger.info(l.trim()); lastLog = Date.now(); }
        },
      }),
      { attempts: 2, label: 'remotion-montage' },
    );
  } finally {
    for (const c of videoCopies) await rm(c, { force: true });
    await rm(musicCopy, { force: true });
    if (payoffCopy) await rm(payoffCopy, { force: true });
    await rm(propsPath, { force: true });
  }
}
