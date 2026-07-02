/**
 * No-repeat regeneration: every exported clip's time-range is recorded per source video,
 * and later runs on the same video drop candidates that overlap already-used material —
 * so "generate again" surfaces NEW moments. `--allow-repeats` bypasses the filter.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface UsedRange { start: number; end: number; clip_id: string; exportedAt: string; }

export function usedRangesPath(jobId: string): string {
  return join(process.env.WORKSPACE_DIR ?? './workspace', 'analysis', jobId, 'used_ranges.json');
}

export async function loadUsedRanges(jobId: string): Promise<UsedRange[]> {
  try { return JSON.parse(await readFile(usedRangesPath(jobId), 'utf8')); } catch { return []; }
}

export async function appendUsedRanges(jobId: string, ranges: UsedRange[]): Promise<void> {
  if (ranges.length === 0) return;
  const existing = await loadUsedRanges(jobId);
  const path = usedRangesPath(jobId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify([...existing, ...ranges], null, 2));
}

/**
 * PURE: drop candidates whose overlap with ANY used range exceeds `maxOverlap` as a
 * fraction of the candidate's own duration. 0.3 default: a clip sharing under a third
 * of its material with a previous export still counts as fresh.
 */
export function filterUsedCandidates<T extends { start: number; end: number }>(
  candidates: T[], used: { start: number; end: number }[], maxOverlap = 0.3,
): T[] {
  if (used.length === 0) return candidates;
  return candidates.filter((c) => {
    const dur = c.end - c.start;
    if (dur <= 0) return false;
    for (const u of used) {
      const inter = Math.max(0, Math.min(c.end, u.end) - Math.max(c.start, u.start));
      if (inter / dur > maxOverlap) return false;
    }
    return true;
  });
}
