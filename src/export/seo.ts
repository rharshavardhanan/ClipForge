/**
 * SEO pack per clip — click title, SEO description, hashtag set, hook text, thumbnail text.
 * Pure derivation from the ranked clip + source metadata (the semantic layer already produced
 * clip_titles / hook_moment); no LLM calls, fully deterministic.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RankedClip, VideoMetadata } from '../types/index.js';

export interface SeoPack {
  title: string;
  description: string;
  hashtags: string[];
  hookText: string;
  thumbnailText: string;
}

/** PURE: '#kaicenat' from 'Kai Cenat' — lowercase alphanumerics only; null when nothing survives. */
export function slugTag(s: string): string | null {
  const slug = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug ? `#${slug}` : null;
}

// YouTube truncates video titles past 100 chars (also enforced again at upload time in
// youtubeUpload.ts) — capped here too so title.txt already shows what will actually upload.
const TITLE_MAX_CHARS = 100;
// Generous reach pool for the DESCRIPTION (not the tags field) — YouTube has no practical
// limit on description hashtags and search benefits from a wide net; hashtags.txt / the
// upload `tags` field reuse the same deduped set (youtubeUpload.ts budget-caps that field
// separately, so a bigger pool here is safe).
const VIRAL_TAGS = [
  '#shorts', '#viral', '#fyp', '#trending', '#clips',
  '#foryou', '#foryoupage', '#explore', '#viralvideo', '#shortsvideo',
  '#reels', '#youtubeshorts', '#fy', '#shortsfeed', '#viralshorts',
];

function sentimentTags(sentiment?: string): string[] {
  switch (sentiment) {
    case 'funny': return ['#funny', '#comedy', '#lol', '#hilarious', '#memes'];
    case 'intense': return ['#insane', '#crazy', '#epic', '#wild', '#unbelievable'];
    case 'serious': return ['#motivation', '#mindset', '#inspiration', '#discipline'];
    default: return [];
  }
}

function firstWords(s: string, n: number): string {
  return s.trim().split(/\s+/).filter(Boolean).slice(0, n).join(' ');
}

function baseTitle(clip: RankedClip): string {
  if (clip.clip_titles[0]) return clip.clip_titles[0];
  if (clip.hook_moment) return firstWords(clip.hook_moment, 8);
  return firstWords(clip.transcript_excerpt, 6) + '…';
}

export function buildSeoPack(clip: RankedClip, meta: VideoMetadata): SeoPack {
  const creatorTag = meta.channelName ? slugTag(meta.channelName) : null;
  const nicheTags = (meta.tags ?? []).map(slugTag).filter((t): t is string => t !== null).slice(0, 10);

  const hashtags = [...new Set([
    ...(creatorTag ? [creatorTag] : []),
    ...VIRAL_TAGS,
    ...sentimentTags(clip.sentiment),
    ...nicheTags,
  ])].slice(0, 30);

  const titleRaw = [baseTitle(clip), creatorTag, '#shorts'].filter(Boolean).join(' ');
  const title = titleRaw.length <= TITLE_MAX_CHARS
    ? titleRaw
    : titleRaw.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + '…';

  const hookSrc = clip.hook_moment || clip.transcript_excerpt || 'wait for it';
  const hookWords = hookSrc.trim().split(/\s+/).filter(Boolean);
  const hookText = (hookWords.length <= 8 ? hookWords.join(' ') : hookWords.slice(0, 7).join(' ') + '…').toUpperCase();

  const thumbnailText = firstWords(baseTitle(clip), 4).replace(/[^\p{L}\p{N}\s]/gu, '').trim().toUpperCase() || 'WAIT FOR IT';

  const credit = `From: ${meta.title}${clip.source_url ? ` — ${clip.source_url}` : ''}`;
  const description = [
    `${hookSrc.trim()} 🔥`,
    '',
    credit,
    clip.reason && !clip.reason.startsWith('trigger=') ? `Why it slaps: ${clip.reason}` : '',
    '',
    hashtags.join(' '),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  return { title, description, hashtags, hookText, thumbnailText };
}

/** Write the four per-clip SEO text files next to the clip. */
export async function writeSeoFiles(dir: string, clipId: string, pack: SeoPack): Promise<void> {
  await Promise.all([
    writeFile(join(dir, `${clipId}_title.txt`), pack.title + '\n'),
    writeFile(join(dir, `${clipId}_description.txt`), pack.description + '\n'),
    writeFile(join(dir, `${clipId}_hashtags.txt`), pack.hashtags.join('\n') + '\n'),
    writeFile(join(dir, `${clipId}_hook.txt`), pack.hookText + '\n'),
  ]);
}
