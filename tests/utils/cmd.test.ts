import { describe, it, expect } from 'vitest';
import { run } from '../../src/utils/cmd.js';

describe('run', () => {
  it('captures stdout from a successful command', async () => {
    const { stdout } = await run('node', ['-e', "process.stdout.write('hi')"]);
    expect(stdout).toBe('hi');
  });
  it('rejects on non-zero exit', async () => {
    await expect(run('node', ['-e', 'process.exit(2)'])).rejects.toThrow(/exited 2/);
  });
});
