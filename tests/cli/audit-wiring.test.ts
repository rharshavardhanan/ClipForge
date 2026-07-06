import { describe, it, expect } from 'vitest';
import { collectUpstreamReasons } from '../../src/cli/commands/all.js';
import { ReasonCode } from '../../src/report/reasonCodes.js';

describe('collectUpstreamReasons', () => {
  it('crop + center fallback → FRAMING_FALLBACK_CENTER_CROP', () => {
    expect(collectUpstreamReasons('crop', true, false)).toContain(ReasonCode.FRAMING_FALLBACK_CENTER_CROP);
  });
  it('below floor → CF_BELOW_RETENTION_FLOOR, no framing code on blur', () => {
    const r = collectUpstreamReasons('blur', false, true);
    expect(r).toContain(ReasonCode.CF_BELOW_RETENTION_FLOOR);
    expect(r).not.toContain(ReasonCode.FRAMING_FALLBACK_CENTER_CROP);
  });
  it('clean crop clip → no reasons', () => {
    expect(collectUpstreamReasons('crop', false, false)).toEqual([]);
  });
  it('center fallback only counts under crop framing', () => {
    expect(collectUpstreamReasons('blur', true, false)).toEqual([]);
  });
});
