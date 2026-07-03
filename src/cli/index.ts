#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { checkDependencies } from './preflight.js';
import { runAll, runBatch } from './commands/all.js';
import { runIngest } from './commands/ingest.js';
import { runRankingRender } from './commands/rank.js';
import { runAuthYoutube, runUpload } from './commands/publish.js';
import { runStats } from './commands/stats.js';
import { runRankRot } from '../rankrot/pipeline.js';
import { runUi } from './commands/ui.js';
import { isLocalInput } from '../ingest/localFile.js';
import { logger } from '../utils/logger.js';

const STYLE_HELP = 'caption preset: mrbeast|hormozi|gadzhi|gaming|podcast|cinematic|minimal|card|bold (default: the mode\'s preset)';

/** Render-affecting flags shared by all/batch/process. */
function addRenderOptions(cmd: Command): Command {
  return cmd
    .option('--mode <m>', 'content mode: auto|clippies|mindcuts (auto = detect per video)', 'auto')
    .option('--framing <f>', 'framing: auto|crop|blur — crop = FULL-SCREEN 9:16 (follows the active speaker, no blur bars), blur = 16:9 over blurred backdrop', 'auto')
    .option('--style <s>', STYLE_HELP)
    .option('--accent <hex>', 'accent color', '#FFD700')
    .option('--font <name>', 'caption font override: anton|bangers|archivo|montserrat|poppins|inter')
    .option('--font-size <px>', 'caption font size override', (v) => parseInt(v, 10))
    .option('--caption-color <hex>', 'caption base color override')
    .option('--stroke <px>', 'caption stroke width override', (v) => parseInt(v, 10))
    .option('--position <p>', 'caption position: bottom|center')
    .option('--no-music', 'disable background music')
    .option('--music-volume <v>', 'music bed level 0-1 before ducking', (v) => parseFloat(v), 0.25)
    .option('--music-dir <p>', 'music library folder', process.env.MUSIC_DIR ?? './music')
    .option('--broll', 'force contextual B-roll (narrative overlay) on for every clip')
    .option('--no-broll', 'disable contextual B-roll (default: on for mindcuts only)')
    .option('--broll-dir <p>', 'B-roll cache folder', process.env.BROLL_DIR ?? './broll_cache')
    .option('--max-broll <n>', 'max B-roll overlays per clip (default: mode-dependent)', (v) => parseInt(v, 10))
    .option('--no-zooms', 'disable punch zooms on emphasized moments')
    .option('--no-sfx', 'disable sound-design SFX (whoosh on zooms, impact under hook)')
    .option('--sfx-volume <v>', 'SFX one-shot level 0-1', (v) => parseFloat(v), 0.6)
    .option('--sfx-dir <p>', 'SFX library folder', process.env.SFX_DIR ?? './sfx')
    .option('--delete-source', 'delete the downloaded source video + intermediates after export (frees disk)')
    .option('--allow-repeats', 'allow re-exporting moments already used by previous runs of the same video');
}

