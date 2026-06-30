import type { ActiveSample, FaceBox, FaceObs, FrameObs, Track, TrackSample } from '../types/index.js';

/** A single 2D landmark point (pixel coords in the detected frame). */
export interface LandmarkPoint { x: number; y: number; }

// Standard iBUG 68-point mouth indices: 48-59 outer lip, 60-67 inner lip.
const MOUTH_LEFT_CORNER = 48;
const MOUTH_RIGHT_CORNER = 54;
const INNER_TOP_LIP = 62; // inner upper lip, center
const INNER_BOTTOM_LIP = 66; // inner lower lip, center

/**
 * Mouth openness from 68-pt facial landmarks: inner-lip vertical gap
 * normalized by mouth width (corner-to-corner), so it's scale-invariant
 * across face sizes/distances. PURE.
 *
 * Returns 0 for a degenerate/zero-width mouth (e.g. malformed landmarks).
 */
export function mouthOpenness(landmarks: LandmarkPoint[]): number {
  if (!landmarks || landmarks.length < 68) return 0;

  const left = landmarks[MOUTH_LEFT_CORNER];
  const right = landmarks[MOUTH_RIGHT_CORNER];
  const top = landmarks[INNER_TOP_LIP];
  const bottom = landmarks[INNER_BOTTOM_LIP];

  const mouthWidth = Math.hypot(right.x - left.x, right.y - left.y);
  if (mouthWidth === 0) return 0;

  const gap = Math.hypot(bottom.x - top.x, bottom.y - top.y);
  return gap / mouthWidth;
}

