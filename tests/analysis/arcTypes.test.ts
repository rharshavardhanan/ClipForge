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
