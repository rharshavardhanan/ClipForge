/**
 * PURE strict validation after normalization — clamp scene spans to the chunk,
 * enforce MIN_SCENE_SEC and start-order overlap trimming, cap events, and keep
 * only edges whose refs exist, whose type is known, and whose confidence clears
 * the floor. Strictness lives here; tolerance lives in normalize.ts.
 */
import { clamp01 } from '../avss/editPlan.js';
import type { ArcSpan } from '../types/index.js';
import {
  EDGE_MIN_CONFIDENCE, MIN_SCENE_SEC, STORY_EDGE_TYPES,
  type SceneNode, type StoryEdge, type StoryEdgeType,
} from './types.js';

const EDGE_TYPE_SET = new Set<string>(STORY_EDGE_TYPES);
const REF_RE = /^(sc|arc)(\d+)$/;

export function validateScenes(raws: unknown[], chunk: ArcSpan): Omit<SceneNode, 'id'>[] {
  const candidates: Omit<SceneNode, 'id'>[] = [];
  for (const raw of raws) {
    const r = raw as Record<string, unknown>;
    const span = r?.span as ArcSpan | undefined;
    if (typeof span?.start !== 'number' || typeof span?.end !== 'number') continue;
    const start = Math.max(chunk.start, span.start);
    const end = Math.min(chunk.end, span.end);
    if (end - start < MIN_SCENE_SEC) continue;
    candidates.push({
      span: { start, end },
      label: typeof r.label === 'string' && r.label.trim() !== '' ? r.label.trim() : 'unlabeled',
      participants: Array.isArray(r.participants) ? (r.participants as string[]).slice(0, 8) : [],
      goal: typeof r.goal === 'string' ? r.goal : '',
      emotion: typeof r.emotion === 'string' ? r.emotion : '',
      events: Array.isArray(r.events) ? (r.events as string[]).slice(0, 5) : [],
      importance: clamp01(Number(r.importance)),
    });
  }
  candidates.sort((a, b) => a.span.start - b.span.start);
  const out: Omit<SceneNode, 'id'>[] = [];
  for (const c of candidates) {
    const prevEnd = out.length > 0 ? out[out.length - 1].span.end : -Infinity;
    const start = Math.max(c.span.start, prevEnd);
    if (c.span.end - start < MIN_SCENE_SEC) continue;
    out.push({ ...c, span: { start, end: c.span.end } });
  }
  return out;
}

export function validateEdges(raws: unknown[], sceneCount: number, arcCount: number): StoryEdge[] {
  const inRange = (ref: string): boolean => {
    const m = REF_RE.exec(ref);
    if (!m) return false;
    const idx = Number(m[2]);
    return m[1] === 'sc' ? idx < sceneCount : idx < arcCount;
  };
  const out: StoryEdge[] = [];
  for (const raw of raws) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.from !== 'string' || typeof r?.to !== 'string') continue;
    if (r.from === r.to) continue;
    if (!inRange(r.from) || !inRange(r.to)) continue;
    if (typeof r.type !== 'string' || !EDGE_TYPE_SET.has(r.type)) continue;
    const confidence = clamp01(Number(r.confidence));
    if (confidence < EDGE_MIN_CONFIDENCE) continue;
    out.push({ from: r.from, to: r.to, type: r.type as StoryEdgeType, confidence });
  }
  return out;
}
