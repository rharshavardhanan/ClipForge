import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_LINES, buildEvidenceBlock, downsampleCurve } from '../../src/analysis/arcEvidence.js';

const ramp = (n: number, dt: number) => Array.from({ length: n }, (_, i) => ({ time: i * dt, v: i }));

describe('downsampleCurve', () => {
  it('buckets to stepSec means within the span only', () => {
    const out = downsampleCurve(ramp(100, 0.5), { start: 10, end: 20 }, 2); // times 10..20
    expect(out).toHaveLength(5);
    expect(out[0].time).toBe(10);
    expect(out[0].v).toBeCloseTo((20 + 21 + 22 + 23) / 4); // points at 10,10.5,11,11.5 → v=20..23
  });
  it('empty span or no points → []', () => {
    expect(downsampleCurve([], { start: 0, end: 10 })).toEqual([]);
  });
});

describe('buildEvidenceBlock', () => {
  it('mentions rms, motion, silences, faces and stays under the line cap', () => {
    const block = buildEvidenceBlock({
      window: { start: 0, end: 600 },
      rms: ramp(1200, 0.5), motion: ramp(4800, 0.125),
      silences: [{ start: 5, end: 8 }],
      facesPerSec: ramp(600, 1),
    });
    expect(block).toMatch(/audio rms/i);
    expect(block).toMatch(/motion/i);
    expect(block).toMatch(/silence 5\.0-8\.0/i);
    expect(block).toMatch(/faces/i);
    expect(block.split('\n').length).toBeLessThanOrEqual(MAX_EVIDENCE_LINES);
    expect(block).not.toMatch(/\d\.\d{2,}/); // 1-decimal rounding everywhere
  });
  it('omits sections that have no data', () => {
    const block = buildEvidenceBlock({ window: { start: 0, end: 30 }, rms: [], motion: [] });
    expect(block).not.toMatch(/silence/i);
    expect(block).not.toMatch(/faces/i);
  });
});