/** Common option object for runAll/runBatch from parsed flags. */
function renderOpts(o: any) {
  if (o.mode && !['auto', 'clippies', 'mindcuts'].includes(o.mode)) {
    logger.error(`--mode must be auto|clippies|mindcuts (got "${o.mode}")`);
    process.exit(1);
  }
  if (o.framing && !['auto', 'crop', 'blur'].includes(o.framing)) {
    logger.error(`--framing must be auto|crop|blur (got "${o.framing}")`);
    process.exit(1);
  }
  return {
    top: o.top, minScore: o.minScore, style: o.style, accent: o.accent, framing: o.framing,
    // Caption style resolves inside the pipeline (explicit --style wins, else the mode preset);
    // the fine-tuning flags ride along as overrides.
    captionOverrides: { font: o.font, fontSize: o.fontSize, color: o.captionColor, strokeWidth: o.stroke, position: o.position },
    mode: o.mode, broll: o.broll, brollDir: o.brollDir, maxBroll: o.maxBroll,
    music: o.music, musicVolume: o.musicVolume, musicDir: o.musicDir, zooms: o.zooms,
    sfx: o.sfx, sfxVolume: o.sfxVolume, sfxDir: o.sfxDir,
    deleteSource: o.deleteSource, allowRepeats: o.allowRepeats,
  };
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

addRenderOptions(
  program.command('all').argument('<input>', 'YouTube URL or local video file')
    .option('--top <n>', 'max clips to export', (v) => parseInt(v, 10), 3)
    .option('--min-score <x>', 'absolute composite floor', (v) => parseFloat(v))
    .option('--ranking', 'also render a #N→#1 countdown ranking video from the exported clips'),
)
  .action(async (input, o) => {
    await preflightOrExit();
    try {
      const exportsDir = await runAll(input, renderOpts(o));
      if (o.ranking) await runRankingRender(exportsDir, { accent: o.accent, cardSec: 1.5 });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

addRenderOptions(
  program.command('process')
    .description('Process a LOCAL video file (no download; transcript via whisper)')
    .argument('<file>', 'path to a local .mp4/.mkv/.mov/.webm/.m4v')
    .option('--top <n>', 'max clips to export', (v) => parseInt(v, 10), 3)
    .option('--min-score <x>', 'absolute composite floor', (v) => parseFloat(v))
    .option('--ranking', 'also render a #N→#1 countdown ranking video from the exported clips'),
)
  .action(async (file, o) => {
    if (!isLocalInput(file)) { logger.error(`Not an existing local video file: ${file}`); process.exit(1); }
    await preflightOrExit();
    try {
      const exportsDir = await runAll(file, renderOpts(o));
      if (o.ranking) await runRankingRender(exportsDir, { accent: o.accent, cardSec: 1.5 });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('ingest').argument('<url>', 'YouTube URL')
  .action(async (url) => {
    await preflightOrExit();
    try { await runIngest(url); }
    catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

addRenderOptions(
  program.command('batch')
    .description('Rank the best moments ACROSS multiple videos into one leaderboard')
    .argument('<inputs...>', 'two or more YouTube URLs / local files, or a single .txt file with one per line')
    .option('--top <n>', 'total clips to export across all videos', (v) => parseInt(v, 10), 5)
    .option('--min-score <x>', 'absolute composite floor', (v) => parseFloat(v))
    .option('--per-video-cap <n>', 'max clips from any single video (default: no cap)', (v) => parseInt(v, 10))
    .option('--ranking', 'also render a #N→#1 countdown ranking video from the exported clips'),
)
  .action(async (urls, o) => {
    await preflightOrExit();
    const resolved = resolveBatchUrls(urls);
    if (resolved.length === 0) { logger.error('No URLs provided.'); process.exit(1); }
    try {
      const exportsDir = await runBatch(resolved, { ...renderOpts(o), perVideoCap: o.perVideoCap });
      if (o.ranking) await runRankingRender(exportsDir, { accent: o.accent, cardSec: 1.5 });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('ui')
  .description('Launch the local GUI (Next.js) — import, preview, style, rank, export')
  .option('--port <n>', 'port', (v) => parseInt(v, 10), 3210)
  .action(async (o) => {
    try { await runUi(o.port); }
    catch (e) { logger.error((e as Error).message); process.exit(1); }
  });

program.command('auth')
  .description('Connect an account for direct publishing (one-time browser consent)')
  .argument('<service>', 'youtube')
  .action(async (service) => {
    try {
      if (service !== 'youtube') throw new Error(`Unknown service "${service}" — supported: youtube`);
      await runAuthYoutube();
    } catch (e) { logger.error((e as Error).message); process.exit(1); }
  });

program.command('upload')
  .description('Upload exported clips to YouTube (title/description/tags/thumbnail from the SEO pack)')
  .argument('<exportsDir>', 'a workspace/exports/<id> directory containing clips_manifest.json')
  .option('--clips <ids>', 'comma-separated clip ids (default: all)')
  .option('--channel <c>', 'YouTube channel title or id (required when multiple are connected)')
  .option('--privacy <p>', 'public|unlisted|private', 'public')
  .option('--title <t>', 'override title (single-clip use)')
  .option('--description <d>', 'override description (single-clip use)')
  .option('--dry-run', 'print what would be uploaded without uploading')
  .option('--force', 're-upload clips already marked uploaded')
  .option('--json', 'print machine-readable results as the last stdout line')
  .action(async (dir, o) => {
    try {
      if (!['public', 'unlisted', 'private'].includes(o.privacy)) throw new Error('--privacy must be public|unlisted|private');
      await runUpload(dir, {
        clips: o.clips, privacy: o.privacy, dryRun: o.dryRun, force: o.force, json: o.json,
        title: o.title, description: o.description, channel: o.channel,
      });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('stats')
  .description('Pull real YouTube metrics for uploaded clips — updates the editing policy and promotes ≥70% retention edits to ./elite_templates/')
  .argument('[exportsDirs...]', 'workspace/exports/<id> directories (default: all)')
  .option('--channel <c>', 'YouTube channel title or id (required when multiple are connected)')
  .option('--json', 'print machine-readable results as the last stdout line')
  .action(async (dirs, o) => {
    try { await runStats(dirs, { channel: o.channel, json: o.json }); }
    catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('rankrot')
  .description('Topic → internet clip harvest → AI ranking → brainrot Top-N countdown Short (Gemini + local signals, no Claude)')
  .argument('<topic>', 'e.g. "best basketball dunks", "craziest fails"')
  .option('--top <n>', 'countdown size', (v) => parseInt(v, 10), 5)
  .option('--harvest <n>', 'max clips to harvest (30-50 recommended)', (v) => parseInt(v, 10), 40)
  .option('--accent <hex>', 'accent color for rank cards/rail', '#FFE81A')
  .option('--no-sfx', 'disable SFX (whoosh/impact/riser/bass) under the countdown')
  .option('--sfx-volume <v>', 'SFX level 0-1', (v) => parseFloat(v), 0.6)
  .option('--sfx-dir <p>', 'SFX library folder', process.env.SFX_DIR ?? './sfx')
  .option('--cache-dir <p>', 'harvest cache folder', process.env.RANKROT_DIR ?? './rankrot_cache')
  .option('--no-replays', 'disable slow-mo replays on the strongest clips')
  .action(async (topic, o) => {
    await preflightOrExit();
    try {
      await runRankRot(topic, {
        top: Math.max(2, Math.min(10, o.top)), harvest: o.harvest, accent: o.accent,
        sfx: o.sfx, sfxVolume: o.sfxVolume, sfxDir: o.sfxDir,
        cacheDir: o.cacheDir, replays: o.replays,
      });
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
