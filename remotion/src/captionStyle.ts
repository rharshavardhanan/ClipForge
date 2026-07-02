/**
 * Structural mirror of src/captions/presets.ts#CaptionStyle (props cross the Node→Remotion
 * boundary as JSON, so only the shape must match). DEFAULT_STYLE keeps the legacy "bold" look
 * for renders that don't pass a caption config.
 */
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { loadFont as loadBangers } from '@remotion/google-fonts/Bangers';
import { loadFont as loadArchivo } from '@remotion/google-fonts/ArchivoBlack';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';

export type CaptionFont = 'anton' | 'bangers' | 'archivo' | 'montserrat' | 'poppins' | 'inter';

export type CaptionStyle = {
  font: CaptionFont;
  fontSize: number;
  emphasisSize: number;
  baseColor: string;
  activeColor?: string;
  strokeWidth: number;
  strokeColor: string;
  animation: 'karaoke' | 'pop' | 'bounce' | 'glow';
  position: 'bottom' | 'center';
  uppercase: boolean;
  wordsPerLine: number;
  background: 'none' | 'card';
};

const anton = loadAnton();
const bangers = loadBangers();
const archivo = loadArchivo();
const montserrat = loadMontserrat('normal', { weights: ['700', '800'], subsets: ['latin'] });
const poppins = loadPoppins('normal', { weights: ['600', '700'], subsets: ['latin'] });
const inter = loadInter('normal', { weights: ['600', '700'], subsets: ['latin'] });

const FONT_MAP: Record<CaptionFont, { family: string; weight: number }> = {
  anton: { family: anton.fontFamily, weight: 400 },
  bangers: { family: bangers.fontFamily, weight: 400 },
  archivo: { family: archivo.fontFamily, weight: 400 },
  montserrat: { family: montserrat.fontFamily, weight: 800 },
  poppins: { family: poppins.fontFamily, weight: 700 },
  inter: { family: inter.fontFamily, weight: 600 },
};

export function fontFamilyFor(font: CaptionFont): { family: string; weight: number } {
  return FONT_MAP[font] ?? FONT_MAP.anton;
}

export const DEFAULT_STYLE: CaptionStyle = {
  font: 'anton', fontSize: 70, emphasisSize: 84, baseColor: '#FFFFFF',
  strokeWidth: 0, strokeColor: '#000000', animation: 'karaoke', position: 'bottom',
  uppercase: true, wordsPerLine: 4, background: 'none',
};
