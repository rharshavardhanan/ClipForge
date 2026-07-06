/**
 * Per-run report (v4 Part 1 §7.4 / Part 5 §A.3): one run_report.json per export dir
 * aggregating each clip's audit outcome + a tally of every reason code that fired. This is
 * the early-warning system for silent quality decay — you read it to see what degraded and
 * how often, without scrolling the console.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ReasonCode, tallyReasonCodes, type ReasonCodeCounts } from './reasonCodes.js';

export interface RunReportClip {
  clip_id: string;
  passed: boolean;
  degraded: boolean;
  degradations: ReasonCode[];
  predicted_retention?: number;
  tier: 'top' | 'below_retention';
}

export interface RunReport {
  run_id: string;
  created_at: string;
  source: string;
  clips: RunReportClip[];
  reason_code_counts: ReasonCodeCounts;
  summary: { total: number; passed: number; degraded: number; rejected: number };
}

/** PURE: assemble the report. `extraReasons` = run-level codes not tied to one clip. */
export function buildRunReport(
  runId: string, source: string, clips: RunReportClip[], extraReasons: ReasonCode[],
): RunReport {
  const allReasons = [...clips.flatMap((c) => c.degradations), ...extraReasons];
  return {
    run_id: runId,
    created_at: new Date().toISOString(),
    source,
    clips,
    reason_code_counts: tallyReasonCodes(allReasons),
    summary: {
      total: clips.length,
      passed: clips.filter((c) => c.passed).length,
      degraded: clips.filter((c) => c.degraded).length,
      rejected: clips.filter((c) => !c.passed).length,
    },
  };
}

export async function writeRunReport(dir: string, report: RunReport): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'run_report.json'), JSON.stringify(report, null, 2));
}
