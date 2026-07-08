import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runUnderstanding } from '../../src/understanding/engine.js';

const CHUNKS = [
  { start: 0, end: 540, segments: [{ start: 1, end: 4, text: 'hello', words: [] }] },
  { start: 480, end: 1020, segments: [{ start: 500, end: 504, text: 'world', words: [] }] },
] as never[];
const SIG = { rms: [], motion: [], events: [], durationSec: 1000, useSceneTerm: true };
const GOOD = {
  arcs: [], edges: [],
  scenes: [{ span: { start: 400, end: 600 }, label: 'intro chat', participants: [], goal: 'g', emotion: 'e', events: [], importance: 0.7 }],
};

describe('runUnderstanding', () => {
  it('asks once per chunk, validates, assembles, and caches incrementally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'und-'));
    const cachePath = join(dir, 'layer_understanding_test.json');
    let calls = 0;
    const u = await runUnderstanding(CHUNKS, () => 'ev', () => '', SIG, {
      cachePath, durationSec: 1000, mode: 'clippies', provider: 'gemini',
      ask: async () => { calls++; return GOOD; },
    });
    expect(calls).toBe(2);
    expect(u.scenes.length).toBeGreaterThan(0);
    expect(u.provider).toBe('gemini');
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(Object.keys(cache.chunks)).toEqual(['0-540', '480-1020']);

    // second run: cache hit, zero calls
    const u2 = await runUnderstanding(CHUNKS, () => 'ev', () => '', SIG, {
      cachePath, durationSec: 1000, mode: 'clippies', provider: 'gemini',
      ask: async () => { throw new Error('must not be called'); },
    });
    expect(u2.scenes.length).toBe(u.scenes.length);
  });

  it('a throwing chunk is skipped and NOT cached (retry next run)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'und-'));
    const cachePath = join(dir, 'layer_understanding_test.json');
    let n = 0;
    const u = await runUnderstanding(CHUNKS, () => 'ev', () => '', SIG, {
      cachePath, durationSec: 1000, mode: 'clippies', provider: 'gemini',
      ask: async () => { n++; if (n === 1) throw new Error('429'); return GOOD; },
    });
    expect(u.scenes.length).toBeGreaterThan(0);          // chunk 2 still contributed
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(Object.keys(cache.chunks)).toEqual(['480-1020']);
  });

  it("provider 'none' makes zero LLM calls and returns a heuristic result", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'und-'));
    const u = await runUnderstanding(CHUNKS, () => 'ev', () => '', { ...SIG, useSceneTerm: false }, {
      cachePath: join(dir, 'c.json'), durationSec: 1000, mode: 'clippies', provider: 'none',
      ask: async () => { throw new Error('must not be called'); },
    });
    expect(u.arcs).toEqual([]);
    expect(u.edges).toEqual([]);
    expect(u.importance.length).toBe(1001);
    expect(u.provider).toBe('none');
  });
});
