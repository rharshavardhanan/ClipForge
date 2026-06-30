#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { checkDependencies } from './preflight.js';
import { runAll } from './commands/all.js';
import { runIngest } from './commands/ingest.js';
import { logger } from '../utils/logger.js';

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

program.parseAsync();
