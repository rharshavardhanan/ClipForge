import { describe, expect, it } from 'vitest';
import { validateEdges, validateScenes } from '../../src/understanding/validate.js';

const CHUNK = { start: 0, end: 540 };

describe('validateScenes', () => {
  it('clamps spans to the chunk, drops sub-3s scenes, trims overlaps in start order', () => {
    const out = validateScenes([
      { span: { start: -5, end: 30 }, label: 'intro', participants: [], goal: '', emotion: '', events: [], importance: 0.5 },
      { span: { start: 28, end: 60 }, label: 'bet', participants: [], goal: '', emotion: '', events: [], importance: 0.9 },
      { span: { start: 60, end: 61 }, label: 'sliver', participants: [], goal: '', emotion: '', events: [], importance: 0.5 },
    ], CHUNK);
    expect(out).toHaveLength(2);
    expect(out[0].span).toEqual({ start: 0, end: 30 });
    expect(out[1].span.start).toBe(30);            // overlap trimmed to prior end
  });
  it('drops structural garbage, clamps importance, caps events at 5', () => {
    const out = validateScenes([
      { span: { start: 0, end: 10 }, label: 'x', participants: [], goal: '', emotion: '', events: ['a','b','c','d','e','f'], importance: 7 },
      { nope: true },
      null,
    ], CHUNK);
    expect(out).toHaveLength(1);
    expect(out[0].importance).toBe(1);
    expect(out[0].events).toHaveLength(5);
  });
});

describe('validateEdges', () => {
  it('keeps only in-range refs, known types, confidence ≥ 0.3, no self-loops', () => {
    const out = validateEdges([
      { from: 'sc0', to: 'arc0', type: 'pays_off', confidence: 0.8 },   // keep
      { from: 'sc9', to: 'sc0', type: 'escalates', confidence: 0.8 },   // sc9 out of range
      { from: 'sc0', to: 'sc1', type: 'foreshadows', confidence: 0.8 }, // unknown type
      { from: 'sc0', to: 'sc1', type: 'escalates', confidence: 0.2 },   // below floor
      { from: 'sc1', to: 'sc1', type: 'callback', confidence: 0.9 },    // self-loop
    ], 2, 1);
    expect(out).toEqual([{ from: 'sc0', to: 'arc0', type: 'pays_off', confidence: 0.8 }]);
  });
});