function boxCenter(box: FaceBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function centerDist(a: FaceBox, b: FaceBox): number {
  const ca = boxCenter(a);
  const cb = boxCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/**
 * Greedy nearest-center matching of faces across consecutive frames into
 * stable tracks. A face with no match within `maxCenterDist` of any track's
 * last-seen box starts a new track. PURE.
 */
export function associateTracks(frames: FrameObs[], maxCenterDist: number): Track[] {
  const tracks: Track[] = [];
  // last known box per track, by track index (parallel to `tracks`)
  const lastBox: FaceBox[] = [];
  let nextId = 0;

  for (const frame of frames) {
    // Candidate (track, face) pairs within range, sorted by distance for greedy matching.
    const candidates: { trackIdx: number; faceIdx: number; dist: number }[] = [];
    for (let t = 0; t < tracks.length; t++) {
      for (let f = 0; f < frame.faces.length; f++) {
        const dist = centerDist(lastBox[t], frame.faces[f].box);
        if (dist <= maxCenterDist) {
          candidates.push({ trackIdx: t, faceIdx: f, dist });
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    const matchedTrack = new Set<number>();
    const matchedFace = new Set<number>();
    for (const c of candidates) {
      if (matchedTrack.has(c.trackIdx) || matchedFace.has(c.faceIdx)) continue;
      matchedTrack.add(c.trackIdx);
      matchedFace.add(c.faceIdx);
      const obs = frame.faces[c.faceIdx];
      tracks[c.trackIdx].samples.push({ time: frame.time, box: obs.box, mouthOpenness: obs.mouthOpenness });
      lastBox[c.trackIdx] = obs.box;
    }

    // Unmatched faces start new tracks.
    for (let f = 0; f < frame.faces.length; f++) {
      if (matchedFace.has(f)) continue;
      const obs = frame.faces[f];
      const sample: TrackSample = { time: frame.time, box: obs.box, mouthOpenness: obs.mouthOpenness };
      tracks.push({ id: nextId++, samples: [sample] });
      lastBox.push(obs.box);
    }
  }

  return tracks;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Mouth-movement (std-dev of mouthOpenness) for a track within ±windowSec of `time`. */
function trackMovementAt(track: Track, time: number, windowSec: number): number {
  const inWindow = track.samples.filter((s) => Math.abs(s.time - time) <= windowSec);
  if (inWindow.length === 0) return 0;
  return stddev(inWindow.map((s) => s.mouthOpenness));
}

/** Box for a track at/near `time` (nearest sample), or null if the track has no samples. */
function trackBoxAt(track: Track, time: number): FaceBox | null {
  if (track.samples.length === 0) return null;
  let best = track.samples[0];
  let bestDist = Math.abs(best.time - time);
  for (const s of track.samples) {
    const d = Math.abs(s.time - time);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best.box;
}

/** Whether `track` has a sample at exactly `time` (i.e. is "present" in that frame). */
function trackPresentAt(track: Track, time: number): boolean {
  return track.samples.some((s) => s.time === time);
}

export interface PickActiveSpeakerOpts {
  windowSec?: number;
  minDwellSec?: number;
  /** Challenger must be at least this multiple of the current speaker's movement to be eligible to switch. */
  switchRatio?: number;
}

/**
 * Picks the active speaker per sampled frame time from a set of tracks.
 * Among tracks present at a given time, the one with the highest recent
 * mouth-movement (std-dev of mouthOpenness in a ±windowSec window) wins —
 * subject to switch hysteresis: the incumbent is kept unless a challenger is
 * clearly more active (>= switchRatio x) for a sustained >= minDwellSec
 * stretch. Gap-fill: no faces at a time -> box=null (caller holds last).
 * Single-track input -> that track is always active when present. PURE.
 */
export function pickActiveSpeaker(
  frames: FrameObs[],
  tracks: Track[],
  opts: PickActiveSpeakerOpts = {},
): ActiveSample[] {
  const windowSec = opts.windowSec ?? 0.75;
  const minDwellSec = opts.minDwellSec ?? 0.5;
  const switchRatio = opts.switchRatio ?? 1.5;

  const result: ActiveSample[] = [];
  let currentTrackId: number | null = null;
  // Tracks the time at which the current challenger started clearly leading, per track id.
  let challengerSince: Map<number, number> = new Map();

  for (const frame of frames) {
    const presentTracks = tracks.filter((t) => trackPresentAt(t, frame.time));

    if (presentTracks.length === 0) {
      result.push({ time: frame.time, box: null });
      // Don't reset currentTrackId — if the speaker reappears, hysteresis context persists.
      continue;
    }

    if (presentTracks.length === 1) {
      currentTrackId = presentTracks[0].id;
      challengerSince = new Map();
      result.push({ time: frame.time, box: trackBoxAt(presentTracks[0], frame.time) });
      continue;
    }

    const movement = new Map<number, number>();
    for (const t of presentTracks) {
      movement.set(t.id, trackMovementAt(t, frame.time, windowSec));
    }

    // No incumbent yet (first multi-track frame): pick the most active track outright.
    if (currentTrackId === null || !presentTracks.some((t) => t.id === currentTrackId)) {
      let best = presentTracks[0];
      for (const t of presentTracks) {
        if ((movement.get(t.id) ?? 0) > (movement.get(best.id) ?? 0)) best = t;
      }
      currentTrackId = best.id;
      challengerSince = new Map();
      result.push({ time: frame.time, box: trackBoxAt(best, frame.time) });
      continue;
    }

    const currentMovement = movement.get(currentTrackId) ?? 0;
    let switched = false;

    for (const t of presentTracks) {
      if (t.id === currentTrackId) continue;
      const challengerMovement = movement.get(t.id) ?? 0;
      const isClearlyMoreActive =
        challengerMovement >= currentMovement * switchRatio && challengerMovement > 0;

      if (!isClearlyMoreActive) {
        challengerSince.delete(t.id);
        continue;
      }

      if (!challengerSince.has(t.id)) {
        challengerSince.set(t.id, frame.time);
      }
      const leadingDuration = frame.time - challengerSince.get(t.id)!;
      if (leadingDuration >= minDwellSec) {
        currentTrackId = t.id;
        challengerSince = new Map();
        switched = true;
        break;
      }
    }

    if (!switched) {
      // Clear challenger state for tracks that are no longer clear challengers
      // (already handled above); keep current speaker.
    }

    const activeTrack = presentTracks.find((t) => t.id === currentTrackId)!;
    result.push({ time: frame.time, box: trackBoxAt(activeTrack, frame.time) });
  }

  return result;
}
