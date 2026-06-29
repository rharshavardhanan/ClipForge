import { parseJson3 } from './youtubeTranscript.js';
import { transcribe } from './whisperRunner.js';
import { logger } from '../utils/logger.js';
import type { TranscriptSegment } from '../types/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function getTranscript(opts: {
  jobId: string; videoPath: string; subtitlePath: string | null; outPath: string;
}): Promise<TranscriptSegment[]> {
  if (existsSync(opts.outPath)) {
    logger.info('Reusing cached transcript.json');
    return JSON.parse(await readFile(opts.outPath, 'utf8'));
  }
  let segments: TranscriptSegment[];
  if (opts.subtitlePath && existsSync(opts.subtitlePath)) {
    logger.info('Parsing YouTube json3 captions');
    segments = parseJson3(await readFile(opts.subtitlePath, 'utf8'));
  } else {
    logger.info('No json3 captions — falling back to whisper.cpp');
    segments = await transcribe(opts.videoPath, dirname(opts.outPath));
  }
  await mkdir(dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, JSON.stringify(segments, null, 2));
  return segments;
}
