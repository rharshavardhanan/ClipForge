import { describe, it, expect } from 'vitest';
import {
  narrativeGate, captionGate, audioGate, durationGate, subjectInFrameGate, cutIntegrityGate, SUBJECT_IN_FRAME_FLOOR,
} from '../../src/quality/gates.js';
import { DEFAULT_CUE_CONSTRAINTS } from '../../src/captions/captionCues.js';
import { ReasonCode } from '../../src/report/reasonCodes.js';
import type { CropKeyframe, FaceSample } from '../../src/types/index.js';

describe('narrativeGate', () => {
  it('complete arc → pass', () => {
    expect(narrativeGate({ complete: true, missing: [] }).outcome.status).toBe('pass');
  });
  it('incomplete arc → fail DIRECTOR_NO_ARC_FOUND', () => {
    const o = narrativeGate({ complete: false, missing: ['payoff'] }).outcome;
    expect(o.status).toBe('fail');
    if (o.status === 'fail') expect(o.reason).toBe(ReasonCode.DIRECTOR_NO_ARC_FOUND);
  });
  it('no arc stage (undefined) → pass', () => {
    expect(narrativeGate(undefined).outcome.status).toBe('pass');
  });
});

describe('captionGate', () => {
  it('clean cues → pass', () => {
    const cues = [{ start: 0, end: 2, lines: ['hello there'] }];
    expect(captionGate(cues, DEFAULT_CUE_CONSTRAINTS).outcome.status).toBe('pass');
  });
  it('over-line cue → fail QUALITY_CAPTION_OVERFLOW', () => {
    const cues = [{ start: 0, end: 2, lines: ['a', 'b', 'c'] }];
    const o = captionGate(cues, DEFAULT_CUE_CONSTRAINTS).outcome;
    expect(o.status).toBe('fail');
    if (o.status === 'fail') expect(o.reason).toBe(ReasonCode.QUALITY_CAPTION_OVERFLOW);
  });
  it('too-fast cue (within line limits) → advisory autofix, not a hard fail', () => {
    // 20 chars in 0.5s = 40 cps > 27, but one line ≤ 24 chars → layout is fine, speed is advisory
    const cues = [{ start: 0, end: 0.5, lines: ['twenty chars exactly'] }];
    expect(captionGate(cues, DEFAULT_CUE_CONSTRAINTS).outcome.status).toBe('autofix');
  });
});

describe('audioGate', () => {
  it('within ±1 LUFS → pass', () => {
    expect(audioGate(-14.4, -14).outcome.status).toBe('pass');
  });
  it('adjusted (far from target but measured) → autofix', () => {
    expect(audioGate(-20, -14).outcome.status).toBe('autofix');
  });
  it('unmeasured → fail CF_AUDIT_GATE_ERROR', () => {
    const o = audioGate(null, -14).outcome;
    expect(o.status).toBe('fail');
    if (o.status === 'fail') expect(o.reason).toBe(ReasonCode.CF_AUDIT_GATE_ERROR);
  });
});

describe('durationGate', () => {
  it('in bounds → pass, out → fail', () => {
    expect(durationGate(30, 15, 60).outcome.status).toBe('pass');
    expect(durationGate(9, 15, 60).outcome.status).toBe('fail');
  });
});

describe('subjectInFrameGate', () => {
  const face = (time: number, x: number, y: number): FaceSample => ({ time, box: { x, y, w: 100, h: 120 } });
  const win: CropKeyframe = { time: 0, cx: 500, cy: 500, cropW: 600, cropH: 1067 };

  it('blur framing (null track) → pass', () => {
    expect(subjectInFrameGate([face(0, 450, 440)], null, SUBJECT_IN_FRAME_FLOOR).outcome.status).toBe('pass');
  });
  it('faces inside the crop window → pass', () => {
    const faces = [face(0, 450, 440), face(0.5, 460, 450)];
    expect(subjectInFrameGate(faces, [win], SUBJECT_IN_FRAME_FLOOR).outcome.status).toBe('pass');
  });
  it('faces far outside → fail QUALITY_SUBJECT_OUT_OF_FRAME', () => {
    const faces = [face(0, 1700, 100), face(0.5, 1750, 120)];
    const o = subjectInFrameGate(faces, [win], SUBJECT_IN_FRAME_FLOOR).outcome;
    expect(o.status).toBe('fail');
    if (o.status === 'fail') expect(o.reason).toBe(ReasonCode.QUALITY_SUBJECT_OUT_OF_FRAME);
  });
  it('no faces at all → pass (nothing to keep in frame)', () => {
    expect(subjectInFrameGate([], [win], SUBJECT_IN_FRAME_FLOOR).outcome.status).toBe('pass');
  });
});

describe('cutIntegrityGate (v4 Slice C)', () => {
  const cw = (start: number, end: number, text = 'w') => ({ text, start, end, emphasized: false });
  it('identity keep (one span) → pass', () => {
    expect(cutIntegrityGate([{ start: 0, end: 30 }], [cw(4.8, 5.3)]).outcome.status).toBe('pass');
  });
  it('a boundary inside a word → fail EDITOR_CUT_ON_NON_BOUNDARY', () => {
    // segments [0,5]+[8,12]: boundaries 5 and 8; a word [4.8,5.3] straddles 5
    const o = cutIntegrityGate([{ start: 0, end: 5 }, { start: 8, end: 12 }], [cw(4.8, 5.3)]).outcome;
    expect(o.status).toBe('fail');
    if (o.status === 'fail') expect(o.reason).toBe(ReasonCode.EDITOR_CUT_ON_NON_BOUNDARY);
  });
  it('boundaries in inter-word gaps → pass', () => {
    // word ends at 4.9, next starts at 8.1; boundaries 5 and 8 fall in the gap
    const words = [cw(4.0, 4.9), cw(8.1, 9.0)];
    expect(cutIntegrityGate([{ start: 0, end: 5 }, { start: 8, end: 12 }], words).outcome.status).toBe('pass');
  });
});
