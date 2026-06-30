import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ora from 'ora';
import Table from 'cli-table3';
import { parseVideoId, download } from '../../ingest/downloader.js';
import { extractMetadata } from '../../ingest/metadataExtractor.js';
import { getTranscript } from '../../transcript/transcriptManager.js';
import { detectTriggers } from '../../analysis/transcriptTriggers.js';
import { analyzeAudio } from '../../analysis/audioEnergy.js';
import { analyzeSemantic } from '../../analysis/semantic.js';
import { scoreWindows } from '../../clipDetection/windowScorer.js';
import { buildClips } from '../../clipDetection/merger.js';
import { rank, defaultMinScore } from '../../clipDetection/ranker.js';
import { buildCaptionWords } from '../../captions/captionWords.js';
import { sentimentColor } from '../../captions/sentimentColor.js';
import { writeSrt } from '../../captions/srtGenerator.js';
import { extractRaw, extractFullFrame } from '../../extraction/clipExtractor.js';
import { detectFaceTrack } from '../../extraction/faceTracker.js';
import { render } from '../../captions/remotionRenderer.js';
import { writeExports } from '../../export/exporter.js';
import { logger } from '../../utils/logger.js';
import type { RankedClip, TranscriptSegment, VideoAnalysis } from '../../types/index.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export function resolveJobId(url: string): string {
  return parseVideoId(url) ?? uuidv4();
}

/** PURE: truncate a hook moment to <=8 words for the hook card, appending an ellipsis if cut. */
export function hookCardText(s: string): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 8) return words.join(' ');
  return words.slice(0, 7).join(' ') + '…';
}

/** PURE: short, stable id for a batch of URLs (order-independent). */
export function batchId(urls: string[]): string {
  const sorted = [...urls].sort();
  const hash = createHash('sha1').update(sorted.join('\n')).digest('hex').slice(0, 10);
  return `batch_${hash}`;
}

export interface AllOpts {
  top: number;
  minScore?: number;
  style: 'minimal' | 'card' | 'bold';
  accent: string;
  perVideoCap?: number;
}

/** A RankedClip tagged with the VideoAnalysis it came from. */
export interface SourcedRankedClip {
  clip: RankedClip;
  source: VideoAnalysis;
}

/**
 * Analyze a single video end-to-end (ingest → metadata → transcript → triggers + audio +
 * semantic → score windows → build clip candidates). Does NOT rank or export.
 */
