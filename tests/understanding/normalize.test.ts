import { describe, expect, it } from 'vitest';
import { normalizeEdgeRaw, normalizeSceneRaw, normalizeUnderstandingRaw } from '../../src/understanding/normalize.js';

describe('normalizeUnderstandingRaw', () => {
  it('treats a bare top-level array as the arcs list (Gemini wrapper drop)', () => {
    const r = normalizeUnderstandingRaw([{ synopsis: 'x' }]);
    expect(r.arcs).toHaveLength(1);
    expect(r.scenes).toEqual([]);
    expect(r.edges).toEqual([]);
  });
  it('fills missing keys with empty arrays', () => {
    expect(normalizeUnderstandingRaw({ arcs: [] })).toEqual({ arcs: [], scenes: [], edges: [] });
    expect(normalizeUnderstandingRaw(null)).toEqual({ arcs: [], scenes: [], edges: [] });
  });
});

describe('normalizeSceneRaw', () => {
  it('coerces "a-b" string spans, string importance, scalar participants', () => {
    const s = normalizeSceneRaw({
      span: '12.9-31.3', label: 'gym bet', participants: 'S0',
      goal: 'win', emotion: 'hype', events: 'dunk', importance: '0.8',
    }) as Record<string, unknown>;
    expect(s.span).toEqual({ start: 12.9, end: 31.3 });
    expect(s.participants).toEqual(['S0']);
    expect(s.events).toEqual(['dunk']);
    expect(s.importance).toBe(0.8);
  });
  it('defaults missing importance to 0.5 and missing arrays to []', () => {
    const s = normalizeSceneRaw({ span: { start: 0, end: 5 }, label: 'x' }) as Record<string, unknown>;
    expect(s.importance).toBe(0.5);
    expect(s.participants).toEqual([]);
    expect(s.events).toEqual([]);
    expect(s.goal).toBe('');
    expect(s.emotion).toBe('');
  });
});

describe('normalizeEdgeRaw', () => {
  it('coerces confidence and lowercases the type', () => {
    const e = normalizeEdgeRaw({ from: 'sc0', to: 'arc1', type: 'Pays_Off', confidence: '0.7' }) as Record<string, unknown>;
    expect(e.type).toBe('pays_off');
    expect(e.confidence).toBe(0.7);
  });
  it('defaults missing confidence to 0.5', () => {
    const e = normalizeEdgeRaw({ from: 'sc0', to: 'sc1', type: 'escalates' }) as Record<string, unknown>;
    expect(e.confidence).toBe(0.5);
  });
});
