import { describe, it, expect } from 'vitest';
import { KeyPool, loadGeminiKeys } from '../../src/analysis/keyPool.js';

describe('KeyPool', () => {
  it('round-robins across keys in order', () => {
    const pool = new KeyPool(['a', 'b', 'c']);
    expect(pool.next()).toBe('a');
    expect(pool.next()).toBe('b');
    expect(pool.next()).toBe('c');
    expect(pool.next()).toBe('a');
  });

  it('skips a rate-limited key until its cooldown elapses', () => {
    let t = 0;
    const pool = new KeyPool(['a', 'b'], () => t);
    expect(pool.next()).toBe('a');
    pool.reportRateLimited('b', 5000); // cooldown until t=5000, but we haven't called b yet
    // cursor is now at 'b'; since b is cooling, skip to 'a'
    expect(pool.next()).toBe('a');
    // cursor wraps to 'b' again — still cooling
    t = 4999;
    expect(pool.next()).toBe('a');
    // advance clock past cooldown expiry
    t = 5000;
    expect(pool.next()).toBe('b');
  });

  it('returns the soonest-expiry key when all keys are cooling', () => {
    let t = 0;
    const pool = new KeyPool(['a', 'b', 'c'], () => t);
    pool.reportRateLimited('a', 10000); // expires at 10000
    pool.reportRateLimited('b', 3000); // expires at 3000 (soonest)
    pool.reportRateLimited('c', 8000); // expires at 8000
    expect(pool.next()).toBe('b');
  });

  it('returns null for an empty pool', () => {
    const pool = new KeyPool([]);
    expect(pool.next()).toBeNull();
  });

  it('reportSuccess clears a cooldown so the key becomes eligible again', () => {
    let t = 0;
    const pool = new KeyPool(['a', 'b'], () => t);
    pool.reportRateLimited('a', 10000);
    pool.reportSuccess('a');
    // cursor starts at 'a'; since cooldown cleared, it should be eligible immediately
    expect(pool.next()).toBe('a');
  });

  it('size() reports the number of keys', () => {
    expect(new KeyPool(['a', 'b', 'c']).size()).toBe(3);
    expect(new KeyPool([]).size()).toBe(0);
  });
});

describe('loadGeminiKeys', () => {
  it('parses GEMINI_API_KEYS as a comma-separated, trimmed list', () => {
    expect(loadGeminiKeys({ GEMINI_API_KEYS: 'a,b ,c' } as NodeJS.ProcessEnv)).toEqual(['a', 'b', 'c']);
  });

  it('drops empty entries from GEMINI_API_KEYS', () => {
    expect(loadGeminiKeys({ GEMINI_API_KEYS: 'a,,b,' } as NodeJS.ProcessEnv)).toEqual(['a', 'b']);
  });

  it('falls back to GEMINI_API_KEY when GEMINI_API_KEYS is absent', () => {
    expect(loadGeminiKeys({ GEMINI_API_KEY: 'solo' } as NodeJS.ProcessEnv)).toEqual(['solo']);
  });

  it('falls back to GEMINI_API_KEY when GEMINI_API_KEYS is empty', () => {
    expect(loadGeminiKeys({ GEMINI_API_KEYS: '', GEMINI_API_KEY: 'solo' } as NodeJS.ProcessEnv)).toEqual(['solo']);
  });

  it('returns [] when both env vars are absent', () => {
    expect(loadGeminiKeys({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});
