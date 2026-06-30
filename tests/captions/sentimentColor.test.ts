import { describe, it, expect } from 'vitest';
import { sentimentColor } from '../../src/captions/sentimentColor.js';

describe('sentimentColor', () => {
  const fallback = '#FFD700';

  it('maps funny to green', () => {
    expect(sentimentColor('funny', fallback)).toBe('#22DD55');
  });

  it('maps serious to red', () => {
    expect(sentimentColor('serious', fallback)).toBe('#FF3B30');
  });

  it('maps intense to orange', () => {
    expect(sentimentColor('intense', fallback)).toBe('#FF8C00');
  });

  it('falls back for neutral', () => {
    expect(sentimentColor('neutral', fallback)).toBe(fallback);
  });

  it('falls back for undefined', () => {
    expect(sentimentColor(undefined, fallback)).toBe(fallback);
  });

  it('falls back for garbage/unknown values', () => {
    expect(sentimentColor('garbage', fallback)).toBe(fallback);
    expect(sentimentColor('', fallback)).toBe(fallback);
  });
});
