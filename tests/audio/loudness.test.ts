import { describe, it, expect } from 'vitest';
import {
  buildLoudnessMeasureArgs, parseLoudnessJson, buildLoudnessApplyArgs,
  TARGET_LUFS, TRUE_PEAK_CEILING,
} from '../../src/audio/loudness.js';

describe('buildLoudnessMeasureArgs', () => {
  it('requests JSON loudnorm on a null output', () => {
    const a = buildLoudnessMeasureArgs('in.mp4').join(' ');
    expect(a).toContain('print_format=json');
    expect(a).toContain('loudnorm');
    expect(a).toContain('-f null');
    expect(a).toContain('in.mp4');
  });
});

describe('parseLoudnessJson', () => {
  it('extracts the five measured values from ffmpeg stderr', () => {
    const stderr = `
[Parsed_loudnorm_0 @ 0x123]
{
	"input_i" : "-23.50",
	"input_tp" : "-4.20",
	"input_lra" : "7.30",
	"input_thresh" : "-33.90",
	"output_i" : "-14.00",
	"target_offset" : "0.90"
}
`;
    const m = parseLoudnessJson(stderr)!;
    expect(m.input_i).toBeCloseTo(-23.5);
    expect(m.input_tp).toBeCloseTo(-4.2);
    expect(m.input_lra).toBeCloseTo(7.3);
    expect(m.input_thresh).toBeCloseTo(-33.9);
    expect(m.target_offset).toBeCloseTo(0.9);
  });
  it('null when no loudnorm block present', () => {
    expect(parseLoudnessJson('frame= 100 fps=25')).toBeNull();
  });
});

describe('buildLoudnessApplyArgs', () => {
  it('seeds the second pass with measured values, linear, video-copy', () => {
    const m = { input_i: -23.5, input_tp: -4.2, input_lra: 7.3, input_thresh: -33.9, target_offset: 0.9 };
    const a = buildLoudnessApplyArgs('in.mp4', 'out.mp4', m).join(' ');
    expect(a).toContain(`I=${TARGET_LUFS}`);
    expect(a).toContain(`TP=${TRUE_PEAK_CEILING}`);
    expect(a).toContain('measured_I=-23.5');
    expect(a).toContain('measured_thresh=-33.9');
    expect(a).toContain('linear=true');
    expect(a).toContain('-c:v copy');
  });
});
