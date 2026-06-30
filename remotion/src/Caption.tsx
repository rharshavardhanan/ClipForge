import { useCurrentFrame, useVideoConfig, interpolate, AbsoluteFill } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Anton';
import { groupIntoLines, findActiveIndex, visibleLineIndex, type CaptionWord } from './captionLogic';

const { fontFamily } = loadFont();

export const CaptionTrack: React.FC<{ words: CaptionWord[]; accentColor: string }> = ({ words, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const active = findActiveIndex(words, t, 50);
  const lines = groupIntoLines(words, 4);
  const activeLine = visibleLineIndex(words, 4, t, 50);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '28%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '90%' }}>
        {lines[activeLine]?.map((w, i) => {
          const globalIdx = lines.slice(0, activeLine).reduce((a, l) => a + l.length, 0) + i;
          const isActive = globalIdx === active;
          const scale = isActive ? (w.emphasized ? 1.4 : 1.2) : 1;
          const opacity = active === -1
            ? 1
            : interpolate(globalIdx, [active - 1, active], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <span key={globalIdx} style={{
              fontFamily, fontSize: w.emphasized ? 84 : 70, color: isActive ? accentColor : 'white',
              transform: `scale(${scale})`, display: 'inline-block', margin: '0 10px',
              textTransform: 'uppercase', letterSpacing: '0.02em',
              textShadow: '0 0 8px rgba(0,0,0,0.9), 3px 3px 6px rgba(0,0,0,1)',
              opacity,
            }}>{w.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
