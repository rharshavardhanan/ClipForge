/** PURE: ≤12-line scene-graph context for the arc-completion prompt — evidence,
 *  never policy (the 6/6 gate is unchanged). */
import type { ArcSpan } from '../types/index.js';
import type { UnderstandingResult } from './types.js';

const MAX_SCENE_LINES = 6;
const MAX_EDGE_LINES = 6;

export function renderUnderstandingContext(u: UnderstandingResult | null, window: ArcSpan): string {
  if (!u) return '';
  const scenes = u.scenes.filter((s) => s.span.end > window.start && s.span.start < window.end).slice(0, MAX_SCENE_LINES);
  if (scenes.length === 0) return '';
  const ids = new Set(scenes.map((s) => s.id));
  const edges = u.edges
    .filter((e) => ids.has(e.from) || ids.has(e.to) || e.from.startsWith('arc') || e.to.startsWith('arc'))
    .slice(0, MAX_EDGE_LINES);
  const lines = scenes.map((s) =>
    `[${s.span.start.toFixed(1)}-${s.span.end.toFixed(1)}] ${s.label}${s.goal ? ` — ${s.goal}` : ''}${s.emotion ? ` (${s.emotion})` : ''}`);
  for (const e of edges) lines.push(`${e.from} -${e.type}-> ${e.to} (${e.confidence.toFixed(2)})`);
  return lines.join('\n');
}
