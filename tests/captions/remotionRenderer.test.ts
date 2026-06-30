import { describe, it, expect } from 'vitest';
import { buildRenderArgs, buildProps, type RenderOpts } from '../../src/captions/remotionRenderer.js';

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
