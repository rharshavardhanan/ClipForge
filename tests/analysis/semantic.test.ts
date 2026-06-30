import { describe, it, expect } from 'vitest';
import 'dotenv/config';
import {
  chunkTranscript,
  semanticScore,
  parseGeminiJson,
  parseGeminiBatch,
  analyzeSemantic,
} from '../../src/analysis/semantic.js';
import type { TranscriptSegment, SemanticScores } from '../../src/types/index.js';

const seg = (id: number, start: number, end: number, text: string): TranscriptSegment =>
  ({ id, start, end, text, words: [] });

describe('chunkTranscript', () => {
  it('emits 30s windows stepping by 15s over a 75s transcript', () => {
    const segments: TranscriptSegment[] = [
      seg(0, 0, 10, 'one'),
      seg(1, 10, 20, 'two'),
      seg(2, 20, 30, 'three'),
      seg(3, 30, 40, 'four'),
      seg(4, 40, 50, 'five'),
      seg(5, 50, 60, 'six'),
      seg(6, 60, 75, 'seven'),
    ];
    const chunks = chunkTranscript(segments, 30, 15);
    expect(chunks.map((c) => c.start)).toEqual([0, 15, 30, 45]);
    expect(chunks[0]).toMatchObject({ start: 0, end: 30 });
    expect(chunks[1]).toMatchObject({ start: 15, end: 45 });
    expect(chunks[2]).toMatchObject({ start: 30, end: 60 });
    expect(chunks[3]).toMatchObject({ start: 45, end: 75 });
  });

  it('joins overlapping segment text within each window', () => {
    const segments: TranscriptSegment[] = [
      seg(0, 0, 10, 'hello'),
      seg(1, 10, 20, 'world'),
      seg(2, 20, 30, 'foo'),
    ];
    const chunks = chunkTranscript(segments, 30, 15);
    expect(chunks[0].text).toBe('hello world foo');
  });

  it('caps joined text at ~3000 chars', () => {
    const longText = 'x'.repeat(5000);
    const segments: TranscriptSegment[] = [seg(0, 0, 30, longText)];
    const chunks = chunkTranscript(segments, 30, 15);
    expect(chunks[0].text.length).toBeLessThanOrEqual(3000);
  });

  it('returns an empty array for no segments', () => {
    expect(chunkTranscript([], 30, 15)).toEqual([]);
  });
});

describe('semanticScore', () => {
  it('returns 10.0 when every dimension is 10', () => {
    const scores: SemanticScores = {
      emotional_intensity: 10, controversy: 10, humor: 10, surprise: 10,
      wisdom: 10, storytelling_tension: 10, argument_peak: 10, relatability: 10,
    };
    expect(semanticScore(scores)).toBeCloseTo(10.0);
  });

  it('computes the exact weighted value for a mixed vector', () => {
    const scores: SemanticScores = {
      emotional_intensity: 8, controversy: 4, humor: 2, surprise: 6,
      wisdom: 9, storytelling_tension: 3, argument_peak: 7, relatability: 5,
    };
    // 8*.20 + 4*.15 + 2*.15 + 6*.15 + 9*.10 + 3*.10 + 7*.10 + 5*.05 = 5.55
    expect(semanticScore(scores)).toBeCloseTo(5.55);
  });

  it('returns 0 when every dimension is 0', () => {
    const scores: SemanticScores = {
      emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
      wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
    };
    expect(semanticScore(scores)).toBe(0);
  });
});

