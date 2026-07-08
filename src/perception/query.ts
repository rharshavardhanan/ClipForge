/**
 * Read-side helpers over the semantic timeline for Node consumers (SP1 1c/1d wirings).
 * Everything degrades to empty/'' on empty input, so perception-off runs are bit-identical.
 */
import type { AudioEvent, TimelineScene } from './timeline.js';

export interface ReactionEvent {
  t: number;                                              // clip-relative seconds
  kind: 'laughter' | 'applause' | 'cheer' | 'impact';
  score: number;
}

const REACTION_KINDS = new Set(['laughter', 'applause', 'cheer', 'impact']);

/** PURE: timeline audio events → clip-relative reaction events for the AVSS simulator. */
export function clipReactionEvents(
  events: AudioEvent[], clipStart: number, clipEnd: number, scoreMin = 0.5,
): ReactionEvent[] {
  return events
    .filter((e) => REACTION_KINDS.has(e.kind) && e.score >= scoreMin
      && e.start >= clipStart && e.start < clipEnd)
    .map((e) => ({ t: e.start - clipStart, kind: e.kind as ReactionEvent['kind'], score: e.score }));
}

const GENERIC_SCENE_LABEL = /^scene \d+$/;

/** PURE: dominant-overlap scene label for a clip window — the Slice B topic fallback when
 *  the LLM semantic topic is unavailable. Mock's numbered placeholders never count. */
export function sceneTopicOf(start: number, end: number, scenes: TimelineScene[]): string {
  let best = '';
  let bestOverlap = 0;
  for (const s of scenes) {
    if (GENERIC_SCENE_LABEL.test(s.label)) continue;
    const overlap = Math.min(end, s.end) - Math.max(start, s.start);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = s.label; }
  }
  return best;
}
