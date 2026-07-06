import { describe, it, expect } from 'vitest';
import { ReasonCode, tallyReasonCodes } from '../../src/report/reasonCodes.js';

describe('ReasonCode', () => {
  it('enum values equal their keys (stable serialized strings)', () => {
    for (const [k, v] of Object.entries(ReasonCode)) expect(v).toBe(k);
  });
});

describe('tallyReasonCodes', () => {
  it('counts occurrences', () => {
    const t = tallyReasonCodes([
      ReasonCode.DIRECTOR_NO_ARC_FOUND, ReasonCode.DIRECTOR_NO_ARC_FOUND, ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED,
    ]);
    expect(t[ReasonCode.DIRECTOR_NO_ARC_FOUND]).toBe(2);
    expect(t[ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED]).toBe(1);
    expect(t[ReasonCode.GPU_OOM_STEPDOWN]).toBeUndefined();
  });
  it('empty input → empty tally', () => {
    expect(tallyReasonCodes([])).toEqual({});
  });
});
