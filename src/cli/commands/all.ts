import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import ora from 'ora';
import Table from 'cli-table3';
import { parseVideoId, download } from '../../ingest/downloader.js';
import { extractMetadata } from '../../ingest/metadataExtractor.js';
import { getTranscript } from '../../transcript/transcriptManager.js';
import { detectTriggers } from '../../analysis/transcriptTriggers.js';
import { analyzeAudio } from '../../analysis/audioEnergy.js';
import { scoreWindows } from '../../clipDetection/windowScorer.js';
import { buildClips } from '../../clipDetection/merger.js';
import { rank, defaultMinScore } from '../../clipDetection/ranker.js';
import { buildCaptionWords } from '../../captions/captionWords.js';
import { writeSrt } from '../../captions/srtGenerator.js';
import { extractRaw } from '../../extraction/clipExtractor.js';
import { render } from '../../captions/remotionRenderer.js';
import { writeExports } from '../../export/exporter.js';
import { logger } from '../../utils/logger.js';
import type { TranscriptSegment } from '../../types/index.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export function resolveJobId(url: string): string {
  return parseVideoId(url) ?? uuidv4();
}

export interface AllOpts { top: number; minScore?: number; style: 'minimal' | 'card' | 'bold'; accent: string; }

export async function runAll(url: string, opts: AllOpts): Promise<string> {
  const jobId = resolveJobId(url);
  const dirs = {
    downloads: join(WS, 'downloads', jobId),
    transcripts: join(WS, 'transcripts', jobId),
    analysis: join(WS, 'analysis', jobId),
    clips: join(WS, 'clips', jobId),
    exports: join(WS, 'exports', jobId),
  };

  let sp = ora('Ingesting video…').start();
  const dl = await download(url, dirs.downloads);
  const meta = await extractMetadata(dl.videoPath, dl.infoJsonPath, jobId, join(dirs.transcripts, 'metadata.json'));
  sp.succeed(`Downloaded: "${meta.title}" (${Math.round(meta.duration)}s)`);

  sp = ora('Extracting transcript…').start();
  const segments: TranscriptSegment[] = await getTranscript({
    jobId, videoPath: dl.videoPath, subtitlePath: dl.subtitlePath, outPath: join(dirs.transcripts, 'transcript.json'),
  });
  sp.succeed(`Transcript ready — ${segments.reduce((a, s) => a + s.words.length, 0)} words`);

  sp = ora('Analyzing (triggers + audio energy)…').start();
  const triggers = detectTriggers(segments);
  const audio = await analyzeAudio(dl.videoPath);
  sp.succeed(`Analysis done — ${triggers.length} trigger hits`);

  sp = ora('Detecting clips…').start();
  const windows = scoreWindows(meta.duration, triggers, audio);
  const threshold = opts.minScore ?? defaultMinScore(windows);
  const candidates = buildClips(windows, segments, audio, threshold, meta.duration);
  const ranked = rank(candidates, segments, { top: opts.top, minScore: opts.minScore });
  sp.succeed(`Found ${candidates.length} candidates → ${ranked.length} ranked`);

  for (const clip of ranked) {
    const sp2 = ora(`[${clip.clip_id}] extract + caption…`).start();
    const rawPath = join(dirs.clips, `${clip.clip_id}_raw.mp4`);
    await extractRaw(dl.videoPath, clip.start, clip.end, { width: meta.width, height: meta.height }, rawPath);

    const clipWords = segments.flatMap((s) => s.words).filter((w) => w.end > clip.start && w.start < clip.end);
    const captionWords = buildCaptionWords(clipWords, clip.start, triggers.map((t) => t.phrase));
    await writeSrt(captionWords, join(dirs.exports, `${clip.clip_id}.srt`));
    await render({ rawClipPath: rawPath, words: captionWords, outPath: join(dirs.exports, `${clip.clip_id}_final.mp4`), fps: meta.fps, accentColor: opts.accent, style: opts.style });

    // copy raw into exports for completeness
    await mkdir(dirs.exports, { recursive: true });
    await copyFile(rawPath, join(dirs.exports, `${clip.clip_id}_raw.mp4`));
    sp2.succeed(`[${clip.clip_id}] done`);
  }

  await writeExports(dirs.exports, jobId, url, meta, ranked);

  const table = new Table({ head: ['Rank', 'Score', 'Dur', 'Excerpt'] });
  ranked.forEach((c) => table.push([c.rank, c.composite_score, `${Math.round(c.duration)}s`, c.transcript_excerpt.slice(0, 40)]));
  logger.info('\n' + table.toString());
  logger.info(`Export complete → ${dirs.exports}`);
  return dirs.exports;
}
