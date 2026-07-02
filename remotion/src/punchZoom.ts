/**
 * Punch-zoom editing grammar: a brief scale "punch" of the video layer on emphasized
 * moments. Deliberately sparing — few events per clip, spaced apart, never in the first
 * second (the hook must stay stable).
 */
import type { CaptionWord } from './captionLogic';

const RAMP = 0.12;   // seconds to reach peak
const HOLD = 0.5;    // seconds at peak (from event start)
const RELEASE = 0.9; // seconds until fully back to 1 (from event start)
const PEAK = 1.08;

export function buildZoomEvents(
  words: CaptionWord[],
  opts: { minGapSec?: number; maxEvents?: number } = {},
): number[] {
  const minGap = opts.minGapSec ?? 2.5;
  const maxEvents = opts.maxEvents ?? 4;
  const events: number[] = [];
  for (const w of words) {
    if (!w.emphasized || w.start < 1) continue;
    if (events.length > 0 && w.start - events[events.length - 1] < minGap) continue;
    events.push(w.start);
    if (events.length >= maxEvents) break;
  }
  return events;
}

/** Scale of the video layer at time t: 1 → 1.08 punch envelope around each event. */
export function punchScaleAt(events: number[], t: number): number {
  for (const e of events) {
    const dt = t - e;
    if (dt < 0 || dt >= RELEASE) continue;
    if (dt < RAMP) return 1 + (PEAK - 1) * (dt / RAMP);
    if (dt < HOLD) return PEAK;
    return PEAK - (PEAK - 1) * ((dt - HOLD) / (RELEASE - HOLD));
  }
  return 1;
}
