import {
  AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame,
} from 'remotion';
import {
  type MontageCounterProp, type MontageFlashProp, type MontageProps, type MontageSegmentProp,
} from './montageLogic';

/** One montage cut — velocity ramp / freeze / zoom / shake, muted (music is the timeline master). */
const SegmentLayer: React.FC<{ segment: MontageSegmentProp }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const src = staticFile(segment.videoPath);
  const scale = segment.zoom
    ? interpolate(frame, [0, segment.durationInFrames], [1, 1.12], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 1;
  // Deterministic pseudo-noise (no Math.random — must stay identical across Remotion's
  // multi-threaded frame render).
  const shakeX = segment.shake ? Math.sin(frame * 12.9898) * 6 : 0;
  const shakeY = segment.shake ? Math.cos(frame * 78.233) * 6 : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: 'black', transform: `translate(${shakeX}px, ${shakeY}px) scale(${scale})` }}>
      {segment.freeze ? (
        <Freeze frame={segment.startFromFrames}>
          <OffthreadVideo muted src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Freeze>
      ) : (
        <OffthreadVideo
          muted
          src={src}
          startFrom={segment.startFromFrames}
          playbackRate={segment.playbackRate}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </AbsoluteFill>
  );
};

/** Full-frame flash/glitch overlay — one cut's worth of subliminal hit. */
const FlashLayer: React.FC<{ kind: MontageFlashProp['kind'] }> = ({ kind }) => {
  const frame = useCurrentFrame();
  if (kind === 'blur') {
    return <AbsoluteFill style={{ backdropFilter: 'blur(14px)' }} />;
  }
  if (kind === 'glitch') {
    const jitter = Math.sin(frame * 12.9898) * 2;
    return (
      <AbsoluteFill style={{ transform: `translateX(${jitter}px)` }}>
        <AbsoluteFill style={{ backgroundColor: '#FF1E56', opacity: 0.55, mixBlendMode: 'screen', transform: 'translateX(-6px)' }} />
        <AbsoluteFill style={{ backgroundColor: '#00E5FF', opacity: 0.55, mixBlendMode: 'screen', transform: 'translateX(6px)' }} />
      </AbsoluteFill>
    );
  }
  const solid = kind === 'white' ? '#FFFFFF' : kind === 'red' ? '#FF0000' : '#000000';
  return <AbsoluteFill style={{ backgroundColor: solid, opacity: 0.85 }} />;
};

/** PURE: the counter entry active at `frame` — largest `at` that is <= frame (none → null). */
function currentCounter(counter: MontageCounterProp[], frame: number): MontageCounterProp | null {
  let best: MontageCounterProp | null = null;
  for (const c of counter) {
    if (c.at <= frame && (best === null || c.at > best.at)) best = c;
  }
  return best;
}

/** PURE: pop-in scale for the counter value — 1.35 → 1 over the 6 frames after an increment. */
function counterPopScale(entry: MontageCounterProp, frame: number): number {
  const local = frame - entry.at;
  if (local < 0 || local >= 6) return 1;
  return 1.35 - (0.35 * local) / 6;
}

/** Top-center rep-counter overlay — label + big popping value, red glow to match the montagem preset. */
const CounterOverlay: React.FC<{ counter: MontageCounterProp[]; counterLabel: string }> = ({ counter, counterLabel }) => {
  const frame = useCurrentFrame();
  const current = currentCounter(counter, frame);
  if (!current) return null;
  const scale = counterPopScale(current, frame);
  return (
    <div style={{ position: 'absolute', top: 90, left: 0, right: 0, textAlign: 'center', zIndex: 40 }}>
      <div style={{
        fontFamily: 'Impact, Anton, sans-serif', fontSize: 42, fontWeight: 900, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: '#FFFFFF', textShadow: '0 0 18px #FF2E2E, 0 4px 0 #000',
      }}>
        {counterLabel}
      </div>
      <div style={{
        fontFamily: 'Impact, Anton, sans-serif', fontSize: 140, fontWeight: 900, lineHeight: 1,
        color: '#FFFFFF', textShadow: '0 0 18px #FF2E2E, 0 4px 0 #000', transform: `scale(${scale})`,
      }}>
        {current.value}
      </div>
    </div>
  );
};

export const MontageVideo: React.FC<MontageProps> = ({
  segments, flashes, counter, counterLabel, musicPath, musicVolume, musicStartFromFrames,
  payoffImagePath, payoffAtFrame,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <Audio src={staticFile(musicPath)} volume={musicVolume} startFrom={musicStartFromFrames} />

      {segments.map((segment, i) => (
        <Sequence key={i} from={segment.from} durationInFrames={segment.durationInFrames}>
          <SegmentLayer segment={segment} />
        </Sequence>
      ))}

      {payoffImagePath !== '' && (
        <Sequence from={payoffAtFrame}>
          <AbsoluteFill>
            <Img src={staticFile(payoffImagePath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
          <Sequence from={0} durationInFrames={4}>
            <FlashLayer kind="white" />
          </Sequence>
        </Sequence>
      )}

      {counter.length > 0 && <CounterOverlay counter={counter} counterLabel={counterLabel} />}

      {flashes.map((flash, i) => (
        <Sequence key={i} from={flash.at} durationInFrames={flash.frames}>
          <FlashLayer kind={flash.kind} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
