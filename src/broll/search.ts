/**
 * B-roll YouTube search (v6) — yt-dlp flat-playlist search, no downloads. Local-first:
 * yt-dlp is the only network path, same tool the ingest pipeline already requires.
 */
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import type { BrollCandidate } from '../types/index.js';

export const SEARCH_RESULTS = 5;
/** Candidate source length bounds: skip Shorts-length scraps and multi-hour VODs. */
export const MIN_SOURCE_SEC = 20;
export const MAX_SOURCE_SEC = 20 * 60;

/** PURE: yt-dlp args for a flat search — one JSON line per result, nothing downloaded. */
export function buildSearchArgs(query: string, n = SEARCH_RESULTS): string[] {
  return [`ytsearch${n}:${query}`, '--dump-json', '--flat-playlist', '--no-download', '--no-warnings'];
}

/** PURE: parse yt-dlp's JSON-lines search output into candidates (bad lines dropped). */
export function parseSearchOutput(stdout: string): BrollCandidate[] {
  const out: BrollCandidate[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const id = typeof j.id === 'string' ? j.id : null;
      const title = typeof j.title === 'string' ? j.title : null;
      if (!id || !title) continue;
      out.push({
        id,
        title,
        url: typeof j.url === 'string' ? j.url : `https://www.youtube.com/watch?v=${id}`,
        channel: typeof j.channel === 'string' ? j.channel : (typeof j.uploader === 'string' ? j.uploader : undefined),
        durationSec: typeof j.duration === 'number' ? j.duration : 0,
        ...(typeof j.view_count === 'number' ? { viewCount: j.view_count } : {}),
      });
    } catch { /* skip malformed line */ }
  }
  return out;
}

export interface SearchOpts {
  excludeIds?: string[];
  n?: number;
  /** Duration bounds (seconds); 0-duration (unknown) candidates are always kept. */
  minSec?: number;
  maxSec?: number;
}

/** PURE: drop the source video itself and out-of-range durations (0 = unknown, kept). */
export function filterCandidates(cands: BrollCandidate[], opts: SearchOpts = {}): BrollCandidate[] {
  const excluded = new Set(opts.excludeIds ?? []);
  const min = opts.minSec ?? MIN_SOURCE_SEC;
  const max = opts.maxSec ?? MAX_SOURCE_SEC;
  return cands.filter((c) => !excluded.has(c.id)
    && (c.durationSec === 0 || (c.durationSec >= min && c.durationSec <= max)));
}

/** Search YouTube for clip candidates. Never throws; [] on any failure. */
export async function searchBroll(query: string, opts: SearchOpts = {}): Promise<BrollCandidate[]> {
  try {
    const { stdout } = await run('yt-dlp', buildSearchArgs(query, opts.n ?? SEARCH_RESULTS), { stallMs: 60_000 });
    return filterCandidates(parseSearchOutput(stdout), opts);
  } catch (e) {
    logger.warn(`[broll-search] "${query}" failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
