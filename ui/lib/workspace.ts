/**
 * Server-side workspace reader. The UI runs from ui/ with the repo root one level up;
 * WORKSPACE_DIR / REPO_ROOT env vars override for non-standard layouts.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const REPO_ROOT = process.env.REPO_ROOT ?? resolve(process.cwd(), '..');
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? join(REPO_ROOT, 'workspace');

export interface ClipInfo {
  clipId: string;
  rank: number;
  score: number;
  title: string;
  hook: string;
  excerpt: string;
  sentiment?: string;
  sourceVideo?: string;
  duration: number;
  /** AVSS-predicted average retention (0-1) of the winning edit variant. */
  predictedRetention?: number;
  /** v7 arc gate: true = complete 6/6 micro-story, false = exported via --lenient. */
  arcComplete?: boolean;
  /** True when this clip fell below --min-retention and was segregated into
   *  exports/<job>/below_retention/ instead of the top-level tier. */
  belowRetentionFloor?: boolean;
  /** v4 audit: false = a hard gate failed; degradations = reason codes shipped-but-compromised. */
  auditPassed?: boolean;
  degraded?: boolean;
  degradations?: string[];
  files: { final: string; raw: string; srt: string; json: string };
}

export interface ExportJob {
  id: string;
  title: string;
  source: string;
  processedAt: string;
  clipCount: number;
  belowRetentionCount: number;
  hasRanking: boolean;
  sizeBytes: number;
  clips: ClipInfo[];
}

function mapManifestClips(manifest: any, belowRetentionFloor: boolean): ClipInfo[] {
  const prefix = belowRetentionFloor ? 'below_retention/' : '';
  return (manifest.clips ?? []).map((c: any) => ({
    clipId: c.clip_id,
    rank: c.rank,
    score: c.composite_score,
    title: c.clip_titles?.[0] ?? '',
    hook: c.hook_moment ?? '',
    excerpt: c.transcript_excerpt ?? '',
    sentiment: c.sentiment,
    sourceVideo: c.source_video,
    duration: c.duration ?? 0,
    predictedRetention: c.predicted_retention,
    arcComplete: c.arc_complete,
    belowRetentionFloor,
    auditPassed: c.quality?.passed,
    degraded: c.quality?.degraded,
    degradations: c.quality?.degradations,
    files: {
      final: `${prefix}${c.clip_id}_final.mp4`,
      raw: `${prefix}${c.clip_id}_raw.mp4`,
      srt: `${prefix}${c.clip_id}.srt`,
      json: `${prefix}${c.clip_id}.json`,
    },
  }));
}

export async function listExports(): Promise<ExportJob[]> {
  const root = join(WORKSPACE_DIR, 'exports');
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }

  const jobs: ExportJob[] = [];
  for (const id of dirs) {
    const dir = join(root, id);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
      const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
      const hasRanking = await stat(join(dir, 'ranking_final.mp4')).then(() => true).catch(() => false);
      let sizeBytes = 0;
      for (const f of await readdir(dir)) {
        sizeBytes += await stat(join(dir, f)).then((s) => (s.isFile() ? s.size : 0)).catch(() => 0);
      }

      const clips = mapManifestClips(manifest, false);

      // AVSS --min-retention segregates sub-floor clips into below_retention/ instead of
      // dropping them — surface them here too (tagged) so a run isn't invisible when EVERY
      // clip lands under the floor (top-level clips_manifest.json would otherwise show 0).
      let belowClips: ClipInfo[] = [];
      try {
        const belowManifest = JSON.parse(await readFile(join(dir, 'below_retention', 'clips_manifest.json'), 'utf8'));
        belowClips = mapManifestClips(belowManifest, true);
        for (const f of await readdir(join(dir, 'below_retention')).catch(() => [] as string[])) {
          sizeBytes += await stat(join(dir, 'below_retention', f)).then((s) => (s.isFile() ? s.size : 0)).catch(() => 0);
        }
      } catch {
        // no sub-floor tier for this job — normal case
      }

      jobs.push({
        id,
        title: manifest.title ?? id,
        source: manifest.source ?? '',
        processedAt: manifest.processed_at ?? '',
        clipCount: clips.length,
        belowRetentionCount: belowClips.length,
        hasRanking,
        sizeBytes,
        clips: [...clips, ...belowClips],
      });
    } catch {
      // dir without a complete manifest (interrupted job) — skip
    }
  }
  jobs.sort((a, b) => (b.processedAt || '').localeCompare(a.processedAt || ''));
  return jobs;
}

export function exportFilePath(jobId: string, file: string): string {
  // basename-only guard against path traversal, with one carve-out: the literal
  // "below_retention/" prefix the AVSS retention floor writes clips under.
  const safeJob = jobId.replace(/[^A-Za-z0-9_-]/g, '');
  const belowRetention = file.startsWith('below_retention/');
  const rest = belowRetention ? file.slice('below_retention/'.length) : file;
  const safeFile = rest.replace(/[^A-Za-z0-9._-]/g, '');
  return belowRetention
    ? join(WORKSPACE_DIR, 'exports', safeJob, 'below_retention', safeFile)
    : join(WORKSPACE_DIR, 'exports', safeJob, safeFile);
}
