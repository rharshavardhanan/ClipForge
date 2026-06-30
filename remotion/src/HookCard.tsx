import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Anton';

const { fontFamily } = loadFont();

export const HookCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 0.2 * fps, 1.2 * fps, 1.5 * fps], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: '12%', opacity }}>
      <div style={{ fontFamily: `${fontFamily}, Impact, sans-serif`, fontSize: 64, color: 'white', textTransform: 'uppercase',
        textAlign: 'center', maxWidth: '85%', textShadow: '0 0 10px rgba(0,0,0,1)' }}>{text}</div>
    </AbsoluteFill>
  );
};
