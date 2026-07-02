#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { checkDependencies } from './preflight.js';
import { runAll, runBatch } from './commands/all.js';
import { runIngest } from './commands/ingest.js';
import { runRankingRender } from './commands/rank.js';
import { resolveCaptionStyle } from '../captions/presets.js';
import { logger } from '../utils/logger.js';

const STYLE_HELP = 'caption preset: mrbeast|hormozi|gadzhi|gaming|podcast|cinematic|minimal|card|bold';

/** Shared caption-style flags → resolved CaptionStyle. */
function captionFromFlags(o: { style: string; font?: string; fontSize?: number; captionColor?: string; stroke?: number; position?: string }) {
  return resolveCaptionStyle(o.style, {
    font: o.font, fontSize: o.fontSize, color: o.captionColor, strokeWidth: o.stroke, position: o.position,
  });
}

/** Resolve batch args: if a single `.txt` file is given, read one URL per line; else use the args verbatim. */
function resolveBatchUrls(args: string[]): string[] {
  if (args.length === 1 && args[0].toLowerCase().endsWith('.txt')) {
    return readFileSync(args[0], 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  return args;
}

async function preflightOrExit() {
  const { ok, missing } = await checkDependencies();
  if (!ok) {
    logger.error('Missing required tools:\n' + missing.map((m) => `  ${chalk.red('✗')} ${m.name} — install: ${chalk.cyan(m.hint)}`).join('\n'));
    process.exit(1);
  }
}

const program = new Command();
program.name('clipforge').description('Local-first viral short-form clip engine').version('0.1.0');

program.command('all').argument('<url>', 'YouTube URL')
  .option('--top <n>', 'max clips to export', (v) => parseInt(v, 10), 3)
  .option('--min-score <x>', 'absolute composite floor', (v) => parseFloat(v))
  .option('--style <s>', STYLE_HELP, 'bold')
  .option('--accent <hex>', 'accent color', '#FFD700')
  .option('--font <name>', 'caption font override: anton|bangers|archivo|montserrat|poppins|inter')
  .option('--font-size <px>', 'caption font size override', (v) => parseInt(v, 10))
  .option('--caption-color <hex>', 'caption base color override')
  .option('--stroke <px>', 'caption stroke width override', (v) => parseInt(v, 10))
  .option('--position <p>', 'caption position: bottom|center')
  .option('--no-music', 'disable background music')
  .option('--music-volume <v>', 'music bed level 0-1 before ducking', (v) => parseFloat(v), 0.25)
  .option('--music-dir <p>', 'music library folder', process.env.MUSIC_DIR ?? './music')
  .action(async (url, o) => {
    await preflightOrExit();
    try {
      await runAll(url, {
        top: o.top, minScore: o.minScore, style: o.style, accent: o.accent, caption: captionFromFlags(o),
        music: o.music, musicVolume: o.musicVolume, musicDir: o.musicDir,
      });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('ingest').argument('<url>', 'YouTube URL')
  .action(async (url) => {
    await preflightOrExit();
    try { await runIngest(url); }
    catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('batch')
  .description('Rank the best moments ACROSS multiple videos into one leaderboard')
  .argument('<urls...>', 'two or more YouTube URLs, or a single .txt file with one URL per line')
  .option('--top <n>', 'total clips to export across all videos', (v) => parseInt(v, 10), 5)
  .option('--min-score <x>', 'absolute composite floor', (v) => parseFloat(v))
  .option('--style <s>', STYLE_HELP, 'bold')
  .option('--accent <hex>', 'accent color', '#FFD700')
  .option('--font <name>', 'caption font override: anton|bangers|archivo|montserrat|poppins|inter')
  .option('--font-size <px>', 'caption font size override', (v) => parseInt(v, 10))
  .option('--caption-color <hex>', 'caption base color override')
  .option('--stroke <px>', 'caption stroke width override', (v) => parseInt(v, 10))
  .option('--position <p>', 'caption position: bottom|center')
  .option('--per-video-cap <n>', 'max clips from any single video (default: no cap)', (v) => parseInt(v, 10))
  .option('--ranking', 'also render a #N→#1 countdown ranking video from the exported clips')
  .option('--no-music', 'disable background music')
  .option('--music-volume <v>', 'music bed level 0-1 before ducking', (v) => parseFloat(v), 0.25)
  .option('--music-dir <p>', 'music library folder', process.env.MUSIC_DIR ?? './music')
  .action(async (urls, o) => {
    await preflightOrExit();
    const resolved = resolveBatchUrls(urls);
    if (resolved.length === 0) { logger.error('No URLs provided.'); process.exit(1); }
    try {
      const exportsDir = await runBatch(resolved, {
        top: o.top, minScore: o.minScore, style: o.style, accent: o.accent, perVideoCap: o.perVideoCap,
        caption: captionFromFlags(o),
        music: o.music, musicVolume: o.musicVolume, musicDir: o.musicDir,
      });
      if (o.ranking) await runRankingRender(exportsDir, { accent: o.accent, cardSec: 1.5 });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('rank')
  .description('Render a #N→#1 countdown ranking video from an existing exports directory')
  .argument('<exportsDir>', 'a workspace/exports/<id> directory containing clips_manifest.json')
  .option('--accent <hex>', 'accent color for rank cards/badges', '#FFD700')
  .option('--card-seconds <s>', 'countdown card duration in seconds', (v) => parseFloat(v), 1.5)
  .action(async (exportsDir, o) => {
    try { await runRankingRender(exportsDir, { accent: o.accent, cardSec: o.cardSeconds }); }
    catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.parseAsync();
