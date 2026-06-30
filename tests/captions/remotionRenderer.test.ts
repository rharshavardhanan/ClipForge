import { describe, it, expect } from 'vitest';
import { buildRenderArgs } from '../../src/captions/remotionRenderer.js';

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
