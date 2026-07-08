/**
 * Read-side helpers over the semantic timeline for Node consumers (SP1 1c/1d wirings).
 * Everything degrades to empty/'' on empty input, so perception-off runs are bit-identical.
 */
import type { AudioEvent } from './timeline.js';

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