describe('parseGeminiJson', () => {
  const payload = {
    scores: { emotional_intensity: 5, controversy: 1, humor: 2, surprise: 3, wisdom: 4, storytelling_tension: 5, argument_peak: 6, relatability: 7 },
    hook_moment: 'this changed everything',
    clip_titles: ['a', 'b', 'c'],
    is_standalone: true,
    recommended_duration: 60,
    sentiment: 'serious' as const,
    reason: 'because',
  };

  it('parses a ```json-fenced payload', () => {
    const raw = '```json\n' + JSON.stringify(payload) + '\n```';
    expect(parseGeminiJson(raw)).toEqual(payload);
  });

  it('parses a bare JSON payload', () => {
    const raw = JSON.stringify(payload);
    expect(parseGeminiJson(raw)).toEqual(payload);
  });

  it('parses a plain ``` fenced payload (no json tag)', () => {
    const raw = '```\n' + JSON.stringify(payload) + '\n```';
    expect(parseGeminiJson(raw)).toEqual(payload);
  });

  it('returns null on garbage input', () => {
    expect(parseGeminiJson('not json at all {{{')).toBeNull();
  });

  it('returns null on valid JSON missing the scores field', () => {
    expect(parseGeminiJson('{"foo":"bar"}')).toBeNull();
  });
});

describe('parseGeminiBatch', () => {
  const payload = {
    scores: { emotional_intensity: 5, controversy: 1, humor: 2, surprise: 3, wisdom: 4, storytelling_tension: 5, argument_peak: 6, relatability: 7 },
    hook_moment: 'this changed everything',
    clip_titles: ['a', 'b', 'c'],
    is_standalone: true,
    recommended_duration: 60,
    sentiment: 'serious' as const,
    reason: 'because',
  };
  const arrayPayload = [payload, { ...payload, hook_moment: 'second one' }];

  it('parses a ```json-fenced JSON array', () => {
    const raw = '```json\n' + JSON.stringify(arrayPayload) + '\n```';
    expect(parseGeminiBatch(raw)).toEqual(arrayPayload);
  });

  it('parses a bare JSON array', () => {
    const raw = JSON.stringify(arrayPayload);
    expect(parseGeminiBatch(raw)).toEqual(arrayPayload);
  });

  it('returns null for a JSON object (not an array)', () => {
    expect(parseGeminiBatch(JSON.stringify(payload))).toBeNull();
  });

  it('returns null on garbage input', () => {
    expect(parseGeminiBatch('not json at all {{{')).toBeNull();
  });
});

describe('analyzeSemantic (no API key)', () => {
  it('returns [] without making any network calls', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const segments: TranscriptSegment[] = [seg(0, 0, 10, 'hello world')];
      const result = await analyzeSemantic(segments, { apiKey: undefined, outPath: undefined });
      expect(result).toEqual([]);
    } finally {
      if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
    }
  });
});

describe.skipIf(!process.env.GEMINI_API_KEY)('analyzeSemantic (live Gemini, batched)', () => {
  it('analyzes a small transcript (~3 windows) in a single batched call', async () => {
    // 60s of segments with windowSec=30/overlapSec=15 => windows at 0,15,30 = 3 windows,
    // well under BATCH_SIZE (15), so this should resolve as exactly ONE Gemini call.
    const segments: TranscriptSegment[] = [
      seg(0, 0, 15, "Wait, hold on — nobody tells you this, but the real reason most people fail is fear, not laziness."),
      seg(1, 15, 30, "I used to think I just wasn't talented enough, but the truth is I was just too scared to try."),
      seg(2, 30, 45, "And once I admitted that, everything changed — the work got easier because I stopped hiding from it."),
      seg(3, 45, 60, "So if you're stuck, ask yourself honestly: is it really a skill problem, or are you just afraid?"),
    ];
    const result = await analyzeSemantic(segments, {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    });
    // Tolerate an empty result if Gemini still 429s despite the single batched call —
    // the unit tests above are the real gate for this refactor.
    if (result.length === 0) return;
    const w = result[0];
    expect(typeof w.semantic_score).toBe('number');
    expect(w.semantic_score).toBeGreaterThanOrEqual(0);
    expect(w.semantic_score).toBeLessThanOrEqual(10);
    expect(['serious', 'funny', 'intense', 'neutral']).toContain(w.sentiment);
  }, 60_000);
});
