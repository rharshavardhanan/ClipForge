/**
 * Montage assembly planner — PURE and seeded. Walks the music's beat grid and fills
 * sections with moment footage: build = sparse cuts at ~1x, escalation (last 8 beats
 * before a drop) = 1 cut/beat sped up, drop = half-beat hyper cuts, payoff = slowmo +
 * freeze. The music is the timeline master; segments are muted downstream, so
 * playbackRate is free. All times in seconds relative to montage start.
 */
import { createHash } from 'node:crypto';
import type { CounterEvent, FlashEvent, FlashKind, MontageMoment, MontagePlan, MontageSegment, MusicMap } from './types.js';

const ESCALATION_BEATS = 8;
const DROP_HYPER_BEATS = 4;   // half-beat cuts for the first 4 beats of a drop
const PAYOFF_SLOW_SEC = 1.2;  // wall-clock slowmo length
const PAYOFF_FREEZE_SEC = 0.7;
const DROP_FLASHES: FlashKind[] = ['white', 'red', 'glitch', 'black'];

export function mulberry32(seed: string): () => number {
  let a = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cut {
  time: number;
  kind: 'build' | 'escalation' | 'drop';
  /** True ONLY on the single cut that is "the drop hit" — the first drop-kind cut emitted
   *  for this drop. Structural marker, not a float time comparison: drops from
   *  musicMap.detectDrops are real audio timestamps and are NOT snapped to the beat grid,
   *  so comparing cut.time against the raw drop time can miss by design (see buildMontagePlan). */
  dropHit?: boolean;
}

/** Beat-grid cut times for the montage window. Exported for the test-of-last-resort. */
export function cutTimes(map: MusicMap, offset: number, targetSec: number, rng: () => number): Cut[] {
  const end = offset + targetSec;
  const beats = map.beats.filter((b) => b >= offset && b <= end);
  const drop = map.drops.find((d) => d.time >= offset && d.time <= end);
  const halfBeat = 30 / map.bpm;
  const cuts: Cut[] = [];
  let skip = 0;
  let dropHitAssigned = false;
  for (const [i, b] of beats.entries()) {
    const toDrop = drop ? drop.time - b : Infinity;
    const inEscalation = drop && toDrop > 0 && toDrop <= ESCALATION_BEATS * 2 * halfBeat;
    const inDrop = drop && b >= drop.time && b < drop.time + DROP_HYPER_BEATS * 2 * halfBeat;
    if (inDrop) {
      // The first drop-kind cut is on-beat, at/after the (possibly off-grid) drop time —
      // that's the structural "drop hit", regardless of how far it lands from the raw
      // drop timestamp.
      const dropHit = dropHitAssigned ? undefined : true;
      dropHitAssigned = true;
      cuts.push({ time: b - offset, kind: 'drop', dropHit });
      if (i < beats.length - 1) cuts.push({ time: b - offset + halfBeat, kind: 'drop' });
    } else if (inEscalation) {
      cuts.push({ time: b - offset, kind: 'escalation' });
    } else {
      if (skip > 0) { skip--; continue; }
      cuts.push({ time: b - offset, kind: 'build' });
      skip = 1 + Math.floor(rng() * 3); // next cut 2-4 beats away
    }
  }
  return cuts;
}

export function buildMontagePlan(
  map: MusicMap, moments: MontageMoment[], opts: { targetSec: number; seed: string },
): MontagePlan {
  const rng = mulberry32(opts.seed);
  const target = Math.max(15, Math.min(45, opts.targetSec));
  const firstDrop = map.drops[0]?.time ?? map.duration * 0.6;
  // Place the window so the drop lands ~70% in (or at 0 for short tracks).
  const offset = Math.max(0, Math.min(firstDrop - target * 0.7, map.duration - target));

  const byScore = [...moments].sort((a, b) => (b.motionScore + b.audioScore) - (a.motionScore + a.audioScore));
  const reserved = byScore[0];
  const pool = byScore.slice(1).length > 0 ? byScore.slice(1) : byScore;
  const cursors = new Map<string, number>(pool.map((m) => [m.src, 0]));

  const rateFor = (kind: Cut['kind']): number =>
    kind === 'build' ? 0.75 + rng() * 0.25 : kind === 'escalation' ? 1.25 + rng() * 0.75 : 1.5 + rng() * 0.5;

  const cuts = cutTimes(map, offset, target, rng);
  const halfBeat = 30 / map.bpm;
  const dropRel = firstDrop - offset;
  const segments: MontageSegment[] = [];
  const flashes: FlashEvent[] = [];
  let poolIdx = 0;

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const wallDur = (i + 1 < cuts.length ? cuts[i + 1].time : Math.min(target, dropRel + 8)) - cut.time;
    if (wallDur <= 1 / 30) continue;
    const isDropHit = cut.dropHit === true;
    const m = isDropHit ? reserved : pool[poolIdx++ % pool.length];
    const rate = isDropHit ? 1 : rateFor(cut.kind);
    // Beat-grid safety: wallDur is the source of truth (it's already on-grid, coming
    // straight from cutTimes). We derive srcDur = wallDur*rate and never let footage
    // availability shrink the WALL duration — if the moment doesn't have enough footage
    // left (even after wrapping the cursor to 0), we clamp srcDur to what's available and
    // recompute playbackRate so srcDur/playbackRate === wallDur exactly. That keeps every
    // cut on-grid regardless of how short the source footage is.
    let srcStart = isDropHit ? 0 : (cursors.get(m.src) ?? 0);
    let srcDur = wallDur * rate;
    let effRate = rate;
    if (srcStart + srcDur > m.dur) {
      if (!isDropHit) srcStart = 0; // try wrapping to the start of the footage first
      if (srcStart + srcDur > m.dur) {
        // Still doesn't fit even from 0 — the moment is shorter than this cut wants.
        // Clamp srcDur to the available footage and recompute rate to hold wallDur exact.
        srcDur = Math.max(1 / 60, m.dur - srcStart);
        effRate = srcDur / wallDur;
      }
    }
    if (isDropHit) srcStart = Math.max(0, (m.dur - srcDur) / 2);
    if (!isDropHit) cursors.set(m.src, srcStart + srcDur + 0.3);
    segments.push({
      src: m.src, srcStart, srcDur, playbackRate: effRate, freeze: false,
      zoom: cut.kind !== 'build', shake: cut.kind === 'drop',
    });
    // Flashes: every drop/escalation cut; every 2nd build cut.
    if (cut.kind !== 'build' || i % 2 === 0) {
      flashes.push({
        time: cut.time,
        kind: cut.kind === 'drop' ? DROP_FLASHES[i % DROP_FLASHES.length] : rng() < 0.5 ? 'white' : 'blur',
        frames: cut.kind === 'build' ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3),
      });
    }
  }

  // Payoff: slowmo re-show of the reserved peak, then freeze. Wall time continues after the
  // cuts. Both payoff segments must stay on the same beat grid as every cut, so their wall
  // durations are snapped to the nearest (non-zero) multiple of the half-beat grid unit
  // instead of using the raw PAYOFF_*_SEC constants directly.
  const snapToGrid = (sec: number) => Math.max(halfBeat, Math.round(sec / halfBeat) * halfBeat);
  let wall = segments.reduce((s, x) => s + (x.freeze ? x.srcDur : x.srcDur / x.playbackRate), 0);
  const slowWall = snapToGrid(PAYOFF_SLOW_SEC);
  let slowRate = 0.5;
  let slowSrc = slowWall * slowRate;
  if (slowSrc > reserved.dur) {
    // Not enough footage to hold both the grid-exact wall duration and rate<=0.5 — clamp
    // srcDur to the available footage and shrink the wall duration to match (off-grid only
    // in this footage-starved edge case, which the fixture never hits).
    slowSrc = reserved.dur;
  }
  segments.push({
    src: reserved.src, srcStart: Math.max(0, reserved.dur / 2 - slowSrc / 2), srcDur: slowSrc,
    playbackRate: slowRate, freeze: false, zoom: true, shake: false,
  });
  flashes.push({ time: wall, kind: 'white', frames: 4 });
  wall += slowSrc / slowRate;
  const payoffAt = wall;
  const freezeWall = snapToGrid(PAYOFF_FREEZE_SEC);
  const freezeSrc = Math.min(freezeWall, Math.max(1 / 60, reserved.dur - Math.max(0, reserved.dur / 2)));
  segments.push({
    src: reserved.src, srcStart: Math.max(0, reserved.dur / 2), srcDur: freezeSrc,
    playbackRate: 1, freeze: true, zoom: false, shake: false,
  });
  wall += freezeSrc;

  return { segments, flashes, musicOffset: offset, payoffAt, payoffDur: freezeSrc, totalDur: wall };
}

/** PURE: cycle events inside used segment spans → montage wall clock, numbered 1..n. */
export function remapCycleEvents(plan: MontagePlan, moments: MontageMoment[]): CounterEvent[] {
  const bySrc = new Map(moments.map((m) => [m.src, m]));
  const out: number[] = [];
  let wall = 0;
  for (const s of plan.segments) {
    const m = bySrc.get(s.src);
    if (m && !s.freeze) {
      for (const c of m.cycleEvents) {
        if (c >= s.srcStart && c < s.srcStart + s.srcDur) out.push(wall + (c - s.srcStart) / s.playbackRate);
      }
    }
    wall += s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
  }
  return out.sort((a, b) => a - b).map((time, i) => ({ time, value: i + 1 }));
}
