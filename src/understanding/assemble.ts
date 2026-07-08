/**
 * PURE assembly: per-chunk understanding → one global UnderstandingResult.
 * Global ids, per-chunk edge-ref remapping, seam merging of split scenes, and
 * the importance-curve fusion (spec §3). The LLM anchors scene importance;
 * everything time-domain here is deterministic Node math.
 */
import { clamp01 } from '../avss/editPlan.js';
import type { CurvePoint } from '../rankrot/signals.js';
import type { AudioEvent } from '../perception/timeline.js';
import type { ArcLabel, ArcSpan } from '../types/index.js';
import {
  SCENE_MERGE_MAX_GAP_SEC, SCENE_MERGE_MAX_SEC, W_EVENT, W_MOTION, W_RMS, W_SCENE,
  type ImportancePoint, type SceneNode, type StoryEdge, type UnderstandingResult,
} from './types.js';

export interface ChunkUnderstanding {
  chunkKey: string;
  chunkSpan: ArcSpan;
  arcs: ArcLabel[];
  scenes: Omit<SceneNode, 'id'>[];
  edges: StoryEdge[];              // refs local to THIS chunk's scenes/arcs arrays
}

export interface AssembleSignals {
  rms: CurvePoint[];
  motion: CurvePoint[];
  events: AudioEvent[];
  durationSec: number;
  useSceneTerm: boolean;           // false = no-LLM renormalized fusion (spec §3)
}

const AUDIENCE_KINDS = new Set(['laughter', 'applause', 'cheer', 'impact']);

function participantsCompatible(a: string[], b: string[]): boolean {
  if (a.length === 0 && b.length === 0) return true;
  if (a.length === 0 || b.length === 0) return false;
  const setB = new Set(b);
  const shared = a.filter((x) => setB.has(x)).length;
  return shared / Math.min(a.length, b.length) >= 0.5;
}

/** Merge seam-split scenes; returns scenes plus an index remap old→new. */
function mergeScenes(scenes: Omit<SceneNode, 'id'>[]): { merged: Omit<SceneNode, 'id'>[]; remap: number[] } {
  const merged: Omit<SceneNode, 'id'>[] = [];
  const remap: number[] = [];
  for (const s of scenes) {
    const prev = merged[merged.length - 1];
    const canMerge = prev
      && s.span.start - prev.span.end <= SCENE_MERGE_MAX_GAP_SEC
      && prev.label.toLowerCase() === s.label.toLowerCase()
      && participantsCompatible(prev.participants, s.participants)
      && s.span.end - prev.span.start <= SCENE_MERGE_MAX_SEC;
    if (canMerge) {
      prev.span = { start: prev.span.start, end: Math.max(prev.span.end, s.span.end) };
      prev.importance = Math.max(prev.importance, s.importance);
      prev.participants = [...new Set([...prev.participants, ...s.participants])];
      prev.events = [...prev.events, ...s.events].slice(0, 5);
      remap.push(merged.length - 1);
    } else {
      merged.push({ ...s, participants: [...s.participants], events: [...s.events] });
      remap.push(merged.length - 1);
    }
  }
  return { merged, remap };
}

const p95 = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
};

const nearest = (pts: CurvePoint[], t: number): number => {
  if (pts.length === 0) return 0;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
  return best.v;
};

