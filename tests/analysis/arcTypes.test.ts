import { describe, expect, it } from 'vitest';
import {
  ARC_COMPONENT_NAMES, arcOuterSpan, arcScore, missingComponents, validateArc,
} from '../../src/analysis/arcTypes.js';

const full = {
  setup: { start: 10, end: 14 }, trigger: { start: 13, end: 14 },
  escalation: { start: 14, end: 18 }, peak: { start: 18, end: 20 },
  payoff: { start: 20, end: 23 }, reaction: { start: 22, end: 26 },
};

describe('missingComponents', () => {
  it('empty for a full arc, names absentees in canonical order', () => {
    expect(missingComponents(full)).toEqual([]);
    const { trigger, payoff, ...rest } = full;
    expect(missingComponents(rest)).toEqual(['trigger', 'payoff']);
  });
});

describe('ARC_COMPONENT_NAMES', () => {
  it('is the six-part canon in story order', () => {
    expect(ARC_COMPONENT_NAMES).toEqual(['setup', 'trigger', 'escalation', 'peak', 'payoff', 'reaction']);
  });
});

describe('arcOuterSpan', () => {
  it('min start to max end; null when empty', () => {
    expect(arcOuterSpan(full)).toEqual({ start: 10, end: 26 });
    expect(arcOuterSpan({})).toBeNull();
  });
});

describe('validateArc', () => {
  const raw = { synopsis: 's', confidence: 0.8, components: full };
  it('accepts a well-formed label', () => {
    expect(validateArc(raw, 100)?.confidence).toBe(0.8);
  });
  it('rejects non-objects, missing synopsis, bad confidence, and zero valid components', () => {
    expect(validateArc(null, 100)).toBeNull();
    expect(validateArc({ ...raw, synopsis: '' }, 100)).toBeNull();
    expect(validateArc({ ...raw, confidence: 'high' }, 100)).toBeNull();
    expect(validateArc({ ...raw, components: {} }, 100)).toBeNull();
  });
  it('drops spans outside the source and sub-0.5s spans, keeping the rest (gate enforces 6/6, not the parser)', () => {
    const outOfBounds = validateArc({ ...raw, components: { ...full, peak: { start: 90, end: 120 } } }, 100);
    expect(outOfBounds?.components.peak).toBeUndefined();
    expect(outOfBounds?.components.setup).toEqual(full.setup);
    const tooShort = validateArc({ ...raw, components: { ...full, trigger: { start: 13, end: 13.2 } } }, 100);
    expect(tooShort?.components.trigger).toBeUndefined();
  });
  it('drops malformed component entries but keeps valid ones (partial arcs allowed)', () => {
    const v = validateArc({ ...raw, components: { setup: full.setup, peak: 'nope' } }, 100);
    expect(v?.components).toEqual({ setup: full.setup });
  });
  it('carries reactionAfterPeak only when boolean', () => {
    expect(validateArc({ ...raw, reactionAfterPeak: true }, 100)?.reactionAfterPeak).toBe(true);
    expect(validateArc({ ...raw, reactionAfterPeak: 'yes' }, 100)?.reactionAfterPeak).toBeUndefined();
  });
  it('clamps confidence to [0,1]', () => {
    expect(validateArc({ ...raw, confidence: 7 }, 100)?.confidence).toBe(1);
  });
});

describe('arcScore', () => {
  it('confidence × completeness × reaction bonus, clamped to [0,1]', () => {
    expect(arcScore({ confidence: 0.8, components: full })).toBeCloseTo(0.8);
    expect(arcScore({ confidence: 0.8, components: full, reactionAfterPeak: true })).toBeCloseTo(Math.min(1, 0.8 * 1.15));
    const { trigger, escalation, ...four } = full;
    expect(arcScore({ confidence: 0.9, components: four })).toBeCloseTo(0.9 * (4 / 6));
    expect(arcScore({ confidence: 1, components: full, reactionAfterPeak: true })).toBe(1);
  });
});

// ---- Gemini-shape normalization (free-tier responses are structurally loose) ---------------
import { normalizeArcRaw } from '../../src/analysis/arcTypes.js';

describe('normalizeArcRaw', () => {
  it('coerces "a-b" string spans and flattened component keys into the canonical shape', () => {
    const loose = {
      setup: '12.9-31.3', trigger: '31.3-36.8', escalation: '36.8-57.4',
      peak: '57.4-77.8', payoff: '77.8-93.6', reaction: '104.3-110.3',
      reactionAfterPeak: true,
    };
    const v = validateArc(normalizeArcRaw(loose), 400);
    expect(v).not.toBeNull();
    expect(v?.components.setup).toEqual({ start: 12.9, end: 31.3 });
    expect(v?.components.reaction).toEqual({ start: 104.3, end: 110.3 });
    expect(v?.reactionAfterPeak).toBe(true);
  });
  it('defaults missing confidence to the 0.5 neutral prior and synopsis to a placeholder', () => {
    const v = validateArc(normalizeArcRaw({ components: { setup: '1-5', peak: '5-9' } }), 100);
    expect(v?.confidence).toBe(0.5);
    expect(v?.synopsis.length).toBeGreaterThan(0);
  });
  it('coerces string-number span fields and string bounds', () => {
    const n: any = normalizeArcRaw({ synopsis: 's', confidence: 0.7, components: { peak: { start: '5', end: '9' } }, bounds: '2-20' });
    expect(n.components.peak).toEqual({ start: 5, end: 9 });
    expect(n.bounds).toEqual({ start: 2, end: 20 });
  });
  it('leaves garbage alone (still rejected downstream)', () => {
    expect(validateArc(normalizeArcRaw({ junk: true }), 100)).toBeNull();
    expect(normalizeArcRaw(null)).toBeNull();
  });
});
