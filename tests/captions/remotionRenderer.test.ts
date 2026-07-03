import { describe, it, expect } from 'vitest';
import { buildRenderArgs, buildProps, buildBrollWindows, type RenderOpts } from '../../src/captions/remotionRenderer.js';
import { CAPTION_PRESETS } from '../../src/captions/presets.js';

describe('buildRenderArgs', () => {
  it('renders CaptionedClip with h264/crf18/yuv420p and props file', () => {
    const args = buildRenderArgs('/tmp/props.json', '/out/clip_001_final.mp4');
    const j = args.join(' ');
    expect(j).toContain('CaptionedClip');
    expect(j).toContain('--codec=h264');
    expect(j).toContain('--crf=18');
    expect(j).toContain('--pixel-format=yuv420p');
    expect(j).toContain('--props=/tmp/props.json');
    expect(j).toContain('--output=/out/clip_001_final.mp4');
  });

  it('uses src/index.ts as the entry point', () => {
    const args = buildRenderArgs('/props.json', '/out.mp4');
    expect(args).toContain('src/index.ts');
  });

  it('uses render subcommand', () => {
    const args = buildRenderArgs('/props.json', '/out.mp4');
    expect(args).toContain('render');
  });
});

describe('buildProps', () => {
  const baseOpts: RenderOpts = {
    rawClipPath: '/raw.mp4', words: [], outPath: '/out/clip_001_final.mp4', fps: 30,
  };

  it('enables the hook card when hookText is a non-empty string', () => {
    const props = buildProps({ ...baseOpts, hookText: 'This changes everything' }, 10, 'input/clip_001_final.mp4');
    expect(props.showHookCard).toBe(true);
    expect(props.hookText).toBe('This changes everything');
  });

  it('disables the hook card when hookText is omitted', () => {
    const props = buildProps(baseOpts, 10, 'input/clip_001_final.mp4');
    expect(props.showHookCard).toBe(false);
    expect(props.hookText).toBe('');
  });

  it('disables the hook card when hookText is whitespace-only', () => {
    const props = buildProps({ ...baseOpts, hookText: '   ' }, 10, 'input/clip_001_final.mp4');
    expect(props.showHookCard).toBe(false);
  });

  it('computes durationInFrames from probed duration and fps', () => {
    const props = buildProps(baseOpts, 5, 'input/clip_001_final.mp4');
    expect(props.durationInFrames).toBe(150);
  });

  it('carries the caption style through when provided, omits it otherwise', () => {
    const withStyle = buildProps({ ...baseOpts, caption: CAPTION_PRESETS.mrbeast }, 10, 'input/x.mp4');
    expect(withStyle.caption).toEqual(CAPTION_PRESETS.mrbeast);
    const without = buildProps(baseOpts, 10, 'input/x.mp4');
    expect(without.caption).toBeUndefined();
  });

  it('enables punch zooms by default and disables on zooms:false', () => {
    expect(buildProps(baseOpts, 10, 'input/x.mp4').zooms).toBe(true);
    expect(buildProps({ ...baseOpts, zooms: false }, 10, 'input/x.mp4').zooms).toBe(false);
  });

  it('passes node-computed zoom times through, absent when not provided', () => {
    expect(buildProps({ ...baseOpts, zoomTimes: [2.5, 6] }, 10, 'input/x.mp4').zoomTimes).toEqual([2.5, 6]);
    expect(buildProps(baseOpts, 10, 'input/x.mp4').zoomTimes).toBeUndefined();
  });

  it('carries the framing mode through (blur default via undefined, crop when set)', () => {
    expect(buildProps({ ...baseOpts, framing: 'crop' }, 10, 'input/x.mp4').framing).toBe('crop');
    expect(buildProps({ ...baseOpts, framing: 'blur' }, 10, 'input/x.mp4').framing).toBe('blur');
    expect(buildProps(baseOpts, 10, 'input/x.mp4').framing).toBeUndefined();
  });

  it('carries cropTrack/srcW/srcH through when provided', () => {
    const props = buildProps(
      { ...baseOpts, cropTrack: [{ time: 0, cx: 1, cy: 2, cropW: 3, cropH: 4 }], srcW: 1920, srcH: 1080 },
      10,
      'input/clip_001_final.mp4',
    );
    expect(props.cropTrack).toHaveLength(1);
    expect(props.srcW).toBe(1920);
    expect(props.srcH).toBe(1080);
  });
});

describe('B-roll props (v6)', () => {
  it('buildBrollWindows converts seconds to frames with staged rel paths', () => {
    const wins = buildBrollWindows(
      [{ file: '/c/a.mp4', atSec: 4, durationSec: 3.5, entity: 'e', kind: 'person', query: 'q', sourceUrl: 'u' }],
      30, ['input/broll_clip_0.mp4'],
    );
    expect(wins).toEqual([{ videoPath: 'input/broll_clip_0.mp4', from: 120, durationInFrames: 105 }]);
  });
  it('buildProps carries broll windows and zoomIntensity', () => {
    const props = buildProps({
      rawClipPath: 'x.mp4', words: [], outPath: 'o.mp4', fps: 30, zoomIntensity: 0.55,
      broll: [{ file: '/c/a.mp4', atSec: 4, durationSec: 2, entity: 'e', kind: 'person', query: 'q', sourceUrl: 'u' }],
    }, 20, 'input/o.mp4', ['input/broll_o_0.mp4']);
    expect(props.zoomIntensity).toBe(0.55);
    expect(props.broll).toHaveLength(1);
    expect(props.broll![0].from).toBe(120);
  });
  it('buildProps omits broll when none supplied', () => {
    const props = buildProps({ rawClipPath: 'x.mp4', words: [], outPath: 'o.mp4', fps: 30 }, 20, 'input/o.mp4');
    expect(props.broll).toBeUndefined();
    expect(props.zoomIntensity).toBeUndefined();
  });
});
