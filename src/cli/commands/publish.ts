/**
 * Publishing commands: `clipforge auth youtube` (one-time OAuth) and
 * `clipforge upload <exportsDir>` (per-clip YouTube upload from the SEO pack).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ora from 'ora';
import { authYoutube, getAccessToken } from '../../publish/youtubeAuth.js';
import { seoToUploadMeta, uploadVideo, setThumbnail, type YtPrivacy } from '../../publish/youtubeUpload.js';
import { logger } from '../../utils/logger.js';

export async function runAuthYoutube(): Promise<void> {
  await authYoutube();
}

export interface UploadOpts {
  clips?: string; privacy: YtPrivacy; dryRun?: boolean; force?: boolean; json?: boolean;
  title?: string; description?: string;
}

/** PURE: manifest clips → clip ids to upload, in manifest order, optionally CSV-filtered. */
export function selectClips(manifestClips: { clip_id: string }[], clipsCsv?: string): string[] {
  const all = manifestClips.map((c) => c.clip_id);
  if (!clipsCsv) return all;
  const want = new Set(clipsCsv.split(',').map((s) => s.trim()).filter(Boolean));
  return all.filter((id) => want.has(id));
}

interface UploadOutcome {
  clip: string; videoId?: string; url?: string; privacyStatus?: string;
  locked?: boolean; error?: string; skipped?: boolean;
}

export async function runUpload(exportsDir: string, opts: UploadOpts): Promise<void> {
  const dir = resolve(exportsDir);
  const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
  const ids = selectClips(manifest.clips ?? [], opts.clips);
  if (ids.length === 0) throw new Error(`No matching clips in ${dir}`);

  const results: UploadOutcome[] = [];
  for (const id of ids) {
    const jsonPath = join(dir, `${id}.json`);
    const clipJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    if (clipJson.youtube?.videoId && !opts.force) {
      logger.info(`[${id}] already uploaded → ${clipJson.youtube.url} (use --force to re-upload)`);
      results.push({ clip: id, ...clipJson.youtube, skipped: true });
      continue;
    }
    if (!clipJson.seo) {
      results.push({ clip: id, error: 'clip.json has no seo block (re-export with current ClipForge)' });
      logger.warn(`[${id}] no seo block in clip.json — skipped (re-export to generate one)`);
      continue;
    }
    const meta = seoToUploadMeta(clipJson.seo, {
      privacy: opts.privacy, titleOverride: opts.title, descriptionOverride: opts.description,
    });
    if (opts.dryRun) {
      logger.info(`[${id}] DRY RUN would upload ${clipJson.files.final} as:\n` + JSON.stringify(meta, null, 2));
      results.push({ clip: id, skipped: true });
      continue;
    }

    const sp = ora(`[${id}] uploading to YouTube…`).start();
    try {
      const token = await getAccessToken();
      const r = await uploadVideo(join(dir, clipJson.files.final), meta, token);
      const locked = r.privacyStatus !== opts.privacy;
      try {
        if (clipJson.files.thumbnail) await setThumbnail(r.videoId, join(dir, clipJson.files.thumbnail), token);
      } catch (e) {
        logger.warn(`[${id}] thumbnail: ${e instanceof Error ? e.message : String(e)}`);
      }
      const record = { videoId: r.videoId, url: r.url, privacyStatus: r.privacyStatus, uploadedAt: new Date().toISOString() };
      await writeFile(jsonPath, JSON.stringify({ ...clipJson, youtube: record }, null, 2));
      results.push({ clip: id, ...record, locked });
      sp.succeed(locked
        ? `[${id}] uploaded ${r.url} — YouTube locked it PRIVATE (unverified Cloud app). Publish: https://studio.youtube.com/video/${r.videoId}/edit`
        : `[${id}] LIVE (${r.privacyStatus}) → ${r.url}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ clip: id, error: msg });
      sp.fail(`[${id}] ${msg}`);
    }
  }

  const ok = results.filter((r) => r.url && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.error).length;
  logger.info(`\nUpload done: ${ok} uploaded, ${skipped} skipped, ${failed} failed.`);
  if (opts.json) console.log(JSON.stringify({ results }));
}
