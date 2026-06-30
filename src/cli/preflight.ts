import { run } from '../utils/cmd.js';

const defaultExec = (cmd: string) => {
  const [bin, ...args] = cmd.split(' ');
  return run(bin, args);
};

export async function checkDependencies(execFn: (cmd: string) => Promise<unknown> = defaultExec) {
  const checks = [
    { cmd: 'yt-dlp --version', name: 'yt-dlp', hint: 'brew install yt-dlp' },
    { cmd: 'ffmpeg -version', name: 'ffmpeg', hint: 'brew install ffmpeg' },
    { cmd: 'ffprobe -version', name: 'ffprobe', hint: 'brew install ffmpeg' },
  ];
  const missing: { name: string; hint: string }[] = [];
  for (const c of checks) {
    try { await execFn(c.cmd); } catch { missing.push({ name: c.name, hint: c.hint }); }
  }
  return { ok: missing.length === 0, missing };
}
