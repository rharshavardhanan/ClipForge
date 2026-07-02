import { spawn } from 'node:child_process';

export function run(
  cmd: string,
  args: string[],
  opts: {
    onStderr?: (line: string) => void; onStdout?: (line: string) => void; cwd?: string;
    /** Kill the process if it produces no output for this many ms (stall/hang watchdog). */
    stallMs?: number;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stalled = false;

    // Watchdog: any output resets the timer; if it fires, the process is hung — kill it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      if (!opts.stallMs) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        child.kill('SIGKILL');
      }, opts.stallMs);
    };
    kick();

    child.stdout.on('data', (d: Buffer) => {
      kick();
      const s = d.toString();
      stdout += s;
      if (opts.onStdout) s.split('\n').forEach((l) => l && opts.onStdout!(l));
    });
    child.stderr.on('data', (d: Buffer) => {
      kick();
      const s = d.toString();
      stderr += s;
      if (opts.onStderr) s.split('\n').forEach((l) => l && opts.onStderr!(l));
    });
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (stalled) reject(new Error(`${cmd} killed after stalling ${opts.stallMs}ms with no output (hung)`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code ?? `signal ${signal}`}: ${stderr.slice(-500)}`));
    });
  });
}
