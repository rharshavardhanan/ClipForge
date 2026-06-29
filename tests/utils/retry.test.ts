import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const r = await withRetry(fn, { attempts: 3, label: 't', baseMs: 1 });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockResolvedValue('ok');
    const r = await withRetry(fn, { attempts: 3, label: 't', baseMs: 1 });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { attempts: 3, label: 't', baseMs: 1 }))
      .rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
