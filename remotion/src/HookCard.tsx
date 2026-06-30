import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const HookCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 0.2 * fps, 1.2 * fps, 1.5 * fps], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: '12%', opacity }}>
      <div style={{ fontFamily: 'Anton, Impact, sans-serif', fontSize: 64, color: 'white', textTransform: 'uppercase',
        textAlign: 'center', maxWidth: '85%', textShadow: '0 0 10px rgba(0,0,0,1)' }}>{text}</div>
    </AbsoluteFill>
  );
};
