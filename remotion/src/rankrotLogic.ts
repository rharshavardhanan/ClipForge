// RankRot countdown timeline — PURE, unit-tested. type aliases (not interfaces) so props
// satisfy Remotion's Record<string, unknown> constraint.

export type RankRotItem = {
  videoPath: string;        // relative to remotion/public (staticFile)
  rank: number;             // 5..1
  durationInFrames: number; // moment length at comp fps
  microTitle: string;       // meme caption ("BRO GOT COOKED")
  replay: boolean;          // elite clip → slow-mo replay after first play
  /** Source frame the replay starts from (slow-mo re-shows the PEAK, not the whole clip). */
  replayFrom?: number;
};

export type RankRotProps = {
  items: RankRotItem[];     // COUNTDOWN order: #N first … #1 last (never reveal #1 early)
  fps: number;
  topTitle: string;         // "RANKING BEST DUNKS"
  subtext: string;          // "(last one is insane)"
  accentColor: string;
};

export type RankRotSegment = {
  kind: 'card' | 'clip' | 'replay';
  itemIndex: number;
  from: number;
  durationInFrames: number;
};

export const CARD_FRAMES = 21;        // 0.7s @30 — rank stinger
export const FINAL_CARD_FRAMES = 33;  // #1 card holds longer (anticipation)
export const REPLAY_SPEED = 0.5;      // slow-mo replay rate
export const REPLAY_FRACTION = 0.6;   // replay covers up to 60% of the moment…
export const REPLAY_MAX_SRC_SEC = 3.5; // …but never more than ~3.5s of source (peak only)

/** PURE: source frames a replay re-shows (60% of the moment, capped at 3.5s of source). */
export function replaySrcFrames(clipDurationInFrames: number, fps: number): number {
  return Math.max(1, Math.round(Math.min(clipDurationInFrames * REPLAY_FRACTION, REPLAY_MAX_SRC_SEC * fps)));
}
export const SHAKE_FRAMES = 8;        // camera-shake jitter at each clip start
export const PUNCH_IN_FRAMES = 10;    // punch-in ease at each clip start

/** Word palette for the multi-color brainrot top title. */
export const TITLE_PALETTE = ['#FFE81A', '#FF3D5A', '#41FF6B', '#4DC9FF', '#FF9838'];

/** PURE: card → clip → (replay for elite clips), per item, countdown order.
 *  fps only affects the replay source cap (defaults to the 30fps comp). */
export function buildRankRotTimeline(items: RankRotItem[], fps = 30): RankRotSegment[] {
  const segs: RankRotSegment[] = [];
  let from = 0;
  items.forEach((item, itemIndex) => {
    const isFinal = itemIndex === items.length - 1;
    const card = isFinal ? FINAL_CARD_FRAMES : CARD_FRAMES;
    segs.push({ kind: 'card', itemIndex, from, durationInFrames: card });
    from += card;
    segs.push({ kind: 'clip', itemIndex, from, durationInFrames: item.durationInFrames });
    from += item.durationInFrames;
    if (item.replay) {
      const dur = Math.max(1, Math.round(replaySrcFrames(item.durationInFrames, fps) / REPLAY_SPEED));
      segs.push({ kind: 'replay', itemIndex, from, durationInFrames: dur });
      from += dur;
    }
  });
  return segs;
}

export function totalRankRotFrames(items: RankRotItem[]): number {
  const segs = buildRankRotTimeline(items);
  const last = segs[segs.length - 1];
  return Math.max(1, last ? last.from + last.durationInFrames : 1);
}

/** PURE: rank-rail state at a frame — which ranks are done, which is live. */
export function railState(items: RankRotItem[], segments: RankRotSegment[], frame: number): {
  activeRank: number | null; doneRanks: number[];
} {
  let activeIdx: number | null = null;
  for (const s of segments) {
    if (frame >= s.from && frame < s.from + s.durationInFrames) { activeIdx = s.itemIndex; break; }
  }
  if (activeIdx === null && segments.length > 0 && frame >= segments[segments.length - 1].from) {
    activeIdx = items.length - 1; // past the end: everything done, keep #1 lit
  }
  const doneRanks = items.filter((_, i) => activeIdx !== null && i < activeIdx).map((it) => it.rank);
  return { activeRank: activeIdx !== null ? items[activeIdx].rank : null, doneRanks };
}

/** PURE: deterministic camera-shake offset for the first SHAKE_FRAMES of a clip. */
export function shakeOffset(localFrame: number, seed: number): { x: number; y: number } {
  if (localFrame >= SHAKE_FRAMES || localFrame < 0) return { x: 0, y: 0 };
  const decay = 1 - localFrame / SHAKE_FRAMES;
  const x = Math.sin((localFrame + seed) * 12.9898) * 10 * decay;
  const y = Math.cos((localFrame + seed * 3) * 78.233) * 8 * decay;
  return { x: +x.toFixed(2), y: +y.toFixed(2) };
}

/** PURE: punch-in scale at a clip's local frame (1.12 → 1 over PUNCH_IN_FRAMES). */
export function punchInScale(localFrame: number): number {
  if (localFrame >= PUNCH_IN_FRAMES || localFrame < 0) return 1;
  return +(1.12 - (0.12 * localFrame) / PUNCH_IN_FRAMES).toFixed(4);
}

/**
 * PURE: SFX mirror for the node-side mixer (same contract as punchZoom↔sfx/events —
 * timing here MUST mirror buildRankRotTimeline). Seconds at the given fps:
 * whoosh at every card, impact at every clip start, riser at the #1 card,
 * bass drop at the #1 clip start.
 */
export function rankrotSfxSeconds(items: RankRotItem[], fps: number): {
  whooshes: number[]; impacts: number[]; riser: number | null; bass: number | null;
} {
  const segs = buildRankRotTimeline(items);
  const lastIdx = items.length - 1;
  const whooshes: number[] = [];
  const impacts: number[] = [];
  let riser: number | null = null;
  let bass: number | null = null;
  for (const s of segs) {
    const t = +(s.from / fps).toFixed(3);
    if (s.kind === 'card') {
      whooshes.push(t);
      if (s.itemIndex === lastIdx) riser = t;
    } else if (s.kind === 'clip') {
      impacts.push(t);
      if (s.itemIndex === lastIdx) bass = t;
    }
  }
  return { whooshes, impacts, riser, bass };
}
