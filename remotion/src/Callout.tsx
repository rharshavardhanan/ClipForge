import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export type CalloutSpec = { time: number; x: number; y: number };

const VISIBLE_SEC = 1.4;
const ARROW_H = 150; // arrow tip sits this far above the target point

/** One bouncing arrow pointing down at (x, y), popping in at `time` for ~1.4s. */
const Arrow: React.FC<{ c: CalloutSpec; accent: string }> = ({ c, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < c.time || t > c.time + VISIBLE_SEC) return null;

  const local = frame - Math.round(c.time * fps);
  const pop = spring({ frame: local, fps, config: { damping: 10, stiffness: 160, mass: 0.6 } });
  const fadeOut = t > c.time + VISIBLE_SEC - 0.25 ? (c.time + VISIBLE_SEC - t) / 0.25 : 1;
  const bob = Math.sin((t - c.time) * 9) * 14;

  return (
    <div
      style={{
        position: 'absolute',
        left: c.x,
        top: c.y - ARROW_H + bob,
        transform: `translate(-50%, -100%) scale(${pop})`,
        transformOrigin: '50% 100%',
        opacity: fadeOut,
      }}
    >
      <svg width="120" height="150" viewBox="0 0 120 150">
        {/* down-arrow: shaft + big head, accent fill with white + black outline */}
        <path
          d="M45 5 h30 v70 h30 L60 145 L15 75 h30 Z"
          fill={accent}
          stroke="white"
          strokeWidth="9"
          strokeLinejoin="round"
          paintOrder="stroke fill"
          style={{ filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.7))' }}
        />
      </svg>
    </div>
  );
};

export const Callouts: React.FC<{ callouts: CalloutSpec[]; accent: string }> = ({ callouts, accent }) => (
  <AbsoluteFill style={{ pointerEvents: 'none' }}>
    {callouts.map((c, i) => <Arrow key={i} c={c} accent={accent} />)}
  </AbsoluteFill>
);
