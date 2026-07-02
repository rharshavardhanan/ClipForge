import { describe, it, expect } from 'vitest';
import { CAPTION_PRESETS, resolveCaptionStyle } from '../../src/captions/presets.js';

describe('CAPTION_PRESETS', () => {
  it('defines all nine presets', () => {
    for (const name of ['mrbeast', 'hormozi', 'gadzhi', 'gaming', 'podcast', 'cinematic', 'minimal', 'card', 'bold']) {
      expect(CAPTION_PRESETS[name as keyof typeof CAPTION_PRESETS]).toBeDefined();
    }
  });

  it('legacy bold preset matches the current renderer look (anton 70/84 karaoke uppercase)', () => {
    const bold = CAPTION_PRESETS.bold;
    expect(bold.font).toBe('anton');
    expect(bold.fontSize).toBe(70);
    expect(bold.emphasisSize).toBe(84);
    expect(bold.animation).toBe('karaoke');
    expect(bold.uppercase).toBe(true);
    expect(bold.wordsPerLine).toBe(4);
  });

  it('every preset keeps emphasisSize >= fontSize', () => {
    for (const s of Object.values(CAPTION_PRESETS)) {
      expect(s.emphasisSize).toBeGreaterThanOrEqual(s.fontSize);
    }
  });
});

describe('resolveCaptionStyle', () => {
  it('unknown preset falls back to bold', () => {
    expect(resolveCaptionStyle('nope', {})).toEqual(CAPTION_PRESETS.bold);
  });

  it('applies overrides on top of the preset', () => {
    const s = resolveCaptionStyle('podcast', { color: '#FF0000', strokeWidth: 6, position: 'center' });
    expect(s.baseColor).toBe('#FF0000');
    expect(s.strokeWidth).toBe(6);
    expect(s.position).toBe('center');
    expect(s.font).toBe(CAPTION_PRESETS.podcast.font); // untouched fields keep preset values
  });

  it('fontSize override scales emphasisSize proportionally', () => {
    const preset = CAPTION_PRESETS.mrbeast; // 78 / 94
    const s = resolveCaptionStyle('mrbeast', { fontSize: 39 });
    expect(s.fontSize).toBe(39);
    expect(s.emphasisSize).toBe(Math.round(39 * (preset.emphasisSize / preset.fontSize)));
  });

  it('font override accepts only known fonts, otherwise keeps the preset font', () => {
    expect(resolveCaptionStyle('bold', { font: 'bangers' }).font).toBe('bangers');
    expect(resolveCaptionStyle('bold', { font: 'comic-sans' }).font).toBe('anton');
  });
});
