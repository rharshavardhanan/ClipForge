import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import {
  buildRankRotTimeline, railState, shakeOffset, punchInScale,
  TITLE_PALETTE, type RankRotItem, type RankRotProps, type RankRotSegment,
} from './rankrotLogic';

/** Multi-color bold brainrot title — each word cycles the palette, heavy black stroke. */
const BrainrotTitle: React.FC<{ title: string; subtext: string }> = ({ title, subtext }) => (
  <div style={{ position: 'absolute', top: 64, left: 0, right: 0, textAlign: 'center', zIndex: 30 }}>
    <div style={{ fontFamily: 'Impact, Anton, sans-serif', fontSize: 78, lineHeight: 1.05, letterSpacing: 1 }}>
      {title.split(' ').map((w, i) => (
        <span key={i} style={{
          color: TITLE_PALETTE[i % TITLE_PALETTE.length],
          WebkitTextStroke: '10px black', paintOrder: 'stroke fill', marginRight: 18,
        }}>{w}</span>
      ))}
    </div>
    <div style={{
      marginTop: 10, fontFamily: 'Impact, Anton, sans-serif', fontSize: 40, color: '#FFFFFF',
      WebkitTextStroke: '7px black', paintOrder: 'stroke fill',
    }}>{subtext}</div>
  </div>
);

/** Left rank rail 1..N — pending dim, active pulsing accent, done filled. */
const RankRail: React.FC<{ items: RankRotItem[]; segments: RankRotSegment[]; accent: string }> = ({ items, segments, accent }) => {
  const frame = useCurrentFrame();
  const { activeRank, doneRanks } = railState(items, segments, frame);
  const ranks = [...items.map((i) => i.rank)].sort((a, b) => a - b);
  const pulse = 1 + 0.08 * Math.sin(frame / 3);
  return (
    <div style={{ position: 'absolute', left: 26, top: 320, display: 'flex', flexDirection: 'column', gap: 18, zIndex: 30 }}>
      {ranks.map((r) => {
        const done = doneRanks.includes(r);
        const active = activeRank === r;
        return (
          <div key={r} style={{
            width: 92, height: 92, borderRadius: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Impact, Anton, sans-serif', fontSize: 52,
            color: active ? '#000' : done ? '#000' : '#FFF',
            backgroundColor: active ? accent : done ? '#FFFFFF' : 'rgba(0,0,0,0.55)',
            border: `5px solid ${active ? '#000' : 'rgba(255,255,255,0.85)'}`,
            transform: active ? `scale(${pulse})` : undefined,
            opacity: done || active ? 1 : 0.65,
          }}>{r}.</div>
        );
      })}
    </div>
  );
};

/** One clip (or its slow-mo replay) — blur-backdrop framing, shake + punch-in, micro title. */
const ClipLayer: React.FC<{ item: RankRotItem; replay: boolean; accent: string }> = ({ item, replay, accent }) => {
  const local = useCurrentFrame();
  const src = staticFile(item.videoPath);
  const shake = replay ? { x: 0, y: 0 } : shakeOffset(local, item.rank * 7);
  const scale = replay ? 1 + Math.min(0.15, local * 0.002) : punchInScale(local);
  const microIn = Math.min(1, local / 6);
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(26px) brightness(0.5)', transform: 'scale(1.18)' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px) scale(${scale})` }}>
        <OffthreadVideo
          src={src}
          muted={replay}
          playbackRate={replay ? 0.5 : 1}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </AbsoluteFill>
      {replay && (
        <div style={{
          position: 'absolute', top: 250, right: 34, zIndex: 25, fontFamily: 'Impact, Anton, sans-serif',
          fontSize: 44, color: accent, WebkitTextStroke: '7px black', paintOrder: 'stroke fill',
          transform: `rotate(6deg)`,
        }}>REPLAY 🔁</div>
      )}
      <div style={{
        position: 'absolute', bottom: 430, left: 0, right: 0, textAlign: 'center', zIndex: 25,
        transform: `scale(${0.5 + 0.5 * microIn})`, opacity: microIn,
      }}>
        <span style={{
          fontFamily: 'Impact, Anton, sans-serif', fontSize: 84, color: '#FFFFFF',
          WebkitTextStroke: '12px black', paintOrder: 'stroke fill',
        }}>{item.microTitle}</span>
      </div>
    </AbsoluteFill>
  );
};

/** Rank stinger card — huge #N slam. */
const RankCardStinger: React.FC<{ rank: number; accent: string; final: boolean }> = ({ rank, accent, final }) => {
  const local = useCurrentFrame();
  const scale = Math.min(1, 0.4 + local * 0.12);
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B0B0E', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        fontFamily: 'Impact, Anton, sans-serif', fontSize: final ? 380 : 320,
        color: final ? accent : '#FFFFFF', WebkitTextStroke: '16px black', paintOrder: 'stroke fill',
        transform: `scale(${scale}) rotate(${final ? -4 : 3}deg)`,
      }}>#{rank}</div>
      {final && (
        <div style={{ fontFamily: 'Impact, Anton, sans-serif', fontSize: 56, color: '#FFF', WebkitTextStroke: '8px black', paintOrder: 'stroke fill', marginTop: 8 }}>
          THIS ONE IS INSANE
        </div>
      )}
    </AbsoluteFill>
  );
};

export const RankRotVideo: React.FC<RankRotProps> = ({ items, topTitle, subtext, accentColor }) => {
  const segments = buildRankRotTimeline(items);
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {segments.map((seg, i) => {
        const item = items[seg.itemIndex];
        const final = seg.itemIndex === items.length - 1;
        return (
          <Sequence key={i} from={seg.from} durationInFrames={seg.durationInFrames}>
            {seg.kind === 'card'
              ? <RankCardStinger rank={item.rank} accent={accentColor} final={final} />
              : <ClipLayer item={item} replay={seg.kind === 'replay'} accent={accentColor} />}
          </Sequence>
        );
      })}
      <BrainrotTitle title={topTitle} subtext={subtext} />
      <RankRail items={items} segments={segments} accent={accentColor} />
    </AbsoluteFill>
  );
};
