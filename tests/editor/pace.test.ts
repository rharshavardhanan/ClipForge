import { describe, it, expect } from 'vitest';
import { paceTarget, paceToTighten } from '../../src/editor/pace.js';

describe('paceTarget', () => {
  it('clippies + fast dense speech paces higher than mindcuts + slow sparse', () => {
    const fast = paceTarget({ wordsPerSec: 3, meanRms: 8, mode: 'clippies' });
    const slow = paceTarget({ wordsPerSec: 1, meanRms: 3, mode: 'mindcuts' });
    expect(fast).toBeGreaterThan(slow);
  });
  it('is clamped to [0,1]', () => {
    expect(paceTarget({ wordsPerSec: 99, meanRms: 99, mode: 'clippies' })).toBeLessThanOrEqual(1);
    expect(paceTarget({ wordsPerSec: 0, meanRms: 0, mode: 'mindcuts' })).toBeGreaterThanOrEqual(0);
  });
});

describe('paceToTighten', () => {
  it('higher pace ⇒ shorter allowed silence + less breath', () => {
    const hi = paceToTighten(1);
    const lo = paceToTighten(0);
    expect(hi.maxInternalSilenceSec).toBeLessThan(lo.maxInternalSilenceSec);
    expect(hi.keepBreathSec).toBeLessThanOrEqual(lo.keepBreathSec);
  });
  it('keeps the protective fields', () => {
    const p = paceToTighten(0.5);
    expect(p.hookProtectSec).toBeGreaterThan(0);
    expect(p.payoffProtectSec).toBeGreaterThan(0);
  });
});
