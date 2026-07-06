/**
 * Pre-export quality gates (v4 Part 5 §A.2). Each is a PURE function returning a GateResult:
 * pass | autofix(applied) | fail(reason). The audit runner (audit.ts) composes them. Gates
 * read outputs the pipeline already produces — arc status, caption cues, measured loudness,
 * duration, face samples + crop track — so Slice A adds no new perception.
 */
import { cueViolatesReadingSpeed, type CaptionCue, type CueConstraints } from '../captions/captionCues.js';
import { ReasonCode } from '../report/reasonCodes.js';
import type { CropKeyframe, FaceSample } from '../types/index.js';

export type GateOutcome =
  | { status: 'pass' }
  | { status: 'autofix'; note: string }
  | { status: 'fail'; reason: ReasonCode; detail: string };
export interface GateResult { gate: string; outcome: GateOutcome; }

export const SUBJECT_IN_FRAME_FLOOR = 0.8;
const LOUDNESS_TOLERANCE_LUFS = 1.0;

/** Arc completeness (from the existing 6/6 gate). undefined = arc stage didn't run → pass. */
export function narrativeGate(arc: { complete: boolean; missing: string[] } | undefined): GateResult {
  if (arc === undefined || arc.complete) return { gate: 'narrative', outcome: { status: 'pass' } };
  return {
    gate: 'narrative',
    outcome: { status: 'fail', reason: ReasonCode.DIRECTOR_NO_ARC_FOUND, detail: `missing: ${arc.missing.join(', ') || 'arc'}` },
  };
}

/** Caption cues fit the frame. Genuine LAYOUT overflow (too many lines / chars per line) is a
 *  hard fail — the text physically won't fit. Reading-speed over the ceiling is ADVISORY: we
 *  can't slow captions without desyncing from speech, and the viewer also hears the words, so
 *  it's flagged (autofix note) but does not block the clip. */
export function captionGate(cues: CaptionCue[], c: CueConstraints): GateResult {
  let fastCue = false;
  for (const cue of cues) {
    if (cue.lines.length > c.maxLines) {
      return { gate: 'caption', outcome: { status: 'fail', reason: ReasonCode.QUALITY_CAPTION_OVERFLOW, detail: `${cue.lines.length} lines > ${c.maxLines}` } };
    }
    if (cue.lines.some((l) => l.length > c.maxCharsPerLine)) {
      return { gate: 'caption', outcome: { status: 'fail', reason: ReasonCode.QUALITY_CAPTION_OVERFLOW, detail: `line > ${c.maxCharsPerLine} chars` } };
    }
    if (cueViolatesReadingSpeed(cue, c.maxReadingCps)) fastCue = true;
  }
  if (fastCue) {
    return { gate: 'caption', outcome: { status: 'autofix', note: `fast captions (> ${c.maxReadingCps} cps) — timing locked to speech, shipped as-is` } };
  }
  return { gate: 'caption', outcome: { status: 'pass' } };
}

/** Measured integrated loudness vs. target. null = never measured → gate error. */
export function audioGate(measuredLufs: number | null, targetLufs: number): GateResult {
  if (measuredLufs === null) {
    return { gate: 'audio', outcome: { status: 'fail', reason: ReasonCode.CF_AUDIT_GATE_ERROR, detail: 'loudness not measured' } };
  }
  if (Math.abs(measuredLufs - targetLufs) <= LOUDNESS_TOLERANCE_LUFS) {
    return { gate: 'audio', outcome: { status: 'pass' } };
  }
  return { gate: 'audio', outcome: { status: 'autofix', note: `normalized ${measuredLufs.toFixed(1)} → ${targetLufs} LUFS` } };
}

/** Duration within the mode envelope. */
export function durationGate(durationSec: number, min: number, max: number): GateResult {
  if (durationSec >= min && durationSec <= max) return { gate: 'duration', outcome: { status: 'pass' } };
  return { gate: 'duration', outcome: { status: 'fail', reason: ReasonCode.CF_AUDIT_GATE_ERROR, detail: `${durationSec.toFixed(1)}s outside [${min},${max}]` } };
}

function nearest<T extends { time: number }>(items: T[], t: number): T {
  return items.reduce((a, b) => (Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a));
}

/** Crop framing: the target face must sit inside the crop window for ≥ floor of samples.
 *  blur framing (null track) shows the whole frame → the subject is always in frame. */
export function subjectInFrameGate(faces: FaceSample[], cropTrack: CropKeyframe[] | null, floor: number): GateResult {
  if (cropTrack === null || cropTrack.length === 0) return { gate: 'subject_in_frame', outcome: { status: 'pass' } };
  const boxed = faces.filter((f) => f.box !== null);
  if (boxed.length === 0) return { gate: 'subject_in_frame', outcome: { status: 'pass' } };
  let covered = 0;
  for (const f of boxed) {
    const box = f.box!;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const k = nearest(cropTrack, f.time);
    if (Math.abs(cx - k.cx) <= k.cropW / 2 && Math.abs(cy - k.cy) <= k.cropH / 2) covered++;
  }
  const frac = covered / boxed.length;
  if (frac >= floor) return { gate: 'subject_in_frame', outcome: { status: 'pass' } };
  return {
    gate: 'subject_in_frame',
    outcome: { status: 'fail', reason: ReasonCode.QUALITY_SUBJECT_OUT_OF_FRAME, detail: `subject in frame ${(frac * 100).toFixed(0)}% < ${(floor * 100).toFixed(0)}%` },
  };
}
