import { probe } from '../utils/ffmpeg.js';
import type { VideoMetadata } from '../types/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

type Probed = { duration: number; width: number; height: number; fps: number; codec: string };

export function mergeMetadata(jobId: string, probed: Probed, info: any | null): VideoMetadata {
  const chapters = Array.isArray(info?.chapters)
    ? info.chapters.map((c: any) => ({ title: c.title ?? '', start: c.start_time ?? 0, end: c.end_time ?? 0 }))
    : [];
  return {
    jobId,
    title: info?.title ?? jobId,
    duration: probed.duration,
    width: probed.width, height: probed.height, fps: probed.fps, codec: probed.codec,
    chapters,
    description: info?.description ?? '',
    viewCount: info?.view_count, likeCount: info?.like_count, commentCount: info?.comment_count,
    tags: info?.tags, uploadDate: info?.upload_date, channelName: info?.channel,
  };
}

export async function extractMetadata(videoPath: string, infoJsonPath: string, jobId: string, outPath: string): Promise<VideoMetadata> {
  const probed = await probe(videoPath);
  const info = existsSync(infoJsonPath) ? JSON.parse(await readFile(infoJsonPath, 'utf8')) : null;
  const meta = mergeMetadata(jobId, probed, info);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(meta, null, 2));
  return meta;
}
