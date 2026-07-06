import { describe, it, expect } from 'vitest';
import {
  narrativeGate, captionGate, audioGate, durationGate, subjectInFrameGate, SUBJECT_IN_FRAME_FLOOR,
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
  it('too-fast cue → fail QUALITY_CAPTION_OVERFLOW', () => {
    const cues = [{ start: 0, end: 1, lines: ['a'.repeat(60)] }];
    expect(captionGate(cues, DEFAULT_CUE_CONSTRAINTS).outcome.status).toBe('fail');
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
