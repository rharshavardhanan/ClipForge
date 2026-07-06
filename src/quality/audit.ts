/**
 * Pre-export audit runner (v4 Part 5 §A). Composes the pure gates into one ClipQuality per
 * clip: which gates passed/autofixed/failed, whether the clip is degraded (shipped but
 * compromised), and every reason code surfaced (gate fails + autofixes + upstream fallbacks
 * gathered during render). NEVER throws into the render path — a gate that throws is caught
 * and recorded as CF_AUDIT_GATE_ERROR. In Slice A the audit is advisory (records, doesn't
 * block); a later slice flips it to hard-gating once every gate is trustworthy.
 */
import type { CaptionCue, CueConstraints } from '../captions/captionCues.js';
import { ReasonCode } from '../report/reasonCodes.js';
import type { CropKeyframe, FaceSample } from '../types/index.js';
import {
  narrativeGate, captionGate, audioGate, durationGate, subjectInFrameGate,
  type GateResult,
} from './gates.js';

export interface ClipQuality {
  gates: GateResult[];
  passed: boolean;
  degraded: boolean;
  degradations: ReasonCode[];
  reasonCodes: ReasonCode[];
}

/** Reason codes that mean "we shipped it but it's compromised" (vs. a hard fail). */
const DEGRADATION_CODES = new Set<ReasonCode>([
  ReasonCode.FRAMING_FALLBACK_CENTER_CROP,
  ReasonCode.FRAMING_LOW_TRACK_CONFIDENCE,
  ReasonCode.ASR_LOW_CONFIDENCE_SEGMENT,
  ReasonCode.CF_BELOW_RETENTION_FLOOR,
  ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED,
]);

export function runAudit(args: {
  arc: { complete: boolean; missing: string[] } | undefined;
  cues: CaptionCue[];
  cueConstraints: CueConstraints;
  measuredLufs: number | null;
  targetLufs: number;
  durationSec: number;
  lenMin: number;
  lenMax: number;
  faces: FaceSample[];
  cropTrack: CropKeyframe[] | null;
  subjectFloor: number;
  upstreamReasons: ReasonCode[];
}): ClipQuality {
  const gates: GateResult[] = [];
  const reasonCodes: ReasonCode[] = [...args.upstreamReasons];

  const runGate = (fn: () => GateResult) => {
    try {
      const r = fn();
      gates.push(r);
      if (r.outcome.status === 'fail') reasonCodes.push(r.outcome.reason);
      // Only the audio gate autofixes in Slice A (loudness normalization); tag it specifically
      // rather than assuming every future autofix is a loudness one.
      else if (r.outcome.status === 'autofix' && r.gate === 'audio') reasonCodes.push(ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED);
    } catch (e) {
      gates.push({ gate: 'unknown', outcome: { status: 'fail', reason: ReasonCode.CF_AUDIT_GATE_ERROR, detail: e instanceof Error ? e.message : String(e) } });
      reasonCodes.push(ReasonCode.CF_AUDIT_GATE_ERROR);
    }
  };

  runGate(() => narrativeGate(args.arc));
  runGate(() => captionGate(args.cues, args.cueConstraints));
  runGate(() => audioGate(args.measuredLufs, args.targetLufs));
  runGate(() => durationGate(args.durationSec, args.lenMin, args.lenMax));
  runGate(() => subjectInFrameGate(args.faces, args.cropTrack, args.subjectFloor));

  const passed = gates.every((g) => g.outcome.status !== 'fail');
  const degradations = [...new Set(reasonCodes.filter((c) => DEGRADATION_CODES.has(c)))];
  return { gates, passed, degraded: degradations.length > 0, degradations, reasonCodes: [...new Set(reasonCodes)] };
}
