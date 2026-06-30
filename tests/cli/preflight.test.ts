import { describe, it, expect, vi } from 'vitest';
import { checkDependencies } from '../../src/cli/preflight.js';

describe('checkDependencies', () => {
  it('reports all present when exec succeeds', async () => {
    const r = await checkDependencies(vi.fn().mockResolvedValue(undefined));
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
  });
  it('reports missing tools with install hints', async () => {
    const exec = vi.fn().mockImplementation((cmd: string) =>
      cmd.startsWith('yt-dlp') ? Promise.reject(new Error('nope')) : Promise.resolve());
    const r = await checkDependencies(exec);
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toEqual({ name: 'yt-dlp', hint: 'brew install yt-dlp' });
  });
});
