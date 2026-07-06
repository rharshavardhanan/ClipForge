import { describe, it, expect } from 'vitest';
import { PLATFORM_SAFE_AREA, captionBandRect } from '../../src/quality/safeArea.js';

describe('PLATFORM_SAFE_AREA', () => {
  it('reserves plausible fractions on every edge', () => {
    for (const v of Object.values(PLATFORM_SAFE_AREA)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(0.5);
    }
  });
});

describe('captionBandRect', () => {
  it('sits just above the bottom UI, ordered, in-frame', () => {
    const b = captionBandRect();
    expect(b.yTop).toBeLessThan(b.yBottom);
    expect(b.yTop).toBeGreaterThan(0);
    expect(b.yBottom).toBeLessThanOrEqual(1);
    expect(b.yBottom).toBeCloseTo(1 - PLATFORM_SAFE_AREA.bottom);
  });
});
