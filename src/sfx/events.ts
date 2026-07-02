/**
 * SFX timing plan. buildZoomSfxTimes MUST mirror remotion/src/punchZoom.ts buildZoomEvents
 * (min gap 2.5s, max 4 events, nothing in the first second) so sounds land exactly on the
 * visual punch-zooms.
 */
import type { CaptionWord } from '../types/index.js';
import { pickSfx, type SfxKind } from './library.js';

export function buildZoomSfxTimes(
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

export interface SfxEvent { time: number; path: string; }

/** PURE: impact one-shot under the hook card + a whoosh on each punch-zoom event. */
export function planSfx(
  words: CaptionWord[],
  lib: Partial<Record<SfxKind, string[]>>,
  opts: { hasHook: boolean; zooms: boolean; seed: string },
): SfxEvent[] {
  const events: SfxEvent[] = [];
  if (opts.hasHook) {
    const impact = pickSfx(lib, 'impact', `${opts.seed}_hook`);
    if (impact) events.push({ time: 0.05, path: impact });
  }
  if (opts.zooms) {
    for (const [i, t] of buildZoomSfxTimes(words).entries()) {
      const whoosh = pickSfx(lib, 'whoosh', `${opts.seed}_zoom_${i}`);
      if (whoosh) events.push({ time: t, path: whoosh });
    }
  }
  return events;
}
