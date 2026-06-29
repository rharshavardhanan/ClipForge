import { describe, it, expect, beforeAll } from 'vitest';
import { probe } from '../../src/utils/ffmpeg.js';
import { makeTestAsset } from '../helpers/makeTestAsset.js';
import { join } from 'node:path';

const asset = join('workspace', 'temp', 'test_6s.mp4');

describe('ffmpeg helpers', () => {
  beforeAll(async () => { await makeTestAsset(asset); }, 60_000);

  it('probe returns dimensions and duration', async () => {
    const p = await probe(asset);
    expect(p.width).toBe(1280);
    expect(p.height).toBe(720);
    expect(p.duration).toBeGreaterThan(5.5);
    expect(p.fps).toBeCloseTo(30, 0);
  });
});
