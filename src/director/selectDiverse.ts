/**
 * Constrained clip selection (v4 Part 2 §5): choose the final set from arc survivors by a
 * greedy submodular-style objective — high composite + visual feasibility, minus a redundancy
 * penalty that grows as a topic (or source) gets over-represented. This is what stops a pack
 * from being six variations of one moment, and pulls framing-feasible clips up the order.
 * PURE + deterministic (tie-break by id).
 */
export interface Selectable {
  id: string;          // clip_id — tie-break
  composite: number;   // arc-weighted composite (~0-10)
  visual: number;      // visual feasibility 0-1
  topic: string;       // '' = unknown, never penalized against another unknown
  sourceId: string;    // jobId — cross-video redundancy
}

export const DIVERSITY_LAMBDA = 2.0;
export const VISUAL_SELECT_WEIGHT = 1.5;

function redundancy(item: Selectable, picked: Selectable[]): number {
  let sameTopic = 0;
  let sameSource = 0;
  for (const p of picked) {
    if (item.topic !== '' && p.topic === item.topic) sameTopic++;
    if (p.sourceId === item.sourceId) sameSource++;
  }
  return sameTopic + 0.5 * sameSource;
}

function adjusted(item: Selectable, picked: Selectable[]): number {
  return item.composite + VISUAL_SELECT_WEIGHT * item.visual - DIVERSITY_LAMBDA * redundancy(item, picked);
}

/** PURE: greedy pick of `top` maximizing adjusted score; recompute redundancy each round. */
export function selectDiverse(items: Selectable[], top: number): Selectable[] {
  const remaining = [...items];
  const picked: Selectable[] = [];
  while (picked.length < top && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const score = adjusted(remaining[i], picked);
      // ties resolve to the lexicographically smaller id for determinism
      if (score > bestScore || (score === bestScore && remaining[i].id < remaining[bestIdx].id)) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  return picked;
}
