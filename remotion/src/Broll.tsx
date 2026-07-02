import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { brollOpacityAt, brollScaleAt, type BrollWindow } from './brollLogic';

/**
 * Narrative-overlay B-roll (v6): muted contextual footage covers the frame while the A-roll
 * underneath keeps playing (its audio continues seamlessly — the spec's "voice continues,
 * only the visual switches"). Sits above the base video, below hook card + captions.
 */
const BrollLayer: React.FC<{ window: BrollWindow }> = ({ window }) => {
  const local = useCurrentFrame(); // frame local to the enclosing <Sequence>
  const src = staticFile(window.videoPath);
  return (
    <AbsoluteFill style={{ opacity: brollOpacityAt(local, window.durationInFrames), backgroundColor: 'black' }}>
      {/* B-roll is usually 16:9 — cover-cropping it into 9:16 amputates ~2/3 of the frame
          (logos/faces cut off). Frame it like the A-roll blur mode instead: blurred cover
          backdrop + the real footage contained at full width, Ken Burns on the foreground. */}
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(24px) brightness(0.5)', transform: 'scale(1.18)' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${brollScaleAt(local, window.durationInFrames)})` }}>
        <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </AbsoluteFill>
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
