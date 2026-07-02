import { describe, it, expect } from 'vitest';
import {
  planOverlays, filterCallouts, HOOK_CLEAR_SEC, TAIL_CLEAR_SEC, MIN_OVERLAY_SEC, MAX_COVERAGE,
} from '../../src/broll/planner.js';
import type { BrollCue, BrollKind } from '../../src/types/index.js';

const asset = (start: number, end: number, kind: BrollKind = 'person') => ({
  cue: { start, end, entity: 'e', kind, query: 'q' } as BrollCue,
  file: `/cache/${start}.mp4`,
  sourceUrl: 'u',
});

describe('planOverlays', () => {
  it('keeps the hook and payoff on the speaker', () => {
    const placed = planOverlays([asset(0, 6), asset(27, 31)], 30, { maxBroll: 4 });
    for (const p of placed) {
      expect(p.atSec).toBeGreaterThanOrEqual(HOOK_CLEAR_SEC);
      expect(p.atSec + p.durationSec).toBeLessThanOrEqual(30 - TAIL_CLEAR_SEC);
    }
  });
  it('enforces the per-mode cap and the spacing gap', () => {
    const placed = planOverlays([asset(4, 8), asset(9, 13), asset(14, 18), asset(20, 24)], 40, { maxBroll: 2 });
    expect(placed.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].atSec).toBeGreaterThanOrEqual(placed[i - 1].atSec + placed[i - 1].durationSec + 2);
    }
  });
  it('never covers more than 40% of the clip', () => {
    const placed = planOverlays([asset(4, 10), asset(13, 19), asset(22, 28)], 30, { maxBroll: 4 });
    const covered = placed.reduce((a, p) => a + p.durationSec, 0);
    expect(covered).toBeLessThanOrEqual(30 * MAX_COVERAGE + 1e-9);
  });
  it('prioritizes person/event footage over emotion garnish when capped', () => {
    const placed = planOverlays([asset(4, 8, 'emotion'), asset(12, 16, 'person')], 30, { maxBroll: 1 });
    expect(placed).toHaveLength(1);
    expect(placed[0].kind).toBe('person');
  });
  it('drops windows squeezed below the minimum', () => {
    const placed = planOverlays([asset(2, 4)], 30, { maxBroll: 4 }); // clamped to [3,4) → 1s < min
    expect(MIN_OVERLAY_SEC).toBeGreaterThan(1);
    expect(placed).toHaveLength(0);
  });
  it('results come back in timeline order', () => {
    const placed = planOverlays([asset(20, 24, 'person'), asset(5, 9, 'person')], 40, { maxBroll: 4 });
    expect(placed.map((p) => p.atSec)).toEqual([...placed.map((p) => p.atSec)].sort((a, b) => a - b));
  });
});

describe('filterCallouts', () => {
  it('drops callouts inside overlay windows (with margin), keeps the rest', () => {
    const overlays = [{ atSec: 10, durationSec: 4 }];
    const kept = filterCallouts([{ time: 5 }, { time: 11 }, { time: 14.3 }, { time: 20 }], overlays);
    expect(kept.map((c) => c.time)).toEqual([5, 20]);
  });
});
