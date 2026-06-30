import { spawn } from 'node:child_process';

export function run(
  cmd: string,
  args: string[],
  opts: { onStderr?: (line: string) => void; onStdout?: (line: string) => void; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      if (opts.onStdout) s.split('\n').forEach((l) => l && opts.onStdout!(l));
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      if (opts.onStderr) s.split('\n').forEach((l) => l && opts.onStderr!(l));
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code ?? `signal ${signal}`}: ${stderr.slice(-500)}`));
    });
  });
}
