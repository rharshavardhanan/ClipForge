/**
 * RL engine data layer — real YouTube performance for uploaded clips:
 *  - Data API v3 videos.list (views/likes/comments) via the existing youtube.readonly scope
 *  - Analytics API v2 (averageViewPercentage / averageViewDuration / shares) via the
 *    yt-analytics.readonly scope (added 2026-07-03 — tokens minted earlier lack it and
 *    degrade to `partial` snapshots that never update the policy)
 *  - the spec reward: 0.35 retention + 0.20 completion + 0.20 rewatch + 0.10 likes +
 *    0.10 comments + 0.05 shares, where Shorts looping past 100% avgViewPct is literal
 *    rewatch signal.
 * Snapshots are append-only history at workspace/performance/<videoId>.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { clamp01 } from './editPlan.js';

export interface VideoStats { views: number; likes: number; comments: number; }
export interface AnalyticsStats { avgViewPct: number; avgViewDurationSec: number; shares: number; }

export interface RewardBreakdown {
  reward: number;
  retention: number; completion: number; rewatch: number;
  likesNorm: number; commentsNorm: number; sharesNorm: number;
  partial: boolean;      // true = analytics unavailable — do NOT feed the policy
}

/** PURE: spec reward formula. No analytics → engagement-only components, partial:true. */
export function computeReward(durationSec: number, stats: VideoStats, analytics?: AnalyticsStats): RewardBreakdown {
  const views = Math.max(0, stats.views);
  const likesNorm = views > 0 ? Math.min(1, (20 * stats.likes) / views) : 0;
  const commentsNorm = views > 0 ? Math.min(1, (200 * stats.comments) / views) : 0;

  const raw = analytics ? analytics.avgViewPct / 100 : 0;
  const retention = Math.min(1, raw);
  const rewatch = Math.min(1, Math.max(0, raw - 1) * 2);
  const completion = analytics && durationSec > 0
    ? Math.min(1, analytics.avgViewDurationSec / durationSec) : 0;
  const sharesNorm = analytics && views > 0 ? Math.min(1, (100 * analytics.shares) / views) : 0;

  const reward = clamp01(
    0.35 * retention + 0.20 * completion + 0.20 * rewatch +
    0.10 * likesNorm + 0.10 * commentsNorm + 0.05 * sharesNorm,
  );
  return { reward, retention, completion, rewatch, likesNorm, commentsNorm, sharesNorm, partial: !analytics };
}

/** Data API v3: statistics for up to 50 ids per call (chunked). Missing stats → zeros. */
export async function fetchVideoStats(
  ids: string[], token: string, fetchFn: typeof fetch = fetch,
): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(',')}`;
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason ?? '';
      throw new Error(`videos.list failed (${res.status}${reason ? ` ${reason}` : ''})`);
    }
    const j: any = await res.json();
    for (const item of j.items ?? []) {
      out.set(item.id, {
        views: Number(item.statistics?.viewCount ?? 0),
        likes: Number(item.statistics?.likeCount ?? 0),
        comments: Number(item.statistics?.commentCount ?? 0),
      });
    }
  }
  return out;
}

/**
 * Analytics API v2 for one video. Returns:
 *  - AnalyticsStats on success
 *  - 'no-scope' when the token predates the yt-analytics.readonly scope (401/403)
 *  - undefined when the report has no rows yet (fresh upload)
 */
export async function fetchAnalytics(
  videoId: string, token: string, fetchFn: typeof fetch = fetch,
): Promise<AnalyticsStats | 'no-scope' | undefined> {
  const u = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  u.searchParams.set('ids', 'channel==MINE');
  u.searchParams.set('startDate', '2000-01-01');
  u.searchParams.set('endDate', new Date().toISOString().slice(0, 10));
  u.searchParams.set('metrics', 'averageViewPercentage,averageViewDuration,shares');
  u.searchParams.set('filters', `video==${videoId}`);
  const res = await fetchFn(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) return 'no-scope';
  if (!res.ok) throw new Error(`analytics report failed (${res.status})`);
  const j: any = await res.json();
  const row = j.rows?.[0];
  if (!row) return undefined;
  const names: string[] = (j.columnHeaders ?? []).map((h: any) => h.name);
  const col = (name: string, fallbackIdx: number) => {
    const i = names.indexOf(name);
    return Number(row[i >= 0 ? i : fallbackIdx] ?? 0);
  };
  return {
    avgViewPct: col('averageViewPercentage', 0),
    avgViewDurationSec: col('averageViewDuration', 1),
    shares: col('shares', 2),
  };
}

export interface PerfSnapshot {
  videoId: string;
  clip_id: string;
  exportsDir: string;
  measured_at: string;
  stats: VideoStats;
  analytics?: AnalyticsStats;
  rewardBreakdown?: RewardBreakdown;
}

export function snapshotPath(videoId: string, wsDir?: string): string {
  return join(wsDir ?? process.env.WORKSPACE_DIR ?? './workspace', 'performance', `${videoId}.json`);
}

/** Append-only per-video history: { videoId, history: PerfSnapshot[] }. */
export async function appendSnapshot(snap: PerfSnapshot, wsDir?: string): Promise<void> {
  const path = snapshotPath(snap.videoId, wsDir);
  let history: PerfSnapshot[] = [];
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    if (Array.isArray(j?.history)) history = j.history;
  } catch { /* first snapshot */ }
  history.push(snap);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ videoId: snap.videoId, history }, null, 2));
}
