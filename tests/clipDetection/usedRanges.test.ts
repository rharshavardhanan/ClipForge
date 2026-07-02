import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterUsedCandidates, loadUsedRanges, appendUsedRanges } from '../../src/clipDetection/usedRanges.js';

describe('filterUsedCandidates', () => {
  const cands = [
    { start: 0, end: 20 },    // fully inside a used range
    { start: 18, end: 40 },   // small overlap (2s / 22s ≈ 9%)
    { start: 100, end: 130 }, // untouched
  ];
  const used = [{ start: 0, end: 20 }];

  it('drops candidates overlapping a used range by more than 30% of their duration', () => {
    const kept = filterUsedCandidates(cands, used);
    expect(kept).toEqual([{ start: 18, end: 40 }, { start: 100, end: 130 }]);
  });
  it('no used ranges → everything kept', () => {
    expect(filterUsedCandidates(cands, [])).toEqual(cands);
  });
  it('threshold is configurable', () => {
    expect(filterUsedCandidates([{ start: 18, end: 40 }], used, 0.05)).toEqual([]);
  });
});

describe('load/append roundtrip', () => {
  it('missing file → [], append persists and accumulates', async () => {
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), 'used-'));
    expect(await loadUsedRanges('job1')).toEqual([]);
    await appendUsedRanges('job1', [{ start: 5, end: 25, clip_id: 'clip_001', exportedAt: 't1' }]);
    await appendUsedRanges('job1', [{ start: 60, end: 80, clip_id: 'clip_002', exportedAt: 't2' }]);
    const all = await loadUsedRanges('job1');
    expect(all).toHaveLength(2);
    expect(all[1].clip_id).toBe('clip_002');
    expect(await loadUsedRanges('otherjob')).toEqual([]);
  });
});
