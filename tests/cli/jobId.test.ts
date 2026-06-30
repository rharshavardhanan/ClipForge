import { describe, it, expect } from 'vitest';
import { resolveJobId } from '../../src/cli/commands/all.js';

describe('resolveJobId', () => {
  it('uses the YouTube video id when present', () => {
    expect(resolveJobId('https://www.youtube.com/watch?v=H14bBuluwB8')).toBe('H14bBuluwB8');
  });
  it('falls back to a uuid for non-YouTube input', () => {
    const id = resolveJobId('https://vimeo.com/123');
    expect(id).toMatch(/[0-9a-f-]{36}/);
  });
  it('resolves a youtu.be short URL to the 11-char video id', () => {
    expect(resolveJobId('https://youtu.be/H14bBuluwB8')).toBe('H14bBuluwB8');
  });
});
