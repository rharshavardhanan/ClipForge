import { describe, it, expect } from 'vitest';
import { aspectDims } from '../../src/extraction/aspect.js';

describe('aspectDims', () => {
  it('maps aspect flags to output dims', () => {
    expect(aspectDims('9:16')).toEqual({ outW: 1080, outH: 1920, ratio: 9 / 16 });
    expect(aspectDims('3:4')).toEqual({ outW: 1080, outH: 1440, ratio: 3 / 4 });
    expect(() => aspectDims('4:3')).toThrow(/aspect/);
  });
});
