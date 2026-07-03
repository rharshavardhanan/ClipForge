/**
 * Plan-level audience simulator — deterministic proxy models over an EditPlan +
 * SourceSignals (no pixels, no ML): attention curve, dopamine spikes, swipe hazard,
 * retention survival curve, rewatch score, and a spec-weighted overall score
 * (0.35 retention / 0.20 completion / 0.20 rewatch / 0.10 likes / 0.10 comments /
 * 0.05 shares, with semantic proxies standing in for the engagement terms pre-upload).
 * Frame novelty is proxied by plan-derived visual-change events (hook, zooms,
 * B-roll edges, emphasized caption words) — see the AVSS design doc.
 */
import type { SemanticScores } from '../types/index.js';
import { clamp01, type EditPlan, type SourceSignals } from './editPlan.js';

export const TICK = 0.5;

export interface SimPoint { t: number; v: number; }
export interface DopamineEvent { t: number; kind: 'impact' | 'reward' | 'humor' | 'surprise'; strength: number; }
export interface SimResult {
  attention: SimPoint[];
  dopamine: DopamineEvent[];
  hazard: SimPoint[];
  retention: SimPoint[];
  avgRetention: number;
  completion: number;
  rewatch: number;
  rewatchFactors: { surpriseHumor: number; loopPull: number; tightness: number; endSpike: number };
  dropoffs: number[];
  overall: number;
}

/** PURE: every moment the frame visibly changes, per the plan. Always includes 0 (cut-in). */
export function visualEvents(plan: EditPlan): number[] {
  const ev = new Set<number>([0]);
  for (const t of plan.zoom.times) ev.add(t);
  for (const b of plan.brollWindows) { ev.add(b.atSec); ev.add(b.atSec + b.durationSec); }
  return [...ev].sort((a, b) => a - b);
}

function ticksFor(durationSec: number): number[] {
  const out: number[] = [];
  for (let t = 0; t <= durationSec + 1e-9; t += TICK) out.push(+t.toFixed(4));
  return out;
}

