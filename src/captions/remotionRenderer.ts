import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { CaptionWord, ClipCompositionProps, CropKeyframe } from '../types/index.js';
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
  framing?: 'blur' | 'crop';
}

/** PURE: builds the Remotion composition props from render opts + a probed duration. */
export function buildProps(opts: RenderOpts, probedDurationSec: number, videoPathRel: string): ClipCompositionProps {
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
    zooms: opts.zooms ?? true,
  };
}

export async function render(opts: RenderOpts): Promise<void> {
  const p = await probe(opts.rawClipPath);
  const name = basename(opts.outPath, '.mp4') + '.mp4';
  const publicDir = join(REMOTION_DIR, 'public', 'input');
  await mkdir(publicDir, { recursive: true });
  const publicCopy = join(publicDir, name);

  const props: ClipCompositionProps = buildProps(opts, p.duration, join('input', name));
  const propsPath = join(REMOTION_DIR, `props_${name}.json`);

  try {
    await copyFile(opts.rawClipPath, publicCopy);
    await writeFile(propsPath, JSON.stringify(props));
    await withRetry(
      () =>
        run('npx', buildRenderArgs(propsPath, resolve(opts.outPath)), {
          cwd: REMOTION_DIR,
          onStdout: (l) => {
            if (l.includes('Rendered')) logger.info(l.trim());
          },
        }),
      { attempts: 2, label: 'remotion' },
    );
  } finally {
    await rm(publicCopy, { force: true });
    await rm(propsPath, { force: true });
  }
}