function buildImportanceCurve(
  scenes: Omit<SceneNode, 'id'>[], sig: AssembleSignals,
): ImportancePoint[] {
  const rmsP95 = p95(sig.rms.map((p) => p.v));
  const motionP95 = p95(sig.motion.map((p) => p.v));
  const audience = sig.events.filter((e) => AUDIENCE_KINDS.has(e.kind));

  const sceneRaw: number[] = [];
  const n = Math.floor(sig.durationSec);
  for (let t = 0; t <= n; t++) {
    const scene = scenes.find((s) => t >= s.span.start && t < s.span.end);
    sceneRaw.push(scene ? scene.importance : 0.5);
  }
  // 3-point moving average smooths scene steps.
  const scene01 = sceneRaw.map((_, i) => {
    const window = sceneRaw.slice(Math.max(0, i - 1), Math.min(sceneRaw.length, i + 2));
    return window.reduce((a, b) => a + b, 0) / window.length;
  });

  const out: ImportancePoint[] = [];
  for (let t = 0; t <= n; t++) {
    const rms01 = rmsP95 > 0 ? Math.min(1, nearest(sig.rms, t) / rmsP95) : 0;
    const motion01 = motionP95 > 0 ? Math.min(1, nearest(sig.motion, t) / motionP95) : 0;
    const event01 = audience.reduce((m, e) => (t >= e.start && t <= e.end ? Math.max(m, e.score) : m), 0);
    const v = sig.useSceneTerm
      ? clamp01(W_SCENE * scene01[t] + W_RMS * rms01 + W_MOTION * motion01 + W_EVENT * event01)
      : clamp01((W_RMS * rms01 + W_MOTION * motion01 + W_EVENT * event01) / (1 - W_SCENE));
    out.push({ t, v });
  }
  return out;
}

export function assembleUnderstanding(
  chunks: ChunkUnderstanding[], signals: AssembleSignals, provider: string,
): UnderstandingResult {
  // 1. Concatenate with global offsets; remap each chunk's local edge refs.
  const allScenes: Omit<SceneNode, 'id'>[] = [];
  const allArcs: ArcLabel[] = [];
  const globalEdges: StoryEdge[] = [];
  for (const c of chunks) {
    const scOff = allScenes.length;
    const arcOff = allArcs.length;
    allScenes.push(...c.scenes);
    allArcs.push(...c.arcs);
    for (const e of c.edges) {
      const remapRef = (ref: string): string => {
        const m = /^(sc|arc)(\d+)$/.exec(ref)!;
        return m[1] === 'sc' ? `sc${scOff + Number(m[2])}` : `arc${arcOff + Number(m[2])}`;
      };
      globalEdges.push({ ...e, from: remapRef(e.from), to: remapRef(e.to) });
    }
  }

  // 2. Sort scenes by start (chunks are in order, but be safe) with an index map,
  //    then seam-merge and remap edges to survivors.
  const order = allScenes.map((_, i) => i).sort((a, b) => allScenes[a].span.start - allScenes[b].span.start);
  const sorted = order.map((i) => allScenes[i]);
  const posOf = new Map(order.map((oldIdx, pos) => [oldIdx, pos]));
  const { merged, remap } = mergeScenes(sorted);

  const remapScRef = (ref: string): string => {
    const m = /^sc(\d+)$/.exec(ref);
    if (!m) return ref;                                   // arc refs unchanged
    return `sc${remap[posOf.get(Number(m[1]))!]}`;
  };
  const seen = new Map<string, StoryEdge>();
  for (const e of globalEdges) {
    const from = remapScRef(e.from);
    const to = remapScRef(e.to);
    if (from === to) continue;                            // merged into a self-loop → drop
    const key = `${from}|${to}|${e.type}`;
    const prev = seen.get(key);
    if (!prev || e.confidence > prev.confidence) seen.set(key, { ...e, from, to });
  }

  const scenes: SceneNode[] = merged.map((s, i) => ({ ...s, id: `sc${i}` }));
  return {
    scenes,
    arcs: allArcs,
    edges: [...seen.values()],
    importance: buildImportanceCurve(merged, signals),
    provider,
  };
}

/** PURE: clip-relative slice of the importance curve for AVSS. */
export function sliceImportance(curve: ImportancePoint[], clipStart: number, clipEnd: number): ImportancePoint[] {
  return curve.filter((p) => p.t >= clipStart && p.t < clipEnd).map((p) => ({ t: p.t - clipStart, v: p.v }));
}

/** PURE: mean importance over [start, end); 0 when no points land inside. */
export function meanImportance01(curve: ImportancePoint[], start: number, end: number): number {
  const pts = curve.filter((p) => p.t >= start && p.t < end);
  return pts.length > 0 ? pts.reduce((a, p) => a + p.v, 0) / pts.length : 0;
}
