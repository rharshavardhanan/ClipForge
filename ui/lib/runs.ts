/**
 * In-process run registry: spawns the compiled ClipForge CLI and buffers its log lines
 * for SSE streaming. Stored on globalThis because Next bundles route handlers separately.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { REPO_ROOT } from './workspace';

export interface Run {
  id: string;
  args: string[];
  logs: string[];
  done: boolean;
  code: number | null;
  proc: ChildProcess;
}

const registry: Map<string, Run> = ((globalThis as any).__cfRuns ??= new Map());

export function getRun(id: string): Run | undefined {
  return registry.get(id);
}

export function startRun(cliArgs: string[]): Run {
  const id = randomUUID().slice(0, 8);
  const proc = spawn('node', ['dist/cli/index.js', ...cliArgs], {
    cwd: REPO_ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const run: Run = { id, args: cliArgs, logs: [], done: false, code: null, proc };

  const push = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      const l = line.trim();
      if (l) run.logs.push(l);
    }
    if (run.logs.length > 2000) run.logs.splice(0, run.logs.length - 2000);
  };
  proc.stdout.on('data', push);
  proc.stderr.on('data', push);
  proc.on('close', (code) => {
    run.done = true;
    run.code = code;
    run.logs.push(code === 0 ? '✔ run complete' : `✗ run failed (exit ${code})`);
  });

  registry.set(id, run);
  return run;
}
