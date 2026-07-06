/**
 * Shared degradation/rejection vocabulary (v4 Part 1 §7.4). Every fallback path, quality
 * gate, and run-report entry tags itself with one of these so silent quality decay becomes
 * a counted, visible thing. Enum string values equal their keys → stable JSON serialization.
 */
export enum ReasonCode {
  // spec Part 1 §7.4 (verbatim)
  FRAMING_FALLBACK_CENTER_CROP = 'FRAMING_FALLBACK_CENTER_CROP',
  FRAMING_LOW_TRACK_CONFIDENCE = 'FRAMING_LOW_TRACK_CONFIDENCE',
  FRAMING_MULTI_SUBJECT_UNRESOLVED = 'FRAMING_MULTI_SUBJECT_UNRESOLVED',
  ASR_LOW_CONFIDENCE_SEGMENT = 'ASR_LOW_CONFIDENCE_SEGMENT',
  DIARIZATION_UNKNOWN_SPEAKER = 'DIARIZATION_UNKNOWN_SPEAKER',
  DIRECTOR_NO_ARC_FOUND = 'DIRECTOR_NO_ARC_FOUND',
  EDITOR_CUT_ON_NON_BOUNDARY = 'EDITOR_CUT_ON_NON_BOUNDARY',
  QUALITY_CAPTION_OVERFLOW = 'QUALITY_CAPTION_OVERFLOW',
  QUALITY_SUBJECT_OUT_OF_FRAME = 'QUALITY_SUBJECT_OUT_OF_FRAME',
  MODEL_UNAVAILABLE_STEPDOWN = 'MODEL_UNAVAILABLE_STEPDOWN',
  GPU_OOM_STEPDOWN = 'GPU_OOM_STEPDOWN',
  // ClipForge additions (namespaced CF_ — not in the spec's enum, documented here)
  CF_AUDIO_LOUDNESS_ADJUSTED = 'CF_AUDIO_LOUDNESS_ADJUSTED',
  CF_BELOW_RETENTION_FLOOR = 'CF_BELOW_RETENTION_FLOOR',
  CF_AUDIT_GATE_ERROR = 'CF_AUDIT_GATE_ERROR',
}

export type ReasonCodeCounts = Partial<Record<ReasonCode, number>>;

/** PURE: occurrence counts per reason code (absent codes omitted). */
export function tallyReasonCodes(codes: ReasonCode[]): ReasonCodeCounts {
  const out: ReasonCodeCounts = {};
  for (const c of codes) out[c] = (out[c] ?? 0) + 1;
  return out;
}
