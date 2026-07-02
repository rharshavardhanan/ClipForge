import { useCurrentFrame, useVideoConfig, interpolate, AbsoluteFill } from 'remotion';
import { groupIntoLines, findActiveIndex, visibleLineIndex, type CaptionWord } from './captionLogic';
import { DEFAULT_STYLE, fontFamilyFor, type CaptionStyle } from './captionStyle';

/** Per-word transform/decoration for the configured animation. `age` = seconds since word start. */
function wordAnimation(
  style: CaptionStyle, isActive: boolean, emphasized: boolean, age: number, activeColor: string,
): { scale: number; translateY: number; color: string; extraShadow: string } {
  const baseScale = isActive ? (emphasized ? 1.4 : 1.2) : 1;
  switch (style.animation) {
    case 'pop': {
      const popIn = isActive ? interpolate(age, [0, 0.12], [0.7, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
      return { scale: baseScale * popIn + (isActive ? 0.05 : 0), translateY: 0, color: isActive ? activeColor : style.baseColor, extraShadow: '' };
    }
    case 'bounce': {
      const bump = isActive ? interpolate(age, [0, 0.1, 0.28], [0, -14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
      return { scale: baseScale, translateY: bump, color: isActive ? activeColor : style.baseColor, extraShadow: '' };
    }
    case 'glow':
      return {
        scale: baseScale, translateY: 0, color: isActive ? activeColor : style.baseColor,
        extraShadow: isActive ? `, 0 0 24px ${activeColor}, 0 0 48px ${activeColor}80` : '',
      };
    case 'karaoke':
    default:
      return { scale: baseScale, translateY: 0, color: isActive ? activeColor : style.baseColor, extraShadow: '' };
  }
}

export const CaptionTrack: React.FC<{ words: CaptionWord[]; accentColor: string; caption?: CaptionStyle }> = ({
  words, accentColor, caption,
}) => {
  const style = caption ?? DEFAULT_STYLE;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const active = findActiveIndex(words, t, 50);
  const lines = groupIntoLines(words, style.wordsPerLine);
  const activeLine = visibleLineIndex(words, style.wordsPerLine, t, 50);
  const activeColor = style.activeColor ?? accentColor;
  const { family, weight } = fontFamilyFor(style.font);

  return (
    <AbsoluteFill style={{
      justifyContent: style.position === 'center' ? 'center' : 'flex-end',
      alignItems: 'center',
      paddingBottom: style.position === 'center' ? 0 : '28%',
    }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '90%',
        ...(style.background === 'card'
          ? { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 24, padding: '14px 30px' }
          : {}),
      }}>
        {lines[activeLine]?.map((w, i) => {
          const globalIdx = lines.slice(0, activeLine).reduce((a, l) => a + l.length, 0) + i;
          const isActive = globalIdx === active;
          const anim = wordAnimation(style, isActive, w.emphasized, Math.max(0, t - w.start), activeColor);
          const opacity = active === -1
            ? 1
            : interpolate(globalIdx, [active - 1, active], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <span key={globalIdx} style={{
              fontFamily: `${family}, Impact, sans-serif`, fontWeight: weight,
              fontSize: w.emphasized ? style.emphasisSize : style.fontSize,
              color: anim.color,
              transform: `scale(${anim.scale}) translateY(${anim.translateY}px)`,
              display: 'inline-block', margin: '0 10px',
              textTransform: style.uppercase ? 'uppercase' : 'none',
              letterSpacing: '0.02em',
              ...(style.strokeWidth > 0 ? { WebkitTextStroke: `${style.strokeWidth}px ${style.strokeColor}` } : {}),
              textShadow: `0 0 8px rgba(0,0,0,0.9), 3px 3px 6px rgba(0,0,0,1)${anim.extraShadow}`,
              opacity,
            }}>{w.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
