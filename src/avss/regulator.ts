/**
 * Consistency regulator — the central over-editing clamp. Every plan (base or
 * explored variant) passes through here before simulation/render, so exploration
 * can never produce a chaotic edit. Pure and total: never throws, always returns
 * a compliant plan plus the list of fixes it had to make.
 * (Callout density stays capped at 2 inside planCallouts; SFX events are bounded
 * by zoom times + one hook impact, which the zoom caps already keep under
 * CAPS.sfxPer10s.)
 */
import { truncateHook, type EditPlan } from './editPlan.js';

export const CAPS = {
  zoomsPer10s: 2,
  minZoomGapSec: 2.5,
  sfxPer10s: 3,
  maxBrollCoverage: 0.4,
  maxHookWords: 8,
  zoomIntensityMin: 0.3,
  zoomIntensityMax: 1.3,
} as const;

export interface Regulated { plan: EditPlan; violations: string[]; }

export function regulate(plan: EditPlan, durationSec: number): Regulated {
  const violations: string[] = [];
  const out: EditPlan = {
    ...plan,
    zoom: { ...plan.zoom, times: [...plan.zoom.times] },
    sfx: { ...plan.sfx },
    brollWindows: plan.brollWindows.map((b) => ({ ...b })),
  };

  // Zoom min gap: keep the first of any too-close pair.
  const spaced: number[] = [];
  for (const t of [...out.zoom.times].sort((a, b) => a - b)) {
    if (spaced.length === 0 || t - spaced[spaced.length - 1] >= CAPS.minZoomGapSec) spaced.push(t);
  }
  if (spaced.length !== out.zoom.times.length) {
    violations.push(`zooms closer than ${CAPS.minZoomGapSec}s dropped (${out.zoom.times.length} → ${spaced.length})`);
  }
  // Zoom density cap.
  const maxZooms = Math.max(1, Math.ceil((durationSec / 10) * CAPS.zoomsPer10s));
  if (spaced.length > maxZooms) {
    violations.push(`zoom density over ${CAPS.zoomsPer10s}/10s (${spaced.length} → ${maxZooms})`);
    spaced.length = maxZooms;
  }
  out.zoom.times = spaced;

  // Intensity clamp (NaN → min: a broken intensity must not zero the punch math).
  const i = out.zoom.intensity;
  const clamped = Number.isFinite(i)
    ? Math.min(CAPS.zoomIntensityMax, Math.max(CAPS.zoomIntensityMin, i))
    : CAPS.zoomIntensityMin;
  if (clamped !== i) {
    violations.push(`zoom intensity ${i} clamped to ${clamped}`);
    out.zoom.intensity = clamped;
  }

  // Hook length.
  if (out.hookText) {
    const cut = truncateHook(out.hookText);
    if (cut !== out.hookText) {
      violations.push(`hook re-truncated to ${CAPS.maxHookWords} words`);
      out.hookText = cut;
    }
  }

  // B-roll coverage: trim from the END — earlier overlays carry the narrative setup.
  const maxCover = durationSec * CAPS.maxBrollCoverage;
  let cover = out.brollWindows.reduce((a, b) => a + b.durationSec, 0);
  while (out.brollWindows.length > 0 && cover > maxCover) {
    const dropped = out.brollWindows.pop()!;
    cover -= dropped.durationSec;
    violations.push(`b-roll over ${CAPS.maxBrollCoverage * 100}% coverage — dropped overlay at ${dropped.atSec}s`);
  }

  return { plan: out, violations };
}
