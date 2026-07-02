/**
 * Narrative-overlay planning (v6) — PURE. Given downloaded B-roll assets tied to cues,
 * choose where the visual switches to B-roll while the A-roll voice continues. Editing
 * rules: the hook (first 3s) and the payoff (last 2s) always stay on the speaker; overlays
 * are 1.5-6s, spaced ≥2s apart, and never cover more than 40% of the clip.
 */
import type { BrollCue, BrollSegment } from '../types/index.js';

export const HOOK_CLEAR_SEC = 3;
export const TAIL_CLEAR_SEC = 2;
export const MIN_OVERLAY_SEC = 1.5;
export const MAX_OVERLAY_SEC = 6;
export const OVERLAY_GAP_SEC = 2;
export const MAX_COVERAGE = 0.4;

export interface BrollAsset { cue: BrollCue; file: string; sourceUrl: string; }

/** Entities/events read strongest on screen; emotions/objects are garnish. */
const KIND_PRIORITY: Record<string, number> = {
  person: 3, event: 3, company: 3, concept: 2, action: 2, place: 1, object: 1, emotion: 1,
};

/** PURE: pick non-overlapping overlay windows from the available assets. */
export function planOverlays(assets: BrollAsset[], clipDurSec: number, opts: { maxBroll: number }): BrollSegment[] {
  const budget = clipDurSec * MAX_COVERAGE;
  const byPriority = [...assets].sort((a, b) => {
    const p = (KIND_PRIORITY[b.cue.kind] ?? 1) - (KIND_PRIORITY[a.cue.kind] ?? 1);
    return p !== 0 ? p : (b.cue.end - b.cue.start) - (a.cue.end - a.cue.start);
  });

  const placed: BrollSegment[] = [];
  let coverage = 0;
  for (const asset of byPriority) {
    if (placed.length >= opts.maxBroll) break;
    const at = Math.max(asset.cue.start, HOOK_CLEAR_SEC);
    const end = Math.min(asset.cue.end, at + MAX_OVERLAY_SEC, clipDurSec - TAIL_CLEAR_SEC);
    const dur = end - at;
    if (dur < MIN_OVERLAY_SEC) continue;
    if (coverage + dur > budget) continue;
    const collides = placed.some((p) => at < p.atSec + p.durationSec + OVERLAY_GAP_SEC && p.atSec < end + OVERLAY_GAP_SEC);
    if (collides) continue;
    placed.push({
      file: asset.file, atSec: +at.toFixed(2), durationSec: +dur.toFixed(2),
      entity: asset.cue.entity, kind: asset.cue.kind, query: asset.cue.query, sourceUrl: asset.sourceUrl,
    });
    coverage += dur;
  }
  return placed.sort((a, b) => a.atSec - b.atSec);
}

/** PURE: drop arrow callouts that would fire while B-roll covers the speaker's face. */
export function filterCallouts<T extends { time: number }>(
  callouts: T[], overlays: { atSec: number; durationSec: number }[],
): T[] {
  return callouts.filter((c) =>
    !overlays.some((o) => c.time >= o.atSec - 0.5 && c.time <= o.atSec + o.durationSec + 0.5));
}
