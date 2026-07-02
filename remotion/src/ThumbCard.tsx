import { AbsoluteFill, Img, staticFile } from 'remotion';
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { splitThumbLines } from './thumbLogic';

const anton = loadAnton();

// type alias (not interface) so props satisfy Remotion's Record<string, unknown> constraint
export type ThumbProps = {
  framePath: string;   // relative to remotion/public (staticFile)
  text: string;        // short punch text, <= 4 words
  accent: string;
  /** Zoom focus, normalized 0-1 in the source frame. Defaults to center. */
  faceX?: number;
  faceY?: number;
};

/**
 * MrBeast-style thumbnail card (1280x720 still): the clip's loudest frame, punched in
 * toward the face, saturation/contrast pop, vignette, and huge stroked title text with
 * the last word in the accent color.
 */
export const ThumbCard: React.FC<ThumbProps> = ({ framePath, text, accent, faceX, faceY }) => {
  const fx = (faceX ?? 0.5) * 100;
  const fy = (faceY ?? 0.5) * 100;
  const { lines, lastWord } = splitThumbLines(text.toUpperCase());

  const renderLine = (line: string, i: number, isLast: boolean) => {
    const words = line.split(' ');
    return (
      <div key={i} style={{ lineHeight: 1.02 }}>
        {words.map((w, j) => {
          const highlight = isLast && j === words.length - 1 && w === lastWord;
          return (
            <span key={j} style={{ color: highlight ? accent : '#FFFFFF', marginRight: 22 }}>{w}</span>
          );
        })}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img
          src={staticFile(framePath)}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: 'scale(1.25)', transformOrigin: `${fx}% ${fy}%`,
            filter: 'saturate(1.35) contrast(1.12)',
          }}
        />
      </AbsoluteFill>
      {/* vignette + bottom gradient so the text always pops */}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 45%)' }} />
      <AbsoluteFill style={{ justifyContent: 'flex-end', padding: '0 54px 40px' }}>
        <div
          style={{
            fontFamily: anton.fontFamily,
            fontSize: 118,
            letterSpacing: 1,
            WebkitTextStroke: '7px black',
            paintOrder: 'stroke fill',
            textShadow: '0 10px 28px rgba(0,0,0,0.9)',
          }}
        >
          {lines.map((l, i) => renderLine(l, i, i === lines.length - 1))}
        </div>
        <div style={{ width: 240, height: 12, background: accent, borderRadius: 6, marginTop: 18 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
