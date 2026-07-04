import { describe, expect, it } from 'vitest';
import { labelCounter, normalizeCounterRaw } from '../../src/montage/counter.js';

// labelCounter takes already-extracted keyframes (VisionImage[]), not a file path — this
// keeps the confidence/countable gate testable with a fake askFn and NO ffmpeg/filesystem
// I/O. The real-file wrapper (labelCounterForMoment) does extraction and is exercised only
// in live smoke, per the brief's split option (b).

describe('normalizeCounterRaw', () => {
  it('accepts the canonical shape', () => {
    expect(normalizeCounterRaw({ countable: true, label: 'PULLUP COUNTER', confidence: 0.9 }))
      .toEqual({ countable: true, label: 'PULLUP COUNTER', confidence: 0.9 });
  });
  it('tolerates a top-level array (free-tier Gemini habit)', () => {
    expect(normalizeCounterRaw([{ countable: true, label: 'REPS', confidence: 0.8 }])?.label).toBe('REPS');
  });
  it('missing confidence defaults to 0.5; garbage → null', () => {
    expect(normalizeCounterRaw({ countable: true, label: 'X' })?.confidence).toBe(0.5);
    expect(normalizeCounterRaw('nope')).toBeNull();
  });
  it('missing countable, non-string label, or null → null', () => {
    expect(normalizeCounterRaw({ label: 'X', confidence: 0.9 })).toBeNull();
    expect(normalizeCounterRaw({ countable: true, label: 42 })).toBeNull();
    expect(normalizeCounterRaw(null)).toBeNull();
  });
});

describe('labelCounter gate', () => {
  it('low confidence or not countable → null (never a wrong caption)', async () => {
    const no = async () => ({ countable: true, label: 'REPS', confidence: 0.4 });
    expect(await labelCounter([], no as never)).toBeNull();
    const notCountable = async () => ({ countable: false, label: 'TALKING', confidence: 0.95 });
    expect(await labelCounter([], notCountable as never)).toBeNull();
  });
  it('confidence exactly at the 0.6 threshold passes (gate is strictly <)', async () => {
    const borderline = async () => ({ countable: true, label: 'REPS', confidence: 0.6 });
    expect(await labelCounter([], borderline as never)).toBe('REPS');
  });
  it('confident + countable → uppercased label', async () => {
    const yes = async () => ({ countable: true, label: 'pullup counter', confidence: 0.9 });
    expect(await labelCounter([], yes as never)).toBe('PULLUP COUNTER');
  });
  it('blank label after trim → null', async () => {
    const blank = async () => ({ countable: true, label: '   ', confidence: 0.9 });
    expect(await labelCounter([], blank as never)).toBeNull();
  });
  it('long label is uppercased and truncated to 24 chars', async () => {
    const long = async () => ({ countable: true, label: 'a'.repeat(40), confidence: 0.9 });
    expect(await labelCounter([], long as never)).toBe('A'.repeat(24));
  });
  it('LLM unavailable (null) → null', async () => {
    expect(await labelCounter([], (async () => null) as never)).toBeNull();
  });
  it('askFn throwing is swallowed → null (never throws)', async () => {
    const boom = async () => { throw new Error('vision provider exploded'); };
    await expect(labelCounter([], boom as never)).resolves.toBeNull();
  });
});
