import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubprocessPerceptionClient } from '../../src/perception/subprocessClient.js';
import { ReasonCode } from '../../src/report/reasonCodes.js';

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, '../../perception/fixtures/golden_timeline.json'), 'utf8'),
);

function ws(): string {
  return mkdtempSync(join(tmpdir(), 'cf-perc-'));
}
function writeCache(dir: string, jobId: string, timeline: unknown): string {
  const d = join(dir, 'perception', jobId);
  mkdirSync(d, { recursive: true });
  const p = join(d, 'semantic_timeline.json');
  writeFileSync(p, JSON.stringify(timeline));
  return p;
}

describe('SubprocessPerceptionClient', () => {
  let reasons: ReasonCode[];
  beforeEach(() => { reasons = []; });
  const onReason = (c: ReasonCode) => reasons.push(c);

  it('returns cached timeline without spawning when producers_run covers requested models', async () => {
    const dir = ws();
    writeCache(dir, 'job1', { ...GOLDEN, producers_run: ['mock'] });
    const run = vi.fn();
    const client = new SubprocessPerceptionClient({ workspaceDir: dir, models: ['mock'], run, onReason });
    const t = await client.analyze('/x/video.mp4', 'job1');
    expect(t?.job_id).toBe('golden-fixture');
    expect(run).not.toHaveBeenCalled();
  });

  it('re-runs when cache producers_run does not cover requested models', async () => {
    const dir = ws();
    writeCache(dir, 'job2', { ...GOLDEN, producers_run: ['mock'] });
    const run = vi.fn(async (_cmd, args: string[]) => {
      const out = args[args.indexOf('--out') + 1];
      writeFileSync(out, JSON.stringify({ ...GOLDEN, producers_run: ['mock', 'pyannote'] }));
      return { stdout: '', stderr: '' };
    });
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock', 'pyannote'], run, cliPath: __filename, onReason,
    });
    const t = await client.analyze('/x/video.mp4', 'job2');
    expect(run).toHaveBeenCalledOnce();
    expect(t?.producers_run).toContain('pyannote');
  });

  it('spawns on cache miss and returns the written timeline', async () => {
    const dir = ws();
    const run = vi.fn(async (_cmd, args: string[]) => {
      const out = args[args.indexOf('--out') + 1];
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, JSON.stringify(GOLDEN));
      return { stdout: '', stderr: '' };
    });
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock'], run, cliPath: __filename, onReason,
    });
    const t = await client.analyze('/x/video.mp4', 'job3');
    expect(run).toHaveBeenCalledOnce();
    expect(t?.speakers.length).toBe(2);
  });

  it('fails soft to null + PERCEPTION_UNAVAILABLE when the CLI binary is absent', async () => {
    const dir = ws();
    const run = vi.fn();
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock'], run, cliPath: '/no/such/clipforge-perception', onReason,
    });
    const t = await client.analyze('/x/video.mp4', 'job4');
    expect(t).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(reasons).toContain(ReasonCode.PERCEPTION_UNAVAILABLE);
  });

  it('fails soft to null when the CLI writes invalid JSON', async () => {
    const dir = ws();
    const run = vi.fn(async (_cmd, args: string[]) => {
      const out = args[args.indexOf('--out') + 1];
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, '{ not valid');
      return { stdout: '', stderr: '' };
    });
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock'], run, cliPath: __filename, onReason,
    });
    expect(await client.analyze('/x/video.mp4', 'job5')).toBeNull();
    expect(reasons).toContain(ReasonCode.PERCEPTION_UNAVAILABLE);
  });
});
