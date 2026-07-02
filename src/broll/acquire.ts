/**
 * B-roll acquisition orchestrator (v6): cues (LLM) → YouTube search → relevance validation
 * (>8) → cached segment download → overlay plan. Entirely fail-soft: any stage failing means
 * the clip simply renders without B-roll. Sequential searches keep yt-dlp polite.
 */
import { logger } from '../utils/logger.js';
import type { BrollCandidate, BrollSegment, TranscriptSegment } from '../types/index.js';
import { extractCues } from './cues.js';
import { searchBroll } from './search.js';
import { validateMatches } from './validate.js';
import { downloadSegment, DEFAULT_BROLL_DIR } from './cache.js';
import { planOverlays, type BrollAsset } from './planner.js';

export interface AcquireOpts {
  segments: TranscriptSegment[];
  clipStart: number;
  clipEnd: number;
  sentiment?: string;
  maxBroll: number;
  cacheDir?: string;
  /** The source video's id — never use the video being clipped as its own B-roll. */
  excludeId?: string;
  label?: string;
}

export async function acquireBroll(opts: AcquireOpts): Promise<BrollSegment[]> {
  const label = opts.label ?? 'broll';
  try {
    const cues = await extractCues(opts.segments, opts.clipStart, opts.clipEnd, opts.sentiment);
    if (cues.length === 0) return [];
    logger.info(`[${label}] ${cues.length} cue(s): ${cues.map((c) => `"${c.query}"`).join(', ')}`);

    const candidates: BrollCandidate[][] = [];
    for (const cue of cues) {
      candidates.push(await searchBroll(cue.query, { excludeIds: opts.excludeId ? [opts.excludeId] : [] }));
    }

    const matches = await validateMatches(cues, candidates);
    if (matches.length === 0) {
      logger.info(`[${label}] no candidate passed relevance validation (>8)`);
      return [];
    }

    const assets: BrollAsset[] = [];
    for (const m of matches) {
      const cue = cues[m.cueIndex];
      const file = await downloadSegment(m.candidate, cue.end - cue.start, opts.cacheDir ?? DEFAULT_BROLL_DIR);
      if (file) assets.push({ cue, file, sourceUrl: m.candidate.url });
    }

    const overlays = planOverlays(assets, opts.clipEnd - opts.clipStart, { maxBroll: opts.maxBroll });
    if (overlays.length > 0) {
      logger.info(`[${label}] ${overlays.length} narrative overlay(s): ${overlays.map((o) => `${o.entity}@${o.atSec}s`).join(', ')}`);
    }
    return overlays;
  } catch (e) {
    logger.warn(`[${label}] B-roll acquisition failed (clip continues without): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
