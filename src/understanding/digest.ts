/**
 * PURE: compact perception-facts block appended to the understanding prompt —
 * CLIP scene labels, audience audio events, and (real, multi-speaker) diarization
 * turns inside the chunk window. Timeline absent → '' (prompt degrades to the
 * existing RMS/motion evidence alone). Capped like buildEvidenceBlock.
 */
import type { SemanticTimeline } from '../perception/timeline.js';
import type { ArcSpan } from '../types/index.js';
import { MAX_DIGEST_LINES } from './types.js';

const AUDIENCE_KINDS = new Set(['laughter', 'applause', 'cheer', 'impact']);
const GENERIC_SCENE_LABEL = /^scene \d+$/;
const EVENT_SCORE_MIN = 0.35;
const MAX_EVENTS = 15;
const MAX_TURNS = 15;

export function buildPerceptionDigest(timeline: SemanticTimeline | null, window: ArcSpan): string {
  if (!timeline) return '';
  const lines: string[] = [];

  const scenes = timeline.scenes.filter(
    (s) => s.end > window.start && s.start < window.end && !GENERIC_SCENE_LABEL.test(s.label),
  );
  if (scenes.length > 0) {
    lines.push('VISUAL SCENES (camera sees):');
    for (const s of scenes) lines.push(`[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.label}`);
  }

  const events = timeline.audio_events
    .filter((e) => AUDIENCE_KINDS.has(e.kind) && e.score >= EVENT_SCORE_MIN
      && e.start >= window.start && e.start < window.end)
    .sort((a, b) => b.score - a.score).slice(0, MAX_EVENTS)
    .sort((a, b) => a.start - b.start);
  if (events.length > 0) {
    lines.push('AUDIENCE AUDIO EVENTS:');
    for (const e of events) lines.push(`[${e.start.toFixed(1)}] ${e.kind} ${e.score.toFixed(2)}`);
  }

  // Single-speaker layers are the mock's silence-complement — noise, not diarization.
  if (timeline.speakers.length > 1) {
    const turns = timeline.speakers
      .flatMap((sp) => sp.turns
        .filter((t) => t.end > window.start && t.start < window.end)
        .map((t) => ({ id: sp.id, start: t.start, end: t.end })))
      .sort((a, b) => a.start - b.start).slice(0, MAX_TURNS);
    if (turns.length > 0) {
      lines.push('SPEAKER TURNS:');
      for (const t of turns) lines.push(`[${t.start.toFixed(1)}-${t.end.toFixed(1)}] ${t.id}`);
    }
  }

  return lines.slice(0, MAX_DIGEST_LINES).join('\n');
}
