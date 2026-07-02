/**
 * YouTube Data API v3 upload: resumable videos.insert + thumbnails.set, plain fetch.
 * Clips are 20–80 MB so the file is buffered (no streaming needed).
 */
import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';

export type YtPrivacy = 'public' | 'unlisted' | 'private';

export interface UploadMeta {
  snippet: { title: string; description: string; tags: string[]; categoryId: string };
  status: { privacyStatus: YtPrivacy; selfDeclaredMadeForKids: false };
}

const TITLE_MAX = 100;
const DESC_MAX = 5000;
const TAGS_CHAR_BUDGET = 450; // API limit is 500 incl. overhead — stay under

/** PURE: SEO pack → videos.insert snippet/status body. */
export function seoToUploadMeta(
  seo: { title: string; description: string; hashtags: string[] },
  opts: { privacy: YtPrivacy; titleOverride?: string; descriptionOverride?: string },
): UploadMeta {
  const title = (opts.titleOverride ?? seo.title).replace(/[<>]/g, '').slice(0, TITLE_MAX);
  const description = (opts.descriptionOverride ?? seo.description).replace(/[<>]/g, '').slice(0, DESC_MAX);
  const tags: string[] = [];
  let budget = TAGS_CHAR_BUDGET;
  for (const h of seo.hashtags) {
    const t = h.replace(/^#/, '');
    if (t.length > budget) break;
    tags.push(t);
    budget -= t.length;
  }
  return {
    snippet: { title, description, tags, categoryId: '24' /* Entertainment */ },
    status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false },
  };
}

export interface UploadResult { videoId: string; url: string; privacyStatus: string; }

async function apiError(res: Response, what: string): Promise<Error> {
  const j: any = await res.json().catch(() => ({}));
  const reason = j?.error?.errors?.[0]?.reason ?? '';
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new Error('YouTube API quota exceeded — the default quota allows ~6 uploads/day (resets midnight Pacific).');
  }
  return new Error(`${what} failed (${res.status}${reason ? ` ${reason}` : ''}${j?.error?.message ? `: ${j.error.message}` : ''})`);
}

export async function uploadVideo(
  videoPath: string, meta: UploadMeta, accessToken: string, fetchFn: typeof fetch = fetch,
): Promise<UploadResult> {
  const init = await fetchFn(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    },
  );
  if (!init.ok) throw await apiError(init, 'Upload session init');
  const session = init.headers.get('location');
  if (!session) throw new Error('Upload session init returned no location header');

  const bytes = await readFile(videoPath);
  const put = await fetchFn(session, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/mp4' },
    body: bytes,
  });
  if (!put.ok) throw await apiError(put, 'Video upload');
  const j: any = await put.json();
  if (!j.id) throw new Error('Upload response missing video id');
  return { videoId: j.id, url: `https://youtu.be/${j.id}`, privacyStatus: j.status?.privacyStatus ?? 'unknown' };
}

/** Set the custom thumbnail; returns false (and warns) when the channel isn't allowed to. */
export async function setThumbnail(
  videoId: string, pngPath: string, accessToken: string, fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const png = await readFile(pngPath);
  const res = await fetchFn(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' }, body: png },
  );
  if (res.status === 403) {
    logger.warn('thumbnail: channel not enabled for custom thumbnails (verify phone at youtube.com/verify) — skipped');
    return false;
  }
  if (!res.ok) throw await apiError(res, 'Thumbnail set');
  return true;
}
