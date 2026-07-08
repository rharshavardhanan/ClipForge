/**
 * PURE Gemini-first tolerance layer for the unified response — the scene/edge
 * siblings of normalizeArcRaw: free-tier Gemini returns "a-b" string spans,
 * stringified numbers, scalars where arrays belong, and sometimes drops the
 * object wrapper entirely (a bare array IS the arcs list, matching today's
 * arc-mining tolerance). Garbage stays garbage — validation rejects downstream.
 */

function normalizeSpan(s: unknown): unknown {
  if (typeof s === 'string') {
    const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*$/);
    return m ? { start: Number(m[1]), end: Number(m[2]) } : s;
  }
  const sp = s as { start?: unknown; end?: unknown };
  if (sp && typeof sp === 'object' && sp.start !== undefined && sp.end !== undefined) {
    const start = Number(sp.start);
    const end = Number(sp.end);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }
  return s;
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string' && v.trim() !== '' ? [v] : [];

export function normalizeSceneRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  r.span = normalizeSpan(r.span);
  r.participants = asStringArray(r.participants);
  r.events = asStringArray(r.events);
  if (typeof r.label !== 'string') r.label = '';
  if (typeof r.goal !== 'string') r.goal = '';
  if (typeof r.emotion !== 'string') r.emotion = '';
  const imp = Number(r.importance);
  r.importance = Number.isFinite(imp) && r.importance !== undefined && r.importance !== null ? imp : 0.5;
  return r;
}

export function normalizeEdgeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (typeof r.type === 'string') r.type = r.type.trim().toLowerCase();
  const conf = Number(r.confidence);
  r.confidence = Number.isFinite(conf) && r.confidence !== undefined && r.confidence !== null ? conf : 0.5;
  return r;
}

export function normalizeUnderstandingRaw(raw: unknown): { arcs: unknown[]; scenes: unknown[]; edges: unknown[] } {
  if (Array.isArray(raw)) return { arcs: raw, scenes: [], edges: [] };  // wrapper-drop tolerance
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    arcs: Array.isArray(r.arcs) ? r.arcs : [],
    scenes: (Array.isArray(r.scenes) ? r.scenes : []).map(normalizeSceneRaw),
    edges: (Array.isArray(r.edges) ? r.edges : []).map(normalizeEdgeRaw),
  };
}
