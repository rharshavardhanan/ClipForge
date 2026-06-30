#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { checkDependencies } from './preflight.js';
import { runAll, runBatch } from './commands/all.js';
import { runIngest } from './commands/ingest.js';
import { logger } from '../utils/logger.js';

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
  .option('--style <s>', 'caption style', 'bold')
  .option('--accent <hex>', 'accent color', '#FFD700')
  .action(async (url, o) => {
    await preflightOrExit();
    try { await runAll(url, { top: o.top, minScore: o.minScore, style: o.style, accent: o.accent }); }
    catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
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
  .option('--style <s>', 'caption style', 'bold')
  .option('--accent <hex>', 'accent color', '#FFD700')
  .option('--per-video-cap <n>', 'max clips from any single video (default: no cap)', (v) => parseInt(v, 10))
  .action(async (urls, o) => {
    await preflightOrExit();
    const resolved = resolveBatchUrls(urls);
    if (resolved.length === 0) { logger.error('No URLs provided.'); process.exit(1); }
    try {
      await runBatch(resolved, { top: o.top, minScore: o.minScore, style: o.style, accent: o.accent, perVideoCap: o.perVideoCap });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.parseAsync();
