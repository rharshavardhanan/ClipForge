import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { motionLayer } from '../../src/analysis/motion.js';

const CURVE = [{ time: 0, v: 1.5 }, { time: 0.125, v: 3.2 }];

describe('motionLayer', () => {
  it('computes once and writes the cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-'));
    const out = join(dir, 'layer_motion.json');
    const fn = vi.fn().mockResolvedValue(CURVE);
    expect(await motionLayer('/v.mp4', out, fn)).toEqual(CURVE);
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(CURVE);
    expect(fn).toHaveBeenCalledOnce();
  });
  it('cache hit skips computation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-'));
    const out = join(dir, 'layer_motion.json');
    await writeFile(out, JSON.stringify(CURVE));
    const fn = vi.fn();
    expect(await motionLayer('/v.mp4', out, fn)).toEqual(CURVE);
    expect(fn).not.toHaveBeenCalled();
  });
  it('corrupt cache → recompute', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-'));
    const out = join(dir, 'layer_motion.json');
    await writeFile(out, 'not json');
    const fn = vi.fn().mockResolvedValue(CURVE);
    expect(await motionLayer('/v.mp4', out, fn)).toEqual(CURVE);
    expect(fn).toHaveBeenCalledOnce();
  });
});
