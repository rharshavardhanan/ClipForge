import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { BrollSegment, CaptionWord, ClipCompositionProps, CropKeyframe } from '../types/index.js';
import type { CaptionStyle } from './presets.js';
import { copyFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { probe } from '../utils/ffmpeg.js';

const REMOTION_DIR = resolve('remotion');

export function buildRenderArgs(propsPath: string, outPath: string): string[] {
  return [
    'remotion', 'render', 'src/index.ts', 'CaptionedClip',
    `--props=${propsPath}`,
    `--output=${outPath}`,
    '--codec=h264',
    '--crf=18',
    '--pixel-format=yuv420p',
  ];
}

export interface RenderOpts {
  rawClipPath: string;
  words: CaptionWord[];
  outPath: string;
  fps: number;
  accentColor?: string;
  style?: 'minimal' | 'card' | 'bold';
  cropTrack?: CropKeyframe[];
  srcW?: number;
  srcH?: number;
  hookText?: string;
  caption?: CaptionStyle;
  zooms?: boolean;
  /** Punch-zoom amplitude multiplier (v6 modes: clippies 1, mindcuts ~0.55). */
  zoomIntensity?: number;
  framing?: 'blur' | 'crop';
  /** Arrow callouts pointing at the speaker's face on peak moments (output px). */
  callouts?: { time: number; x: number; y: number }[];
  /** Narrative-overlay B-roll segments (v6) — files get staged into remotion/public. */
  broll?: BrollSegment[];
}

/** PURE: clip-relative B-roll segments → Remotion Sequence windows (staged rel paths + frames). */
export function buildBrollWindows(
  broll: BrollSegment[], fps: number, stagedRelPaths: string[],
): { videoPath: string; from: number; durationInFrames: number }[] {
  return broll.map((b, i) => ({
    videoPath: stagedRelPaths[i],
    from: Math.round(b.atSec * fps),
    durationInFrames: Math.max(1, Math.round(b.durationSec * fps)),
  }));
}

/** PURE: builds the Remotion composition props from render opts + a probed duration. */
export function buildProps(
  opts: RenderOpts, probedDurationSec: number, videoPathRel: string, brollRelPaths: string[] = [],
): ClipCompositionProps {
  return {
    videoPath: videoPathRel,
    words: opts.words,
    fps: opts.fps,
    durationInFrames: Math.max(1, Math.round(probedDurationSec * opts.fps)),
    style: opts.style ?? 'bold',
    accentColor: opts.accentColor ?? '#FFD700',
    showHookCard: Boolean(opts.hookText && opts.hookText.trim()),
    hookText: opts.hookText ?? '',
    ...(opts.cropTrack && opts.cropTrack.length > 0 ? { cropTrack: opts.cropTrack } : {}),
    ...(opts.srcW !== undefined ? { srcW: opts.srcW } : {}),
    ...(opts.srcH !== undefined ? { srcH: opts.srcH } : {}),
    ...(opts.caption ? { caption: opts.caption } : {}),
    ...(opts.framing ? { framing: opts.framing } : {}),
    ...(opts.callouts && opts.callouts.length > 0 ? { callouts: opts.callouts } : {}),
    ...(opts.broll && opts.broll.length > 0
      ? { broll: buildBrollWindows(opts.broll, opts.fps, brollRelPaths) } : {}),
    zooms: opts.zooms ?? true,
    ...(opts.zoomIntensity !== undefined ? { zoomIntensity: opts.zoomIntensity } : {}),
  };
}

export async function render(opts: RenderOpts): Promise<void> {
  const p = await probe(opts.rawClipPath);
  const name = basename(opts.outPath, '.mp4') + '.mp4';
  const publicDir = join(REMOTION_DIR, 'public', 'input');
  await mkdir(publicDir, { recursive: true });
  const publicCopy = join(publicDir, name);

  // Stage B-roll overlay assets next to the main input (unique per-clip names).
  const broll = opts.broll ?? [];
  const brollCopies = broll.map((b, i) => join(publicDir, `broll_${basename(name, '.mp4')}_${i}.mp4`));
  const brollRel = brollCopies.map((c) => join('input', basename(c)));

  const props: ClipCompositionProps = buildProps(opts, p.duration, join('input', name), brollRel);
  const propsPath = join(REMOTION_DIR, `props_${name}.json`);

  try {
    await copyFile(opts.rawClipPath, publicCopy);
    for (let i = 0; i < broll.length; i++) await copyFile(broll[i].file, brollCopies[i]);
    await writeFile(propsPath, JSON.stringify(props));
    // Remotion prints one "Rendered N/total" line per frame (hundreds per clip). Throttle to
    // ~1/sec so the log stays readable and doesn't look frozen on a slow-moving counter.
    let lastLog = 0;
    await withRetry(
      () =>
        run('npx', buildRenderArgs(propsPath, resolve(opts.outPath)), {
          cwd: REMOTION_DIR,
          // No render output for 3 min ⇒ a frame is hung; kill so the pipeline can skip this clip.
          stallMs: 180_000,
          onStdout: (l) => {
            if (l.includes('Rendered') && Date.now() - lastLog > 1000) { logger.info(l.trim()); lastLog = Date.now(); }
          },
        }),
      { attempts: 2, label: 'remotion' },
    );
  } finally {
    await rm(publicCopy, { force: true });
    for (const c of brollCopies) await rm(c, { force: true });
    await rm(propsPath, { force: true });
  }
}
