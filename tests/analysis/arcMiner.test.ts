import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mergeMinedCandidates, mineArcs, miningPrompt, overlapFraction } from '../../src/analysis/arcMiner.js';
import type { ArcLabel, ClipCandidate, TranscriptSegment } from '../../src/types/index.js';
import type { TranscriptChunk } from '../../src/analysis/arcChunker.js';

const seg = (start: number, end: number): TranscriptSegment =>
  ({ id: Math.round(start), start, end, text: `t${start}`, words: [] });
const chunk: TranscriptChunk = { start: 0, end: 540, segments: [seg(0, 10), seg(10, 20)] };
const fullComponents = {
  setup: { start: 10, end: 13 }, trigger: { start: 12, end: 13 }, escalation: { start: 13, end: 16 },
  peak: { start: 16, end: 18 }, payoff: { start: 18, end: 21 }, reaction: { start: 21, end: 25 },
};
const goodArcRaw = { synopsis: 'fail then scream', confidence: 0.9, components: fullComponents, reactionAfterPeak: true };

describe('miningPrompt', () => {
  it('carries transcript, evidence, mode vocabulary, and the brief/overlapping rule', () => {
    const p = miningPrompt(chunk, 'EVIDENCE', 'clippies');
    expect(p).toContain('t0');
    expect(p).toContain('EVIDENCE');
    expect(p).toMatch(/fail/i);            // clippies vocabulary
    expect(p).toMatch(/overlap/i);         // brief-or-overlapping rule stated
    const p2 = miningPrompt(chunk, 'E', 'mindcuts');
    expect(p2).toMatch(/insight/i);        // mindcuts vocabulary
  });
});

describe('mineArcs', () => {
  it('asks once per chunk, validates, caches incrementally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arcs-'));
    const cachePath = join(dir, 'layer_arcs_gemini.json');
    const ask = vi.fn().mockResolvedValue({ arcs: [goodArcRaw, { junk: true }] });
    const arcs = await mineArcs([chunk], () => 'E', { cachePath, durationSec: 600, mode: 'clippies', ask });
    expect(arcs).toHaveLength(1);
    expect(arcs[0].confidence).toBe(0.9);
    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    expect(cached.chunks['0-540']).toHaveLength(1);
    // second run: cache hit, no ask
    const ask2 = vi.fn();
    const again = await mineArcs([chunk], () => 'E', { cachePath, durationSec: 600, mode: 'clippies', ask: ask2 });
    expect(again).toHaveLength(1);
    expect(ask2).not.toHaveBeenCalled();
  });
  it('failed chunk yields no arcs and is NOT cached (retryable)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arcs-'));
    const cachePath = join(dir, 'layer_arcs_gemini.json');
    const ask = vi.fn().mockResolvedValue(null);
    expect(await mineArcs([chunk], () => 'E', { cachePath, durationSec: 600, mode: 'clippies', ask })).toEqual([]);
    const cached = JSON.parse(await readFile(cachePath, 'utf8').catch(() => '{"chunks":{}}'));
    expect(cached.chunks['0-540']).toBeUndefined();
  });
});

describe('overlapFraction / mergeMinedCandidates', () => {
  const cand: ClipCandidate = { start: 10, end: 25, composite: 6, triggerScore: 3, audioScore: 3 };
  const arc: ArcLabel = { synopsis: 's', confidence: 0.9, components: fullComponents, reactionAfterPeak: true };
  it('overlapFraction uses the smaller span as denominator', () => {
    expect(overlapFraction({ start: 0, end: 10 }, { start: 5, end: 25 })).toBe(0.5);
  });
  it('≥50% overlap → existing candidate gains the label and keeps its composite', () => {
    const out = mergeMinedCandidates([cand], [arc]);
    expect(out).toHaveLength(1);
    expect(out[0].composite).toBe(6);
    expect(out[0].arc?.synopsis).toBe('s');
  });
  it('a stronger label replaces a weaker one on the same host', () => {
    const weak: ArcLabel = { ...arc, confidence: 0.2, synopsis: 'weak' };
    const out = mergeMinedCandidates([{ ...cand, arc: weak }], [arc]);
    expect(out[0].arc?.synopsis).toBe('s');
  });
  it('disjoint arc becomes a new candidate with composite = 10×arcScore', () => {
    const far: ArcLabel = {
      ...arc,
      components: {
        setup: { start: 100, end: 103 }, trigger: { start: 101, end: 102 },
        escalation: { start: 103, end: 105 }, peak: { start: 105, end: 107 },
        payoff: { start: 107, end: 110 }, reaction: { start: 110, end: 115 },
      },
    };
    const out = mergeMinedCandidates([cand], [far]);
    expect(out).toHaveLength(2);
    const mined = out.find((c) => c.start === 100)!;
    expect(mined.composite).toBeCloseTo(10 * Math.min(1, 0.9 * 1.15));
    expect(mined.end).toBe(115);
  });
});
