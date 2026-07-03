/**
 * Multi-armed bandit variant testing: three edit-plan variants per clip —
 * A = exploit (policy best arms, optionally seeded from an elite template),
 * B/C = seeded 1-2 dimension explorations. Explore dimensions are EXACTLY the
 * spec's allowed set (hook, subtitles, zoom timing, sound timing) — never framing,
 * B-roll or music, and never full random. Every variant is regulated before it is
 * simulated; only the winner is ever rendered.
 */
import { buildZoomSfxTimes } from '../sfx/events.js';
import type { CaptionWord, ContentMode } from '../types/index.js';
import { truncateHook, type EditPlan, type SourceSignals } from './editPlan.js';
import {
  CAPTION_FAMILIES, chooseExploit, rngFromSeed, zoomOptsFor,
  type Policy, type ZoomBucket,
} from './policy.js';
import { regulate } from './regulator.js';
import { simulate, type SimResult } from './simulator.js';
import { applyTemplate, type EliteTemplate } from './templates.js';

export interface VariantPins { captionPreset?: boolean; zooms?: boolean; sfx?: boolean; hook?: boolean; }
export interface Variant { id: 'A' | 'B' | 'C'; plan: EditPlan; changed: string[]; violations: string[]; }
export interface ScoredVariant { variant: Variant; sim: SimResult; }

export interface VariantContext {
  mode: ContentMode;
  policy: Policy;
  templates: EliteTemplate[];
  pins: VariantPins;
  seed: string;
  words: CaptionWord[];
  durationSec: number;
  hookAlternatives: { moment?: string; title?: string };
}

function bucketOf(plan: EditPlan): ZoomBucket {
  return plan.zoom.times.length >= 3 ? 'tight' : 'sparse';
}

function withZoomBucket(plan: EditPlan, bucket: ZoomBucket, words: CaptionWord[]): EditPlan {
  return {
    ...plan,
    zoom: { ...plan.zoom, times: plan.zoom.enabled ? buildZoomSfxTimes(words, zoomOptsFor(bucket)) : [] },
  };
}

function withHookSource(plan: EditPlan, source: 'moment' | 'title', alts: VariantContext['hookAlternatives']): EditPlan {
  const text = source === 'moment' ? alts.moment : alts.title;
  if (!text?.trim()) return plan;
  return { ...plan, hookSource: source, hookText: truncateHook(text) };
}

/** PURE: A = exploit, B/C = seeded 1-2 dim explorations. All regulated. */
export function generateVariants(base: EditPlan, ctx: VariantContext): Variant[] {
  const rng = rngFromSeed(ctx.seed);
  const family = CAPTION_FAMILIES[ctx.mode];
  const pins = ctx.pins;

  // ---- Variant A: exploit ----
  let a = base;
  const aChanged: string[] = [];
  const template = ctx.templates.filter((t) => t.dna.mode === ctx.mode).sort((x, y) => y.retention - x.retention)[0];
  if (template && rng() >= ctx.policy.epsilon) {
    const applied = applyTemplate(template.dna, a, ctx.words);
    if (!pins.captionPreset) { if (applied.captionPreset !== a.captionPreset) aChanged.push('captionPreset'); }
    a = {
      ...applied,
      ...(pins.captionPreset ? { captionPreset: base.captionPreset } : {}),
      ...(pins.zooms ? { zoom: { ...base.zoom } } : {}),
      ...(pins.sfx ? { sfx: { ...base.sfx } } : {}),
    };
  }
  const learned = chooseExploit(ctx.policy, ctx.mode);
  if (!pins.captionPreset && learned.captionPreset && family.includes(learned.captionPreset)
      && learned.captionPreset !== a.captionPreset) {
    a = { ...a, captionPreset: learned.captionPreset };
    if (!aChanged.includes('captionPreset')) aChanged.push('captionPreset');
  }
  if (!pins.hook && learned.hookSource && learned.hookSource !== a.hookSource) {
    const next = withHookSource(a, learned.hookSource, ctx.hookAlternatives);
    if (next !== a) { a = next; aChanged.push('hookSource'); }
  }
  if (!pins.zooms && a.zoom.enabled && learned.zoomBucket && learned.zoomBucket !== bucketOf(a)) {
    a = withZoomBucket(a, learned.zoomBucket, ctx.words);
    aChanged.push('zoomBucket');
  }
  if (!pins.sfx && learned.sfxOn !== undefined && learned.sfxOn !== a.sfx.enabled) {
    a = { ...a, sfx: { ...a.sfx, enabled: learned.sfxOn && base.sfx.enabled } };
    aChanged.push('sfxOn');
  }

  // ---- Variant B: caption preset rotation + zoom bucket flip ----
  let b = a;
  const bChanged: string[] = [];
  if (!pins.captionPreset) {
    const idx = Math.max(0, family.indexOf(b.captionPreset));
    const next = family[(idx + 1 + Math.floor(rng() * (family.length - 1))) % family.length];
    if (next !== b.captionPreset) { b = { ...b, captionPreset: next }; bChanged.push('captionPreset'); }
  }
  if (!pins.zooms && b.zoom.enabled) {
    const flipped: ZoomBucket = bucketOf(a) === 'tight' ? 'sparse' : 'tight';
    b = withZoomBucket(b, flipped, ctx.words);
    bChanged.push('zoomBucket');
  }

  // ---- Variant C: hook alternative + zoom intensity nudge + sfx volume nudge ----
  let c = a;
  const cChanged: string[] = [];
  if (!pins.hook) {
    const alt = a.hookSource === 'moment' ? 'title' : 'moment';
    const next = withHookSource(c, alt, ctx.hookAlternatives);
    if (next !== c) { c = next; cChanged.push('hookSource'); }
  }
  if (!pins.zooms && c.zoom.enabled) {
    const sign = rng() < 0.5 ? -1 : 1;
    c = { ...c, zoom: { ...c.zoom, intensity: +(c.zoom.intensity + sign * 0.15).toFixed(2) } };
    cChanged.push('zoomIntensity');
  } else if (!pins.sfx && c.sfx.enabled) {
    c = { ...c, sfx: { ...c.sfx, volume: 0.4 } };
    cChanged.push('sfxVolume');
  }

  return ([['A', a, aChanged], ['B', b, bChanged], ['C', c, cChanged]] as const).map(([id, plan, changed]) => {
    const reg = regulate(plan, ctx.durationSec);
    return { id, plan: reg.plan, changed: [...changed], violations: reg.violations };
  });
}

/** PURE: simulate every variant against the clip's signals. */
export function scoreVariants(variants: Variant[], signals: SourceSignals): ScoredVariant[] {
  return variants.map((variant) => ({ variant, sim: simulate(variant.plan, signals) }));
}

/** PURE: highest predicted overall; ties resolve to the earliest (A first). */
export function pickWinner(scored: ScoredVariant[]): ScoredVariant {
  return scored.reduce((best, s) => (s.sim.overall > best.sim.overall ? s : best));
}
