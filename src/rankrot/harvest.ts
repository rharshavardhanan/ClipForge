/**
 * RankRot clip harvest — multi-query YouTube search (yt-dlp; the only platform with a
 * search extractor — TikTok/IG/Reddit/X deferred, see design doc), dedupe, cap, and
 * cached full downloads WITH audio into ./rankrot_cache/. Fail-soft per candidate.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { searchBroll } from '../broll/search.js';
import type { BrollCandidate } from '../types/index.js';

export const DEFAULT_RANKROT_CACHE = './rankrot_cache';
export const HARVEST_CAP = 40;
/** Source bounds: skip sub-5s scraps; allow up to 30-min sources — the most popular
 *  material for many topics lives in mega-view compilations. Long sources are NOT
 *  downloaded whole: anything over HEAD_CUTOFF_SEC fetches only its first
 *  HEAD_SECTION_SEC (compilations front-load their best clips), and the moment
 *  detector extracts the 4-12s arc from that. */
export const MIN_CLIP_SRC_SEC = 5;
export const MAX_CLIP_SRC_SEC = 1800;
export const HEAD_CUTOFF_SEC = 480;
export const HEAD_SECTION_SEC = 240;
const DL_CONCURRENCY = 3;

export interface HarvestedClip {
  candidate: BrollCandidate;
  file: string;
}

/** AI-slop tells in titles/channels — the ranking editor only ranks REAL footage. */
const AI_SLOP_RE = /\bai\b|a\.i\.|ai[- ]?generat|\bsora\b|\bveo\s?\d?\b|midjourney|runway|pika|kling|\bluma\b|stable ?diffusion|text[- ]?to[- ]?video|animation|animated|cartoon|3d render|\bcgi\b|unreal engine|blender|no copyright|royalty[- ]?free/i;

/** PURE: true when a candidate smells like AI-generated / animated / stock slop. */
export function isLikelyAiSlop(c: BrollCandidate): boolean {
  return AI_SLOP_RE.test(`${c.title} ${c.channel ?? ''}`);
}

/** PURE: drop slop, then sort by popularity (view count desc; unknown views last). */
export function popularityFilter(cands: BrollCandidate[]): BrollCandidate[] {
  return cands
    .filter((c) => !isLikelyAiSlop(c))
    .sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
}

/** PURE: merge per-query results — dedupe by id keeping first occurrence, cap total. */
export function mergeCandidates(perQuery: BrollCandidate[][], cap = HARVEST_CAP): BrollCandidate[] {
  const seen = new Set<string>();
  const out: BrollCandidate[] = [];
  // Interleave queries round-robin so one query can't monopolize the pool.
  const maxLen = Math.max(0, ...perQuery.map((q) => q.length));
  for (let i = 0; i < maxLen && out.length < cap; i++) {
    for (const q of perQuery) {
      if (out.length >= cap) break;
      const c = q[i];
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/** PURE: yt-dlp args for one harvest download (video WITH audio, capped size).
 *  `headSec` limits the fetch to the source's opening section (long compilations). */
export function buildHarvestArgs(url: string, outPath: string, headSec?: number): string[] {
  return [
    url,
    '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    '--merge-output-format', 'mp4',
    '--max-filesize', '250M',
    '--no-playlist', '--no-warnings',
    '--retries', '5', '--fragment-retries', '5',
    ...(headSec ? ['--download-sections', `*0-${headSec}`, '--force-keyframes-at-cuts'] : []),
    '-o', outPath,
  ];
}

/** Search all query variants → dedupe → drop AI slop → most-viewed first → cap. */
export async function searchAll(queries: string[], perQuery = 12): Promise<BrollCandidate[]> {
  const results: BrollCandidate[][] = [];
  for (const q of queries) {
    const found = await searchBroll(q, { n: perQuery, minSec: MIN_CLIP_SRC_SEC, maxSec: MAX_CLIP_SRC_SEC });
    logger.info(`[rankrot-search] "${q}" → ${found.length} candidate(s)`);
    results.push(found);
  }
  const merged = mergeCandidates(results, Number.MAX_SAFE_INTEGER);
  const popular = popularityFilter(merged);
  const dropped = merged.length - popular.length;
  if (dropped > 0) logger.info(`[rankrot-search] ${dropped} AI/animated/stock candidate(s) filtered out`);
  return popular.slice(0, HARVEST_CAP);
}

/** Download all candidates into the cache (skip cached, drop failures). */
export async function downloadAll(
  candidates: BrollCandidate[], cacheDir = DEFAULT_RANKROT_CACHE,
): Promise<HarvestedClip[]> {
  await mkdir(cacheDir, { recursive: true });
  const out: (HarvestedClip | null)[] = new Array(candidates.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      const c = candidates[i];
      const file = join(cacheDir, `${c.id}.mp4`);
      if (existsSync(file)) { out[i] = { candidate: c, file }; continue; }
      const headSec = c.durationSec > HEAD_CUTOFF_SEC ? HEAD_SECTION_SEC : undefined;
      try {
        await withRetry(() => run('yt-dlp', buildHarvestArgs(c.url, file, headSec), { stallMs: 180_000 }),
          { attempts: 2, label: `rankrot-dl ${c.id}` });
        if (existsSync(file)) out[i] = { candidate: c, file };
      } catch (e) {
        logger.warn(`[rankrot-dl] ${c.id} dropped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DL_CONCURRENCY, candidates.length) }, worker));
  return out.filter((h): h is HarvestedClip => h !== null);
}
