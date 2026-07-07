import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { run as defaultRun } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import { ReasonCode } from '../report/reasonCodes.js';
import type { PerceptionClient } from './perceptionClient.js';
import { validateTimeline, type SemanticTimeline } from './timeline.js';

const DEFAULT_CLI = 'perception/.venv/bin/clipforge-perception';
// mock first: real layers overwrite its placeholder layers on the Python side, and mock
// remains the fallback when a real producer fails.
const DEFAULT_MODELS = ['mock', 'pyannote', 'yamnet', 'clip'];

export interface SubprocessClientOpts {
  workspaceDir?: string;
  models?: string[];
  sampleFps?: number;
  cliPath?: string;
  /** Kill a hung pass after this long with no output (throttling-Mac guard). */
  stallMs?: number;
  run?: typeof defaultRun;
  onReason?: (code: ReasonCode) => void;
}

export class SubprocessPerceptionClient implements PerceptionClient {
  private readonly ws: string;
  private readonly models: string[];
  private readonly sampleFps: number;
  private readonly cliPath: string;
  private readonly stallMs: number;
  private readonly run: typeof defaultRun;
  private readonly onReason?: (code: ReasonCode) => void;

  constructor(opts: SubprocessClientOpts = {}) {
    this.ws = opts.workspaceDir ?? process.env.WORKSPACE_DIR ?? './workspace';
    this.models = opts.models ?? DEFAULT_MODELS;
    this.sampleFps = opts.sampleFps ?? 2;
    this.cliPath = opts.cliPath ?? DEFAULT_CLI;
    this.stallMs = opts.stallMs ?? 5 * 60 * 1000;
    this.run = opts.run ?? defaultRun;
    this.onReason = opts.onReason;
  }

  async analyze(videoPath: string, jobId: string): Promise<SemanticTimeline | null> {
    const outPath = join(this.ws, 'perception', jobId, 'semantic_timeline.json');

    const cached = this.readValid(outPath);
    const missing = cached
      ? this.models.filter((m) => !cached.producers_run.includes(m))
      : this.models;
    if (cached && missing.length === 0) {
      logger.info(`[${jobId}] perception cache hit (${cached.producers_run.join(',') || 'none'})`);
      return cached;
    }
    if (cached) {
      logger.info(`[${jobId}] perception cache partial (${cached.producers_run.join(',')}) — running ${missing.join(',')}`);
    }

    // Auto-off: no venv/CLI on disk → degrade silently, no spawn attempt.
    // Debug-level (not warn): perception defaults on but the venv is absent until a user opts in
    // via ./start.sh perception-setup, so this branch fires on every legacy run — it must stay
    // silent by default (LOG_LEVEL=info) while still recording the reason code for the run report.
    if (!existsSync(this.cliPath)) {
      return this.fail(jobId, ReasonCode.PERCEPTION_UNAVAILABLE,
        `perception CLI not found at ${this.cliPath} — run ./start.sh perception-setup`, 'debug');
    }

    try {
      await mkdir(dirname(outPath), { recursive: true });
      await this.run(resolve(this.cliPath), [
        'analyze', videoPath,
        '--out', outPath,
        '--models', missing.join(','),
        '--sample-fps', String(this.sampleFps),
        '--job-id', jobId,
      ], { stallMs: this.stallMs, onStderr: (l) => logger.warn(`[perception] ${l}`) });
    } catch (e) {
      return this.fail(jobId, ReasonCode.PERCEPTION_UNAVAILABLE,
        `perception run failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const produced = this.readValid(outPath);
    if (!produced) {
      return this.fail(jobId, ReasonCode.PERCEPTION_UNAVAILABLE,
        'perception produced no valid timeline');
    }
    logger.info(`[${jobId}] perception: ${produced.speakers.length} spk, ` +
      `${produced.audio_events.length} audio-events, ${produced.scenes.length} scenes ` +
      `(${produced.producers_run.join(',') || 'none'})`);
    return produced;
  }

  private readValid(path: string): SemanticTimeline | null {
    if (!existsSync(path)) return null;
    try {
      const res = validateTimeline(JSON.parse(readFileSync(path, 'utf8')));
      return res.ok ? res.timeline : null;
    } catch {
      return null;
    }
  }

  private fail(jobId: string, code: ReasonCode, msg: string, level: 'warn' | 'debug' = 'warn'): null {
    logger[level](`[${jobId}] ${code}: ${msg}`);
    this.onReason?.(code);
    return null;
  }
}
