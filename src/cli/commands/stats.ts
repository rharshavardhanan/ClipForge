/**
 * `clipforge stats [exportsDirs...]` — the RL loop's ingest side. Pulls real YouTube
 * numbers for every uploaded clip, records an append-only performance snapshot,
 * updates the editing-policy bandit (FULL snapshots only — analytics scope required),
 * and promotes ≥70% real-retention edit DNA to ./elite_templates/.
 * Per-video failures never abort the run (mirrors `upload`).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Table from 'cli-table3';
import { getAccessToken } from '../../publish/youtubeAuth.js';
import {
  appendSnapshot, computeReward, fetchAnalytics, fetchVideoStats,
  type AnalyticsStats, type RewardBreakdown,
} from '../../avss/performance.js';
import { loadPolicy, savePolicy, updatePolicy, type PolicyChoice } from '../../avss/policy.js';
import { saveEliteTemplate, type EditDna } from '../../avss/templates.js';
import { logger } from '../../utils/logger.js';

const ELITE_RETENTION_PCT = 70;

export interface StatsOpts {
  channel?: string;
  json?: boolean;
  wsDir?: string;
  templatesDir?: string;
  /** Test seams. */
  fetchFn?: typeof fetch;
  getToken?: (channel?: string) => Promise<string>;
}

interface StatsTarget {
  exportsDir: string;
  clip_id: string;
  videoId: string;
  durationSec: number;
  dna?: EditDna;
}

/** PURE: edit DNA → the policy arms it pulled (what the bandit gets credited for). */
export function dnaToChoice(dna: EditDna): PolicyChoice {
  return {
    captionPreset: dna.captionPreset,
    ...(dna.hookSource !== 'none' ? { hookSource: dna.hookSource } : {}),
    zoomBucket: dna.zoomPer10s >= 1.5 ? 'tight' : 'sparse',
    sfxOn: dna.sfxOn,
  };
}

/** Scan exports dirs (default: all of workspace/exports) for uploaded clips. */
export async function collectTargets(dirs: string[], wsDir: string): Promise<StatsTarget[]> {
  let roots = dirs.map((d) => resolve(d));
  if (roots.length === 0) {
    const exportsRoot = join(wsDir, 'exports');
    try {
      roots = (await readdir(exportsRoot, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => join(exportsRoot, e.name));
    } catch { return []; }
  }
  const targets: StatsTarget[] = [];
  for (const dir of roots) {
    let manifest: any;
    try { manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8')); } catch { continue; }
    for (const c of manifest.clips ?? []) {
      try {
        const j = JSON.parse(await readFile(join(dir, `${c.clip_id}.json`), 'utf8'));
        if (j.youtube?.videoId) {
          targets.push({
            exportsDir: dir, clip_id: c.clip_id, videoId: j.youtube.videoId,
            durationSec: j.duration ?? 0, dna: j.avss?.dna,
          });
        }
      } catch { /* clip json unreadable — skip */ }
    }
  }
  return targets;
}

interface StatsRow {
  clip: string; videoId: string; views: number;
  retentionPct?: number; reward?: number; partial: boolean;
  promoted?: boolean; error?: string;
}

export async function runStats(dirs: string[], opts: StatsOpts = {}): Promise<void> {
  const wsDir = opts.wsDir ?? process.env.WORKSPACE_DIR ?? './workspace';
  const fetchFn = opts.fetchFn ?? fetch;
  const getToken = opts.getToken ?? getAccessToken;

  const targets = await collectTargets(dirs, wsDir);
  if (targets.length === 0) {
    logger.info('Nothing to measure — no exported clips with a youtube.videoId found. Upload first: clipforge upload <exportsDir>');
    if (opts.json) console.log(JSON.stringify({ results: [] }));
    return;
  }

  const token = await getToken(opts.channel);
  const statsById = await fetchVideoStats([...new Set(targets.map((t) => t.videoId))], token, fetchFn);

  let policy = await loadPolicy(wsDir);
  let policyDirty = false;
  let noScopeWarned = false;
  const rows: StatsRow[] = [];

  for (const t of targets) {
    try {
      const stats = statsById.get(t.videoId);
      if (!stats) { rows.push({ clip: t.clip_id, videoId: t.videoId, views: 0, partial: true, error: 'not returned by videos.list' }); continue; }

      let analytics: AnalyticsStats | undefined;
      const a = await fetchAnalytics(t.videoId, token, fetchFn);
      if (a === 'no-scope') {
        if (!noScopeWarned) {
          logger.warn('Analytics scope missing on this token — retention/completion unavailable. Re-run: ./start.sh auth youtube (grants yt-analytics.readonly)');
          noScopeWarned = true;
        }
      } else analytics = a;

      const reward: RewardBreakdown = computeReward(t.durationSec, stats, analytics);
      await appendSnapshot({
        videoId: t.videoId, clip_id: t.clip_id, exportsDir: t.exportsDir,
        measured_at: new Date().toISOString(), stats,
        ...(analytics ? { analytics } : {}), rewardBreakdown: reward,
      }, wsDir);

      let promoted = false;
      // Only FULL snapshots teach the policy — engagement-only rewards would bias arms low.
      if (!reward.partial && t.dna) {
        policy = updatePolicy(policy, t.dna.mode, dnaToChoice(t.dna), reward.reward);
        policyDirty = true;
        if (analytics && analytics.avgViewPct >= ELITE_RETENTION_PCT) {
          const template = await saveEliteTemplate(t.dna, {
            videoId: t.videoId, clip_id: t.clip_id, retention: analytics.avgViewPct / 100,
          }, opts.templatesDir);
          promoted = template !== null;
          if (promoted) logger.info(`[${t.clip_id}] ELITE — ${analytics.avgViewPct.toFixed(0)}% retention → elite_template_v${template!.version}.json`);
        }
      }

      rows.push({
        clip: t.clip_id, videoId: t.videoId, views: stats.views,
        ...(analytics ? { retentionPct: analytics.avgViewPct } : {}),
        reward: reward.reward, partial: reward.partial, promoted,
      });
    } catch (e) {
      rows.push({ clip: t.clip_id, videoId: t.videoId, views: 0, partial: true, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (policyDirty) {
    await savePolicy(policy, wsDir);
    logger.info(`Policy updated → v${policy.version}`);
  }

  const table = new Table({ head: ['Clip', 'Video', 'Views', 'Retention', 'Reward', ''] });
  for (const r of rows) {
    table.push([
      r.clip, r.videoId, r.views,
      r.retentionPct !== undefined ? `${r.retentionPct.toFixed(0)}%` : (r.partial ? 'n/a' : ''),
      r.reward !== undefined ? r.reward.toFixed(3) : '',
      r.error ? `ERR: ${r.error}` : r.promoted ? 'ELITE' : r.partial ? 'partial' : '',
    ]);
  }
  logger.info('\n' + table.toString());
  if (opts.json) console.log(JSON.stringify({ results: rows }));
}