export async function analyzeVideo(url: string, opts: AllOpts): Promise<VideoAnalysis> {
  const jobId = resolveJobId(url);
  const dirs = {
    downloads: join(WS, 'downloads', jobId),
    transcripts: join(WS, 'transcripts', jobId),
    analysis: join(WS, 'analysis', jobId),
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

  sp = ora('Analyzing semantics (Gemini)…').start();
  const semantic = await analyzeSemantic(segments, {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL,
    outPath: join(dirs.analysis, 'layer_semantic.json'),
  });
  if (semantic.length > 0) sp.succeed(`semantic: ${semantic.length} windows`);
  else sp.warn('semantic: unavailable → trigger+audio fallback');

  sp = ora('Detecting clips…').start();
  const windows = scoreWindows(meta.duration, triggers, audio, semantic);
  const threshold = opts.minScore ?? defaultMinScore(windows);
  const candidates = buildClips(windows, segments, audio, threshold, meta.duration);
  sp.succeed(`Found ${candidates.length} candidates`);

  return { jobId, url, videoPath: dl.videoPath, meta, segments, triggers, audio, semantic, candidates };
}

/**
 * PURE: pool per-analysis RankedClips (already within-video deduped/ranked) and select the
 * global top-N by composite_score across all sources, optionally capped per source. Re-numbers
 * rank/clip_id 1..N over the selection. `pool` order is not assumed to be sorted.
 */
export function rankAcrossAnalyses(
  pool: SourcedRankedClip[],
  opts: { top: number; perVideoCap?: number },
): SourcedRankedClip[] {
  const sorted = [...pool].sort((a, b) => b.clip.composite_score - a.clip.composite_score);

  const selected: SourcedRankedClip[] = [];
  const perSourceCount = new Map<string, number>();
  for (const item of sorted) {
    if (selected.length >= opts.top) break;
    if (opts.perVideoCap) {
      const count = perSourceCount.get(item.source.jobId) ?? 0;
      if (count >= opts.perVideoCap) continue;
      perSourceCount.set(item.source.jobId, count + 1);
    }
    selected.push(item);
  }

  return selected.map(({ clip, source }, i) => ({
    source,
    clip: {
      ...clip,
      rank: i + 1,
      clip_id: `clip_${String(i + 1).padStart(3, '0')}`,
      source_video: source.jobId,
      source_url: source.url,
    },
  }));
}

/**
 * Rank candidates from one or more VideoAnalysis results GLOBALLY by composite score and export
 * the selected clips (extract + face-track reframe + caption render + raw copy + manifest).
 * Returns the exports directory.
 */
export async function rankAndExport(analyses: VideoAnalysis[], opts: AllOpts): Promise<string> {
  // Per-analysis rank (within-video dedup + semantic attachment), tag each with its source.
  const pool: SourcedRankedClip[] = [];
  for (const analysis of analyses) {
    const ranked = rank(analysis.candidates, analysis.segments, { top: Infinity, minScore: opts.minScore }, analysis.semantic);
    for (const clip of ranked) pool.push({ clip, source: analysis });
  }

  const selected = rankAcrossAnalyses(pool, { top: opts.top, perVideoCap: opts.perVideoCap });

  const id = analyses.length === 1 ? analyses[0].jobId : batchId(analyses.map((a) => a.url));
  const exportsDir = join(WS, 'exports', id);

  for (const { clip, source } of selected) {
    const sp2 = ora(`[${clip.clip_id}] (${source.jobId}) extract + caption…`).start();
    const finalPath = join(exportsDir, `${clip.clip_id}_final.mp4`);
    const clipsDir = join(WS, 'clips', source.jobId);

    const clipWords = source.segments.flatMap((s) => s.words).filter((w) => w.end > clip.start && w.start < clip.end);
    const captionWords = buildCaptionWords(clipWords, clip.start, source.triggers.map((t) => t.phrase));
    await writeSrt(captionWords, join(exportsDir, `${clip.clip_id}.srt`));

    const fullPath = join(clipsDir, `${clip.clip_id}_full.mp4`);
    await extractFullFrame(source.videoPath, clip.start, clip.end, fullPath);
    const track = await detectFaceTrack(fullPath, source.meta.width, source.meta.height);

    const hookText = clip.hook_moment ? hookCardText(clip.hook_moment) : undefined;
    const accentColor = sentimentColor(clip.sentiment, opts.accent);

    let producedRawPath: string;
    if (track.length > 0) {
      await render({
        rawClipPath: fullPath, words: captionWords, outPath: finalPath, fps: source.meta.fps,
        accentColor, style: opts.style,
        cropTrack: track, srcW: source.meta.width, srcH: source.meta.height,
        hookText,
      });
      producedRawPath = fullPath;
      logger.info(`[${clip.clip_id}] reframed (${track.length} face keyframes)`);
    } else {
      const rawPath = join(clipsDir, `${clip.clip_id}_raw.mp4`);
      await extractRaw(source.videoPath, clip.start, clip.end, { width: source.meta.width, height: source.meta.height }, rawPath);
      await render({ rawClipPath: rawPath, words: captionWords, outPath: finalPath, fps: source.meta.fps, accentColor, style: opts.style, hookText });
      producedRawPath = rawPath;
      logger.info(`[${clip.clip_id}] center-crop fallback (no faces detected)`);
    }

    // copy raw into exports for completeness
    await mkdir(exportsDir, { recursive: true });
    await copyFile(producedRawPath, join(exportsDir, `${clip.clip_id}_raw.mp4`));
    sp2.succeed(`[${clip.clip_id}] done`);
  }

  const ranked = selected.map((s) => s.clip);
  const primary = analyses[0];
  await writeExports(exportsDir, id, primary.url, primary.meta, ranked);

  const head = analyses.length === 1 ? ['Rank', 'Score', 'Dur', 'Excerpt'] : ['Rank', 'Score', 'Dur', 'Source', 'Excerpt'];
  const table = new Table({ head });
  ranked.forEach((c) => {
    const row = [c.rank, c.composite_score, `${Math.round(c.duration)}s`];
    if (analyses.length > 1) row.push(c.source_video ?? '');
    row.push(c.transcript_excerpt.slice(0, 40));
    table.push(row);
  });
  logger.info('\n' + table.toString());
  logger.info(`Export complete → ${exportsDir}`);
  return exportsDir;
}

export async function runAll(url: string, opts: AllOpts): Promise<string> {
  const analysis = await analyzeVideo(url, opts);
  return rankAndExport([analysis], opts);
}

/** Analyze multiple videos SEQUENTIALLY (Gemini rate limits + memory) then rank+export globally. */
export async function runBatch(urls: string[], opts: AllOpts): Promise<string> {
  const analyses: VideoAnalysis[] = [];
  for (const [i, url] of urls.entries()) {
    logger.info(`\n— Video ${i + 1}/${urls.length}: ${url} —`);
    analyses.push(await analyzeVideo(url, opts));
  }
  return rankAndExport(analyses, opts);
}
