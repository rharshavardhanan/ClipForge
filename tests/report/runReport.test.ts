import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRunReport, writeRunReport, type RunReportClip } from '../../src/report/runReport.js';
import { ReasonCode } from '../../src/report/reasonCodes.js';

const clips: RunReportClip[] = [
  { clip_id: 'clip_001', passed: true, degraded: false, degradations: [], predicted_retention: 0.7, tier: 'top' },
  { clip_id: 'clip_002', passed: true, degraded: true, degradations: [ReasonCode.FRAMING_FALLBACK_CENTER_CROP], predicted_retention: 0.6, tier: 'top' },
  { clip_id: 'clip_003', passed: false, degraded: true, degradations: [ReasonCode.CF_BELOW_RETENTION_FLOOR], predicted_retention: 0.4, tier: 'below_retention' },
];

describe('buildRunReport', () => {
  it('summarizes counts and tallies reason codes', () => {
    const r = buildRunReport('job1', 'https://y/w', clips, [ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED]);
    expect(r.summary.total).toBe(3);
    expect(r.summary.passed).toBe(2);
    expect(r.summary.degraded).toBe(2);
    expect(r.summary.rejected).toBe(1);
    expect(r.reason_code_counts[ReasonCode.FRAMING_FALLBACK_CENTER_CROP]).toBe(1);
    expect(r.reason_code_counts[ReasonCode.CF_BELOW_RETENTION_FLOOR]).toBe(1);
    expect(r.reason_code_counts[ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED]).toBe(1);
  });
});

describe('writeRunReport', () => {
  it('writes valid JSON to run_report.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runreport-'));
    const r = buildRunReport('job1', 'src', clips, []);
    await writeRunReport(dir, r);
    const back = JSON.parse(await readFile(join(dir, 'run_report.json'), 'utf8'));
    expect(back.run_id).toBe('job1');
    expect(back.clips).toHaveLength(3);
    expect(back.summary.total).toBe(3);
  });
});
