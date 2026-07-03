import { describe, it, expect } from 'vitest';
import {
  poolNormalize, rawVisualImpact, rawAudioHype, aHash, hamming, clipDistance, titleOverlap,
  collapseDupes, parseVirality, viewFallback, finalScore, pickCountdown, WEIGHTS,
  type ScoredClip,
} from '../../src/rankrot/score.js';

const curve = (vs: number[]) => vs.map((v, i) => ({ time: i, v }));

describe('poolNormalize', () => {
  it('maps min→0 max→10, flat pool → all 5', () => {
    expect(poolNormalize([1, 2, 3])).toEqual([0, 5, 10]);
    expect(poolNormalize([4, 4, 4])).toEqual([5, 5, 5]);
    expect(poolNormalize([])).toEqual([]);
  });
});

describe('raw layer signals', () => {
  it('explosive motion spikes beat flat high motion', () => {
    const spiky = rawVisualImpact(curve([1, 1, 1, 30, 1, 1]));
    const flat = rawVisualImpact(curve([8, 8, 8, 8, 8, 8]));
    expect(spiky).toBeGreaterThan(flat);
  });
  it('audio hype rewards peak lift over median + bass', () => {
    const hype = rawAudioHype(curve([2, 2, 9, 2]), curve([1, 8]));
    const monotone = rawAudioHype(curve([5, 5, 5, 5]), curve([0, 0]));
    expect(hype).toBeGreaterThan(monotone);
  });
});

describe('aHash / distances', () => {
  const bright = new Array(64).fill(200).map((v, i) => (i < 32 ? 255 : 0)); // half-half
  const brightCopy = [...bright];
  const inverted = bright.map((v) => 255 - v);
  it('identical frames → distance 0; inverted → 64', () => {
    expect(hamming(aHash(bright), aHash(brightCopy))).toBe(0);
    expect(hamming(aHash(bright), aHash(inverted))).toBe(64);
  });
  it('clipDistance is min pairwise; empty sets → 64', () => {
    expect(clipDistance([aHash(bright)], [aHash(brightCopy), aHash(inverted)])).toBe(0);
    expect(clipDistance([], [aHash(bright)])).toBe(64);
  });
  it('titleOverlap catches reposts', () => {
    expect(titleOverlap('CRAZIEST dunk of 2024!!', 'craziest dunk 2024 reaction')).toBeGreaterThan(0.7);
    expect(titleOverlap('best dunk', 'cooking pasta tutorial')).toBe(0);
  });
});

describe('collapseDupes', () => {
  const mk = (title: string, provisional: number, hash: number[]) =>
    ({ title, provisional, hashes: [aHash(hash)] });
  const A = new Array(64).fill(0).map((_, i) => (i % 2 ? 255 : 0));
  const B = new Array(64).fill(0).map((_, i) => (i < 32 ? 255 : 0));
  it('keeps the higher-scored copy of near-identical footage', () => {
    const { kept } = collapseDupes([mk('clip one', 3, A), mk('totally different', 5, A), mk('unique b', 4, B)]);
    expect(kept.map((k) => k.title)).toContain('totally different'); // higher provisional kept
    expect(kept.map((k) => k.title)).not.toContain('clip one');
    expect(kept).toHaveLength(2);
  });
  it('novelty: lone survivor gets 10', () => {
    const { novelty } = collapseDupes([mk('solo', 5, A)]);
    expect(novelty).toEqual([10]);
  });
});

describe('virality', () => {
  it('parseVirality fills valid entries over the fallback', () => {
    const out = parseVirality({ scores: [{ i: 0, score: 9 }, { i: 5, score: 10 }, { i: 1, score: 99 }] }, 2, [5, 5]);
    expect(out).toEqual([9, 10]); // i=5 out of range ignored; 99 clamped to 10
  });
  it('viewFallback log-scales views, neutral 5 when unknown', () => {
    const [tiny, huge, unknown] = viewFallback([100, 50_000_000, undefined]);
    expect(tiny).toBeLessThan(huge);
    expect(huge).toBeLessThanOrEqual(10);
    expect(unknown).toBe(5);
  });
});

describe('final score + countdown order', () => {
  const mkScored = (final: number, id: string): ScoredClip => ({
    candidate: { id, url: '', title: id, durationSec: 30 },
    momentFile: `${id}.mp4`, momentStart: 0, momentEnd: 5,
    layers: { visual: 0, audio: 0, reaction: 0, virality: 0, novelty: 0 }, final,
  });
  it('weights sum to 1 and finalScore applies them', () => {
    expect(WEIGHTS.visual + WEIGHTS.audio + WEIGHTS.reaction + WEIGHTS.virality + WEIGHTS.novelty).toBeCloseTo(1);
    expect(finalScore({ visual: 10, audio: 10, reaction: 10, virality: 10, novelty: 10 })).toBe(10);
    expect(finalScore({ visual: 10, audio: 0, reaction: 0, virality: 0, novelty: 0 })).toBeCloseTo(3.5);
  });
  it('pickCountdown returns #N first … #1 (the best) LAST — never reveal #1 early', () => {
    const picks = pickCountdown([mkScored(3, 'c'), mkScored(9, 'best'), mkScored(5, 'b'), mkScored(7, 'a'), mkScored(1, 'd'), mkScored(8, 'e')], 5);
    expect(picks).toHaveLength(5);
    expect(picks[picks.length - 1].candidate.id).toBe('best');
    expect(picks[0].final).toBeLessThanOrEqual(picks[1].final);
  });
});
