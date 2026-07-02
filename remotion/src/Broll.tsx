import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { brollOpacityAt, brollScaleAt, type BrollWindow } from './brollLogic';

/**
 * Narrative-overlay B-roll (v6): muted contextual footage covers the frame while the A-roll
 * underneath keeps playing (its audio continues seamlessly — the spec's "voice continues,
 * only the visual switches"). Sits above the base video, below hook card + captions.
 */
const BrollLayer: React.FC<{ window: BrollWindow }> = ({ window }) => {
  const local = useCurrentFrame(); // frame local to the enclosing <Sequence>
  return (
    <AbsoluteFill style={{ opacity: brollOpacityAt(local, window.durationInFrames), backgroundColor: 'black' }}>
      <OffthreadVideo
        src={staticFile(window.videoPath)}
        muted
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          transform: `scale(${brollScaleAt(local, window.durationInFrames)})`,
        }}
      />
    </AbsoluteFill>
  );
};

export const Broll: React.FC<{ windows: BrollWindow[] }> = ({ windows }) => (
  <>
    {windows.map((w, i) => (
      <Sequence key={i} from={w.from} durationInFrames={w.durationInFrames}>
        <BrollLayer window={w} />
      </Sequence>
    ))}
  </>
);
