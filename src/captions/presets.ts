/**
 * Caption style presets — the "premium subtitle" system. A CaptionStyle is a pure JSON
 * config consumed by the Remotion caption track (remotion/src/captionStyle.ts mirrors the
 * shape). Presets are named after the editing styles they emulate; legacy minimal/card/bold
 * keep the pre-preset renderer look.
 */

export type CaptionFont = 'anton' | 'bangers' | 'archivo' | 'montserrat' | 'poppins' | 'inter';

export interface CaptionStyle {
  font: CaptionFont;
  fontSize: number;
  emphasisSize: number;
  baseColor: string;
  /** Highlight color for the active word; falls back to the render accent when absent. */
  activeColor?: string;
  strokeWidth: number;
  strokeColor: string;
  animation: 'karaoke' | 'pop' | 'bounce' | 'glow';
  position: 'bottom' | 'center';
  uppercase: boolean;
  wordsPerLine: number;
  background: 'none' | 'card';
}

export type PresetName =
  | 'mrbeast' | 'hormozi' | 'gadzhi' | 'gaming' | 'podcast' | 'cinematic'
  | 'minimal' | 'card' | 'bold' | 'montagem';

const FONTS: CaptionFont[] = ['anton', 'bangers', 'archivo', 'montserrat', 'poppins', 'inter'];

export const CAPTION_PRESETS: Record<PresetName, CaptionStyle> = {
  mrbeast: {
    font: 'bangers', fontSize: 78, emphasisSize: 94, baseColor: '#FFFFFF', activeColor: '#FFE81A',
    strokeWidth: 10, strokeColor: '#000000', animation: 'pop', position: 'bottom',
    uppercase: true, wordsPerLine: 3, background: 'none',
  },
  hormozi: {
    font: 'montserrat', fontSize: 70, emphasisSize: 84, baseColor: '#FFFFFF', activeColor: '#00FF47',
    strokeWidth: 8, strokeColor: '#000000', animation: 'pop', position: 'bottom',
    uppercase: true, wordsPerLine: 3, background: 'card',
  },
  gadzhi: {
    font: 'montserrat', fontSize: 60, emphasisSize: 72, baseColor: '#F5F0E8', activeColor: '#D9B36A',
    strokeWidth: 0, strokeColor: '#000000', animation: 'glow', position: 'bottom',
    uppercase: false, wordsPerLine: 4, background: 'none',
  },
  gaming: {
    font: 'bangers', fontSize: 74, emphasisSize: 90, baseColor: '#FFFFFF', activeColor: '#00E5FF',
    strokeWidth: 8, strokeColor: '#000000', animation: 'bounce', position: 'bottom',
    uppercase: true, wordsPerLine: 3, background: 'none',
  },
  podcast: {
    font: 'inter', fontSize: 54, emphasisSize: 62, baseColor: '#FFFFFF',
    strokeWidth: 3, strokeColor: '#000000', animation: 'karaoke', position: 'bottom',
    uppercase: false, wordsPerLine: 5, background: 'none',
  },
  cinematic: {
    font: 'montserrat', fontSize: 46, emphasisSize: 52, baseColor: '#EDEDED',
    strokeWidth: 0, strokeColor: '#000000', animation: 'karaoke', position: 'center',
    uppercase: true, wordsPerLine: 5, background: 'none',
  },
  montagem: {
    font: 'anton', fontSize: 82, emphasisSize: 100, baseColor: '#FFFFFF', activeColor: '#FF2E2E',
    strokeWidth: 6, strokeColor: '#000000', animation: 'glow', position: 'center',
    uppercase: true, wordsPerLine: 2, background: 'none',
  },
  // Legacy styles — match the pre-preset renderer exactly.
  bold: {
    font: 'anton', fontSize: 70, emphasisSize: 84, baseColor: '#FFFFFF',
    strokeWidth: 0, strokeColor: '#000000', animation: 'karaoke', position: 'bottom',
    uppercase: true, wordsPerLine: 4, background: 'none',
  },
  minimal: {
    font: 'inter', fontSize: 56, emphasisSize: 64, baseColor: '#FFFFFF',
    strokeWidth: 2, strokeColor: '#000000', animation: 'karaoke', position: 'bottom',
    uppercase: false, wordsPerLine: 5, background: 'none',
  },
  card: {
    font: 'anton', fontSize: 70, emphasisSize: 84, baseColor: '#FFFFFF',
    strokeWidth: 0, strokeColor: '#000000', animation: 'karaoke', position: 'bottom',
    uppercase: true, wordsPerLine: 4, background: 'card',
  },
};

export interface CaptionOverrides {
  font?: string;
  fontSize?: number;
  color?: string;
  strokeWidth?: number;
  position?: string;
}

/** Resolve a preset name + CLI overrides into a concrete CaptionStyle. Unknown preset → bold. */
export function resolveCaptionStyle(preset: string, overrides: CaptionOverrides): CaptionStyle {
  const base = CAPTION_PRESETS[preset as PresetName] ?? CAPTION_PRESETS.bold;
  const style: CaptionStyle = { ...base };

  if (overrides.font && FONTS.includes(overrides.font as CaptionFont)) style.font = overrides.font as CaptionFont;
  if (overrides.fontSize && overrides.fontSize > 0) {
    style.emphasisSize = Math.round(overrides.fontSize * (base.emphasisSize / base.fontSize));
    style.fontSize = overrides.fontSize;
  }
  if (overrides.color) style.baseColor = overrides.color;
  if (overrides.strokeWidth !== undefined && overrides.strokeWidth >= 0) style.strokeWidth = overrides.strokeWidth;
  if (overrides.position === 'bottom' || overrides.position === 'center') style.position = overrides.position;

  return style;
}
