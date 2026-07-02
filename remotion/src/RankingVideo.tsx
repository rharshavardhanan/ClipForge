import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Anton';
import { buildTimeline, type RankingProps } from './rankingLogic';

const { fontFamily } = loadFont();

/** Countdown interstitial: dark card, "#N" springs in, optional title below. */
const RankCard: React.FC<{ rank: number; title?: string; accentColor: string }> = ({ rank, title, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 160 } });
  const fadeOut = interpolate(frame, [durationInFrames - Math.round(0.25 * fps), durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{
      backgroundColor: 'black', justifyContent: 'center', alignItems: 'center', opacity: fadeOut,
      backgroundImage: `radial-gradient(circle at 50% 45%, ${accentColor}26 0%, transparent 60%)`,
    }}>
      {rank === 1 && (
        <div style={{ fontFamily: `${fontFamily}, Impact, sans-serif`, fontSize: 54, color: accentColor,
          textTransform: 'uppercase', letterSpacing: '0.25em', marginBottom: 24 }}>
          The #1 Moment
        </div>
      )}
      <div style={{
        fontFamily: `${fontFamily}, Impact, sans-serif`, fontSize: 300, lineHeight: 1, color: 'white',
        transform: `scale(${pop})`, textShadow: `0 0 60px ${accentColor}80`,
      }}>
        #{rank}
      </div>
      {title && (
        <div style={{ fontFamily: `${fontFamily}, Impact, sans-serif`, fontSize: 58, color: 'white', opacity: 0.92,
          textTransform: 'uppercase', textAlign: 'center', maxWidth: '82%', marginTop: 40,
          textShadow: '0 0 12px rgba(0,0,0,1)' }}>
          {title}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Persistent rank pill shown while a clip plays. */
const RankBadge: React.FC<{ rank: number; accentColor: string }> = ({ rank, accentColor }) => (
  <div style={{
    position: 'absolute', top: 48, left: 40, padding: '10px 30px', borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)', border: `3px solid ${accentColor}`,
    fontFamily: `${fontFamily}, Impact, sans-serif`, fontSize: 56, color: accentColor, lineHeight: 1.2,
  }}>
    #{rank}
  </div>
);

export const RankingVideo: React.FC<RankingProps> = ({ items, cardFrames, accentColor }) => {
  const segments = buildTimeline(items, cardFrames);
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {segments.map((seg) => {
        const item = items[seg.itemIndex];
        return (
          <Sequence key={`${seg.kind}_${seg.itemIndex}`} from={seg.from} durationInFrames={seg.durationInFrames}>
            {seg.kind === 'card'
              ? <RankCard rank={item.rank} title={item.title} accentColor={accentColor} />
              : (
                <AbsoluteFill>
                  <OffthreadVideo src={staticFile(item.videoPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <RankBadge rank={item.rank} accentColor={accentColor} />
                </AbsoluteFill>
              )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
