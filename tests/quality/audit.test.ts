import { describe, it, expect } from 'vitest';
import { runAudit } from '../../src/quality/audit.js';
import { DEFAULT_CUE_CONSTRAINTS } from '../../src/captions/captionCues.js';
import { SUBJECT_IN_FRAME_FLOOR } from '../../src/quality/gates.js';
import { ReasonCode } from '../../src/report/reasonCodes.js';

const good = {
  arc: { complete: true, missing: [] },
  cues: [{ start: 0, end: 2, lines: ['hello there'] }],
  cueConstraints: DEFAULT_CUE_CONSTRAINTS,
  measuredLufs: -14.2, targetLufs: -14,
  durationSec: 30, lenMin: 15, lenMax: 60,
  faces: [], cropTrack: null, subjectFloor: SUBJECT_IN_FRAME_FLOOR,
  upstreamReasons: [] as ReasonCode[],
};

describe('runAudit', () => {
  it('all good → passed, not degraded, 5 gates', () => {
    const q = runAudit(good);
    expect(q.passed).toBe(true);
    expect(q.degraded).toBe(false);
    expect(q.gates).toHaveLength(5);
  });

  it('caption overflow → not passed, reason surfaced', () => {
    const q = runAudit({ ...good, cues: [{ start: 0, end: 2, lines: ['a', 'b', 'c'] }] });
    expect(q.passed).toBe(false);
    expect(q.reasonCodes).toContain(ReasonCode.QUALITY_CAPTION_OVERFLOW);
  });

  it('upstream framing fallback → degraded even when all gates pass', () => {
    const q = runAudit({ ...good, upstreamReasons: [ReasonCode.FRAMING_FALLBACK_CENTER_CROP] });
    expect(q.passed).toBe(true);
    expect(q.degraded).toBe(true);
    expect(q.degradations).toContain(ReasonCode.FRAMING_FALLBACK_CENTER_CROP);
  });

  it('loudness autofix counts as a degradation', () => {
    const q = runAudit({ ...good, measuredLufs: -22 });
    expect(q.degraded).toBe(true);
    expect(q.reasonCodes).toContain(ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED);
  });

  it('never throws — a gate that errors becomes CF_AUDIT_GATE_ERROR', () => {
    // null measuredLufs makes the audio gate fail (not throw); force a throw via a poisoned cue
    const poisoned = { ...good, cues: null as unknown as typeof good.cues };
    const q = runAudit(poisoned);
    expect(q.passed).toBe(false);
    expect(q.reasonCodes).toContain(ReasonCode.CF_AUDIT_GATE_ERROR);
  });
});
