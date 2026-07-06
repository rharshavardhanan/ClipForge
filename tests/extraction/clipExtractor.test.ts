import { describe, it, expect, beforeAll } from 'vitest';
import { buildVideoFilter, buildExtractArgs, buildFullFrameExtractArgs, extractRaw } from '../../src/extraction/clipExtractor.js';
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
  it('full-frame extract args have no crop/-vf filter and keep CFR + libx264', () => {
    const args = buildFullFrameExtractArgs('in.mp4', 12.5, 40, 'af', 'out.mp4');
    expect(args).not.toContain('-vf');
    expect(args.join(' ')).not.toContain('crop=');
    expect(args).toContain('-fps_mode');
    expect(args).toContain('cfr');
    expect(args).toContain('libx264');
    expect(args).toContain('-t');
    const ss = args.indexOf('-ss'); const i = args.indexOf('-i');
    expect(ss).toBeLessThan(i);
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

describe('segmented (tightened) extraction (v4 Slice C)', () => {
  it('buildSegmentedExtractArgs concatenates kept segments via select/aselect', async () => {
    const { buildSegmentedExtractArgs } = await import('../../src/extraction/clipExtractor.js');
    const args = buildSegmentedExtractArgs('src.mp4', 12, [{ start: 0, end: 5 }, { start: 8, end: 12 }], buildAudioFilter(), 'out.mp4');
    const s = args.join(' ');
    expect(s).toContain('-ss 12');                       // seek to clip start
    expect(s).toContain('-t 12');                        // bound the read to the clip window
    expect(s).toContain("between(t,0,5)+between(t,8,12)");
    expect(s).toContain('setpts=N/FRAME_RATE/TB');
    expect(s).toContain('asetpts=N/SR/TB');
    expect(s).toContain('loudnorm');                      // existing audio filter preserved
  });

  it('extractTightened arg choice: identity keep uses the plain full-frame path', async () => {
    const { buildSegmentedExtractArgs, buildFullFrameExtractArgs } = await import('../../src/extraction/clipExtractor.js');
    // a real (multi-segment) keep uses select; the caller (extractTightened) delegates identity
    // to buildFullFrameExtractArgs, which has no select filter
    const plain = buildFullFrameExtractArgs('src.mp4', 12, 30, buildAudioFilter(), 'out.mp4').join(' ');
    expect(plain).not.toContain('select');
    const seg = buildSegmentedExtractArgs('src.mp4', 12, [{ start: 0, end: 5 }, { start: 8, end: 30 }], buildAudioFilter(), 'out.mp4').join(' ');
    expect(seg).toContain('select');
  });
});
