import { describe, it, expect, beforeAll } from 'vitest';
import { parseRmsLevels, normalizeRms, parseSilenceRegions, analyzeAudio } from '../../src/analysis/audioEnergy.js';
import { makeTestAsset } from '../helpers/makeTestAsset.js';
import { join } from 'node:path';

describe('audioEnergy parsers', () => {
  it('parses Overall.RMS_level key form', () => {
    const s = 'lavfi.astats.Overall.RMS_level=-12.5\nlavfi.astats.Overall.RMS_level=-40.0';
    expect(parseRmsLevels(s)).toEqual([-12.5, -40.0]);
  });
  it('parses bare RMS_level key form (mono builds)', () => {
    const s = 'lavfi.astats.RMS_level=-9.0\nlavfi.astats.RMS_level=-inf';
    expect(parseRmsLevels(s)).toEqual([-9.0, -100]);
  });
  it('normalizeRms maps -50→0 and -10→10 clamped', () => {
    expect(normalizeRms(-50)).toBeCloseTo(0);
    expect(normalizeRms(-10)).toBeCloseTo(10);
    expect(normalizeRms(0)).toBe(10);
    expect(normalizeRms(-100)).toBe(0);
  });
  it('parses silencedetect pairs', () => {
    const s = '[silencedetect] silence_start: 2.0\n[silencedetect] silence_end: 3.2 | silence_duration: 1.2';
    expect(parseSilenceRegions(s)).toEqual([{ start: 2.0, end: 3.2 }]);
  });
  it('accepts a negative silence_start at the stream boundary', () => {
    const s = '[silencedetect] silence_start: -0.023\n[silencedetect] silence_end: 1.5 | silence_duration: 1.523';
    expect(parseSilenceRegions(s)).toEqual([{ start: -0.023, end: 1.5 }]);
  });
});

describe('analyzeAudio (integration)', () => {
  const asset = join('workspace', 'temp', 'test_6s.mp4');
  beforeAll(async () => { await makeTestAsset(asset); }, 60_000);
  it('produces an rms curve and finds the silent region', async () => {
    const layer = await analyzeAudio(asset);
    expect(layer.rms_curve.length).toBeGreaterThan(3);
    layer.rms_curve.forEach((p) => { expect(p.rms).toBeGreaterThanOrEqual(0); expect(p.rms).toBeLessThanOrEqual(10); });
    const hasSilence = layer.silence_regions.some((r) => r.start >= 1.5 && r.end <= 3.7);
    expect(hasSilence).toBe(true);
  });
});
