import { describe, it, expect, beforeAll } from 'vitest';
import { buildVideoFilter, buildExtractArgs, extractRaw } from '../../src/extraction/clipExtractor.js';
import { buildAudioFilter } from '../../src/extraction/audioProcessor.js';
import { probe } from '../../src/utils/ffmpeg.js';
import { makeTestAsset } from '../helpers/makeTestAsset.js';
import { join } from 'node:path';

describe('extraction arg builders', () => {
  it('audio filter targets -14 LUFS', () => {
    expect(buildAudioFilter()).toBe('loudnorm=I=-14:TP=-1.5:LRA=11');
  });
  it('landscape source center-crops to 9:16 then scales to 1080x1920', () => {
    const vf = buildVideoFilter(1920, 1080);
    expect(vf).toContain('crop=ih*9/16:ih');
    expect(vf).toContain('scale=1080:1920');
  });
  it('already-vertical source fills to 1080x1920 without letterbox', () => {
    const vf = buildVideoFilter(1080, 1920);
    expect(vf).toContain('scale=1080:1920');
    expect(vf).toContain('crop=1080:1920');   // fill-then-crop: no letterbox
    expect(vf).not.toContain('ih*9/16');       // not the landscape center-crop
    expect(vf).not.toContain('pad=');          // no black bars
  });
  it('extract args use input-seek -ss before -i and -t duration', () => {
    const args = buildExtractArgs('in.mp4', 12.5, 40, 'vf', 'af', 'out.mp4');
    const ss = args.indexOf('-ss'); const i = args.indexOf('-i');
    expect(ss).toBeLessThan(i);
    expect(args).toContain('-t');
  });
});

describe('extractRaw (integration)', () => {
  const asset = join('workspace', 'temp', 'test_6s.mp4');
  const out = join('workspace', 'temp', 'clip_raw.mp4');
  beforeAll(async () => { await makeTestAsset(asset); }, 60_000);
  it('produces a 1080x1920 clip', async () => {
    await extractRaw(asset, 1, 5, { width: 1280, height: 720 }, out);
    const p = await probe(out);
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
  }, 60_000);
});