function rmsAt(signals: SourceSignals, t: number): number {
  const curve = signals.rms;
  if (curve.length === 0) return 0.5;
  let best = curve[0];
  for (const p of curve) if (Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
  return clamp01(best.rms / 10);
}

function wordsPerSecAt(signals: SourceSignals, t: number): number {
  const n = signals.words.filter((w) => w.start >= t - 1 && w.start <= t + 1).length;
  return clamp01(n / 2 / 2); // words/sec over the 2s window, 2 wps = full marks
}

function inSilence(signals: SourceSignals, t: number): boolean {
  return signals.silences.some((r) => t >= r.start && t <= r.end);
}

/** Seconds since the most recent visual change at/before t (events include 0). */
function eventGap(events: number[], t: number): number {
  let last = 0;
  for (const e of events) { if (e <= t + 1e-9) last = e; else break; }
  return t - last;
}

function attentionCurve(plan: EditPlan, signals: SourceSignals, events: number[]): SimPoint[] {
  // Emphasized caption words are visual changes too (word-level highlight/punch).
  const withWords = [...new Set([...events, ...signals.words.filter((w) => w.emphasized).map((w) => w.start)])]
    .sort((a, b) => a - b);
  return ticksFor(signals.durationSec).map((t) => {
    const gap = eventGap(withWords, t);
    const boost = 0.25 * Math.exp(-gap / 0.8);
    const stale = Math.min(0.4, 0.08 * Math.max(0, gap - 2.5));
    const v = clamp01(0.35 + 0.3 * wordsPerSecAt(signals, t) + 0.35 * rmsAt(signals, t) + boost - stale);
    return { t, v };
  });
}

function dopamineEvents(plan: EditPlan, signals: SourceSignals): DopamineEvent[] {
  const raw: DopamineEvent[] = [];
  const emphasized = signals.words.filter((w) => w.emphasized);

  for (const w of emphasized) {
    const energy = rmsAt(signals, w.start);
    if (energy >= 0.7) raw.push({ t: w.start, kind: 'impact', strength: energy });
  }
  if (signals.semantic.humor >= 0.5 && emphasized.length > 0) {
    const loudest = emphasized.reduce((a, b) => (rmsAt(signals, b.start) > rmsAt(signals, a.start) ? b : a));
    raw.push({ t: loudest.start, kind: 'humor', strength: signals.semantic.humor });
  }
  if (signals.semantic.surprise >= 0.5) {
    const first = emphasized.find((w) => w.start >= 1);
    if (first) raw.push({ t: first.start, kind: 'surprise', strength: signals.semantic.surprise });
  }
  // Payoff: the loudest tick of the final quarter reads as the reward beat.
  const lastQ = ticksFor(signals.durationSec).filter((t) => t >= signals.durationSec * 0.75);
  if (lastQ.length > 0) {
    const t = lastQ.reduce((a, b) => (rmsAt(signals, b) > rmsAt(signals, a) ? b : a));
    raw.push({ t, kind: 'reward', strength: rmsAt(signals, t) });
  }

  // Merge within 1s (keep the stronger), cap 8.
  raw.sort((a, b) => a.t - b.t);
  const merged: DopamineEvent[] = [];
  for (const e of raw) {
    const prev = merged[merged.length - 1];
    if (prev && e.t - prev.t < 1) {
      if (e.strength > prev.strength) merged[merged.length - 1] = e;
    } else merged.push(e);
  }
  return merged.slice(0, 8);
}

function swipeHazard(plan: EditPlan, signals: SourceSignals, events: number[]): SimPoint[] {
  const emo = Math.max(
    signals.semantic.emotional_intensity, signals.semantic.humor, signals.semantic.surprise,
  );
  const emphasizedEarly = signals.words.some((w) => w.emphasized && w.start < 3);
  return ticksFor(signals.durationSec).map((t) => {
    const gap = eventGap(events, t);
    let h = 0.010;
    if (inSilence(signals, t) && gap > 1.5) h += 0.030;
    h += Math.min(0.05, 0.012 * Math.max(0, gap - 2.5));
    if (emo < 0.3) h += 0.010;
    if (t < 3) {
      h *= 3; // the swipe decision window
      if (plan.hookText) h *= 0.55;
      if (emphasizedEarly) h *= 0.8;
      if (rmsAt(signals, t) >= 0.6) h *= 0.85;
    }
    return { t, v: Math.min(0.25, Math.max(0.001, h)) };
  });
}

function retentionCurve(hazard: SimPoint[]): SimPoint[] {
  let surviving = 1;
  return hazard.map((p) => {
    surviving *= 1 - p.v;
    return { t: p.t, v: surviving };
  });
}

function localMaxima(hazard: SimPoint[]): number[] {
  const peaks: SimPoint[] = [];
  for (let i = 1; i < hazard.length - 1; i++) {
    if (hazard[i].v > hazard[i - 1].v && hazard[i].v > hazard[i + 1].v) peaks.push(hazard[i]);
  }
  return peaks.sort((a, b) => b.v - a.v).slice(0, 3).map((p) => p.t).sort((a, b) => a - b);
}

function rewatch(
  signals: SourceSignals, dopamine: DopamineEvent[],
): { score: number; factors: SimResult['rewatchFactors'] } {
  const dur = signals.durationSec;
  const finalQ = dopamine.filter((e) => e.t >= dur * 0.75).length;
  const factors = {
    surpriseHumor: 0.4 * Math.max(signals.semantic.humor, signals.semantic.surprise),
    loopPull: 0.3 * Math.min(1, finalQ / 2),
    tightness: 0.2 * clamp01(1 - Math.max(0, dur - 30) / 30),
    endSpike: dopamine.some((e) => dur - e.t <= 2) ? 0.1 : 0,
  };
  const score = clamp01(factors.surpriseHumor + factors.loopPull + factors.tightness + factors.endSpike);
  return { score, factors };
}

function overallScore(avgRetention: number, completion: number, rw: number, s: SemanticScores): number {
  return clamp01(
    0.35 * avgRetention +
    0.20 * completion +
    0.20 * rw +
    0.10 * s.emotional_intensity +                       // likes proxy
    0.10 * Math.max(s.controversy, s.argument_peak) +    // comments proxy
    0.05 * Math.max(s.humor, s.surprise),                // shares proxy
  );
}

/** PURE: full simulation of one plan against one clip's signals. */
export function simulate(plan: EditPlan, signals: SourceSignals): SimResult {
  const events = visualEvents(plan);
  const attention = attentionCurve(plan, signals, events);
  const dopamine = dopamineEvents(plan, signals);
  const hazard = swipeHazard(plan, signals, events);
  const retention = retentionCurve(hazard);
  const avgRetention = retention.reduce((a, p) => a + p.v, 0) / retention.length;
  const completion = retention[retention.length - 1].v;
  const { score: rewatchScore, factors: rewatchFactors } = rewatch(signals, dopamine);
  return {
    attention, dopamine, hazard, retention,
    avgRetention, completion,
    rewatch: rewatchScore, rewatchFactors,
    dropoffs: localMaxima(hazard),
    overall: overallScore(avgRetention, completion, rewatchScore, signals.semantic),
  };
}
