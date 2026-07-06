/**
 * Semantic Timeline — the Node type mirror + Zod-free runtime validator for the perception
 * contract. Source of truth is the JSON-schema in the Python package; this mirrors it and the
 * golden fixture (perception/fixtures/golden_timeline.json) is the shared conformance anchor.
 */
export const TIMELINE_SCHEMA_VERSION = 1 as const;

export const AUDIO_EVENT_KINDS = [
  'laughter', 'applause', 'cheer', 'impact', 'music', 'speech', 'other',
] as const;
export type AudioEventKind = (typeof AUDIO_EVENT_KINDS)[number];

export interface TimelineSpan { start: number; end: number; }
export interface TimelineSpeaker { id: string; turns: TimelineSpan[]; }
export interface AudioEvent { start: number; end: number; kind: AudioEventKind; score: number; }
export interface TimelineScene { start: number; end: number; label: string; embedding_ref?: string; }

export interface SemanticTimeline {
  schema_version: typeof TIMELINE_SCHEMA_VERSION;
  job_id: string;
  duration: number;
  sample_fps: number;
  producers_run: string[];
  speakers: TimelineSpeaker[];
  audio_events: AudioEvent[];
  scenes: TimelineScene[];
  // reserved, GPU-gated layers — always present, empty until those producers run:
  tracks: unknown[];
  objects: unknown[];
  depth: unknown[];
  vlm_captions: unknown[];
}

export type ValidateResult =
  | { ok: true; timeline: SemanticTimeline }
  | { ok: false; errors: string[] };

const KIND_SET = new Set<string>(AUDIO_EVENT_KINDS);
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validateTimeline(obj: unknown): ValidateResult {
  const e: string[] = [];
  if (!isRec(obj)) return { ok: false, errors: ['timeline is not an object'] };

  if (obj.schema_version !== TIMELINE_SCHEMA_VERSION) {
    e.push(`schema_version must be ${TIMELINE_SCHEMA_VERSION}, got ${String(obj.schema_version)}`);
  }
  if (typeof obj.job_id !== 'string' || obj.job_id.length === 0) e.push('job_id must be a non-empty string');
  if (!isTime(obj.duration)) e.push('duration must be a finite number >= 0');
  if (typeof obj.sample_fps !== 'number' || !(obj.sample_fps > 0)) e.push('sample_fps must be a number > 0');
  if (!Array.isArray(obj.producers_run) || !obj.producers_run.every((p) => typeof p === 'string')) {
    e.push('producers_run must be an array of strings');
  }

  if (!Array.isArray(obj.speakers)) e.push('speakers must be an array');
  else obj.speakers.forEach((s, i) => {
    if (!isRec(s) || typeof s.id !== 'string' || s.id.length === 0) e.push(`speakers[${i}].id must be a non-empty string`);
    else if (!Array.isArray(s.turns) || !s.turns.every((t) => isRec(t) && isTime(t.start) && isTime(t.end))) {
      e.push(`speakers[${i}].turns must be spans with numeric start/end >= 0`);
    }
  });

  if (!Array.isArray(obj.audio_events)) e.push('audio_events must be an array');
  else obj.audio_events.forEach((a, i) => {
    if (!isRec(a) || !isTime(a.start) || !isTime(a.end)) e.push(`audio_events[${i}] needs numeric start/end >= 0`);
    else {
      if (!KIND_SET.has(a.kind as string)) e.push(`audio_events[${i}].kind '${String(a.kind)}' not in enum`);
      if (typeof a.score !== 'number' || a.score < 0 || a.score > 1) e.push(`audio_events[${i}].score must be in [0,1]`);
    }
  });

  if (!Array.isArray(obj.scenes)) e.push('scenes must be an array');
  else obj.scenes.forEach((s, i) => {
    if (!isRec(s) || !isTime(s.start) || !isTime(s.end)) e.push(`scenes[${i}] needs numeric start/end >= 0`);
    else if (typeof s.label !== 'string') e.push(`scenes[${i}].label must be a string`);
  });

  for (const k of ['tracks', 'objects', 'depth', 'vlm_captions'] as const) {
    if (!Array.isArray(obj[k])) e.push(`${k} must be an array`);
  }

  return e.length === 0 ? { ok: true, timeline: obj as unknown as SemanticTimeline } : { ok: false, errors: e };
}
