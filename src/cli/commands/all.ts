import { v4 as uuidv4 } from 'uuid';
import { basename, join } from 'node:path';
import { copyFile, mkdir, rename, rm, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ora from 'ora';
import Table from 'cli-table3';
import { parseVideoId, download } from '../../ingest/downloader.js';
import { isLocalInput, localJobId, ingestLocal } from '../../ingest/localFile.js';
import { extractMetadata } from '../../ingest/metadataExtractor.js';
import { getTranscript } from '../../transcript/transcriptManager.js';
import { detectTriggers } from '../../analysis/transcriptTriggers.js';
import { commentBoosts } from '../../analysis/commentSignals.js';
import { analyzeAudio } from '../../analysis/audioEnergy.js';
import { analyzeSemanticAuto, pickSemanticProvider } from '../../analysis/semanticEngine.js';
import { scoreWindows } from '../../clipDetection/windowScorer.js';
import { buildClips } from '../../clipDetection/merger.js';
import { rank, defaultMinScore, arcWeightedComposite } from '../../clipDetection/ranker.js';
import { motionLayer } from '../../analysis/motion.js';
import { chunkTranscript } from '../../analysis/arcChunker.js';
import { mineArcs, mergeMinedCandidates } from '../../analysis/arcMiner.js';
import { buildEvidenceBlock } from '../../analysis/arcEvidence.js';
import { extractKeyframes, keyframeTimes, peakTime } from '../../analysis/keyframes.js';
import { completeArc, gateArc, resolveBounds, type ArcCompletion } from '../../analysis/arcCompleter.js';
import { arcScore } from '../../analysis/arcTypes.js';
import { loadUsedRanges, appendUsedRanges, filterUsedCandidates } from '../../clipDetection/usedRanges.js';
import { buildCaptionWords } from '../../captions/captionWords.js';
import { sentimentColor } from '../../captions/sentimentColor.js';
import { writeSrt } from '../../captions/srtGenerator.js';
import { extractFullFrame } from '../../extraction/clipExtractor.js';
import { planFraming } from '../../extraction/faceTracker.js';
import { aspectDims } from '../../extraction/aspect.js';
import { planCallouts, faceAt } from '../../extraction/callouts.js';
import { render } from '../../captions/remotionRenderer.js';
import { scanLibrary, pickTrack, sentimentToMood } from '../../music/library.js';
import { mixMusic } from '../../music/mixer.js';
import { scanSfxLibrary } from '../../sfx/library.js';
import { planSfx } from '../../sfx/events.js';
import { mixSfx } from '../../sfx/mixer.js';
import { writeExports, buildSelectionWhy, type SelectionExport } from '../../export/exporter.js';
import { fillerRatio } from '../../analysis/filler.js';
import { buildCaptionCues, DEFAULT_CUE_CONSTRAINTS } from '../../captions/captionCues.js';
import { runAudit, type ClipQuality } from '../../quality/audit.js';
import { SUBJECT_IN_FRAME_FLOOR } from '../../quality/gates.js';
import { buildClipEdl, type ClipEdl } from '../../report/edl.js';
import { buildRunReport, writeRunReport, type RunReportClip } from '../../report/runReport.js';
import { ReasonCode } from '../../report/reasonCodes.js';
import { normalizeLoudness, TARGET_LUFS } from '../../audio/loudness.js';
import { detectFrameObs } from '../../extraction/faceTracker.js';
import { extractTightened } from '../../extraction/clipExtractor.js';
import { scoreVisualFeasibility } from '../../director/visualFeasibility.js';
import { selectDiverse, type Selectable } from '../../director/selectDiverse.js';
import { topicOf } from '../../analysis/semantic.js';
import { planTighten, DEFAULT_TIGHTEN } from '../../editor/tighten.js';
import { paceTarget, paceToTighten } from '../../editor/pace.js';
import { identityTimeMap, mapWords, mapTimes, mapRms, srcToOut, isKept, type KeepSegment } from '../../editor/timeMap.js';
import { buildSeoPack, type SeoPack } from '../../export/seo.js';
import { pickThumbnailTime, generateThumbnail } from '../../export/thumbnail.js';
import { MODE_PROFILES, resolveMode, resolveFraming } from '../../modes.js';
import { buildEditPlan, buildSourceSignals, truncateHook } from '../../avss/editPlan.js';
import { regulate } from '../../avss/regulator.js';
import { generateVariants, scoreVariants, pickWinner, type VariantPins } from '../../avss/variants.js';
import { defaultPolicy, loadPolicy, type Policy } from '../../avss/policy.js';
import { extractDna, loadTemplates, type EliteTemplate } from '../../avss/templates.js';
import type { ArcExport, AvssExport } from '../../export/exporter.js';
import { acquireBroll } from '../../broll/acquire.js';
import { filterCallouts } from '../../broll/planner.js';
import { logger } from '../../utils/logger.js';
import type { ArcLabel, AudioEnergyLayer, BrollSegment, RankedClip, TranscriptSegment, VideoAnalysis } from '../../types/index.js';
import { resolveCaptionStyle, type CaptionOverrides, type CaptionStyle } from '../../captions/presets.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export function resolveJobId(url: string): string {
  if (isLocalInput(url)) return localJobId(url);
  return parseVideoId(url) ?? uuidv4();
}

/** PURE: truncate a hook moment to <=8 words for the hook card, appending an ellipsis if cut. */
export function hookCardText(s: string): string {
  return truncateHook(s);
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
  /** Caption preset name (mrbeast|hormozi|gadzhi|gaming|podcast|cinematic|minimal|card|bold).
   *  Absent → the content mode's default preset (clippies: mrbeast, mindcuts: podcast). */
  style?: string;
  accent: string;
  perVideoCap?: number;
  /** Resolved caption style config; absent → resolved from style/mode + captionOverrides. */
  caption?: CaptionStyle;
  /** CLI caption fine-tuning flags, applied on top of whichever preset wins. */
  captionOverrides?: CaptionOverrides;
  /** Content mode: 'clippies' | 'mindcuts' | 'auto'/undefined = detect per video. */
  mode?: string;
  /** Framing: 'crop' = force full-screen 9:16 (active-speaker/face-tracked, center fallback),
   *  'blur' = force 16:9 over blurred backdrop, 'auto'/undefined = per-clip decision. */
  framing?: string;
  /** Output aspect: '9:16' (full portrait, default) or '3:4' (tall-but-not-full). */
  aspect?: string;
  /** Contextual B-roll (narrative overlay): true = force on, false = off,
   *  undefined = the mode's default (on for mindcuts). */
  broll?: boolean;
  brollDir?: string;
  maxBroll?: number;
  /** Background music: true/undefined = auto (on when ./music has a matching track). */
  music?: boolean;
  musicVolume?: number;
  musicDir?: string;
  /** Punch zooms on emphasized moments. Default true. */
  zooms?: boolean;
  /** Sound-design SFX (whoosh on zooms, impact under hook): true/undefined = auto (on when ./sfx has one-shots). */
  sfx?: boolean;
  sfxVolume?: number;
  sfxDir?: string;
  /** Delete the downloaded source video + clip intermediates after a successful export (frees disk). */
  deleteSource?: boolean;
  /** Allow re-exporting moments already used by previous runs of the same video. Default false. */
  allowRepeats?: boolean;
  /** Candidates given the arc completion + 6/6 story gate pass (min = top). Default 8. */
  arcTopk?: number;
  /** Export clips that fail the 6/6 story gate, labeled arc.complete=false. Default false. */
  lenient?: boolean;
  /** AVSS predicted-retention floor (0-1). A selected clip whose winning variant simulates
   *  below this is hard-dropped before render. Default 0.75. Clips whose simulation failed
   *  (no prediction) are kept. */
  minRetention?: number;
  /** Loudness-normalize the final mix to --target-lufs. Default on; false = ship source loudness. */
  loudnorm?: boolean;
  /** Integrated-loudness target in LUFS (default -14, the Shorts/TikTok norm). */
  targetLufs?: number;
  /** Editor tightening (remove dead air + safe filler). Default on; false = keep clips whole. */
  tighten?: boolean;
}

/** PURE: files/dirs to remove when --delete-source is set — the big source download and the
 *  per-clip intermediate extracts, one set per distinct source video. */
export function cleanupTargets(analyses: { jobId: string; videoPath: string }[], wsDir: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of analyses) {
    if (seen.has(a.jobId)) continue;
    seen.add(a.jobId);
    out.push(a.videoPath);              // the downloaded source (multi-GB for long videos)
    out.push(join(wsDir, 'clips', a.jobId)); // full-frame intermediate extracts
  }
  return out;
}

async function pathSizeBytes(p: string): Promise<number> {
  try {
    const s = await stat(p);
    if (s.isFile()) return s.size;
    if (s.isDirectory()) {
      let total = 0;
      for (const f of await readdir(p)) total += await pathSizeBytes(join(p, f));
      return total;
    }
  } catch { /* missing — nothing to free */ }
  return 0;
}

/** PURE: coerce a preset name onto the legacy Remotion style prop (unknown → bold). */
export function legacyStyle(preset: string): 'minimal' | 'card' | 'bold' {
  return preset === 'minimal' || preset === 'card' ? preset : 'bold';
}

/** PURE: source-time silence regions → clip-relative, clipped to [0, clipEnd-clipStart] (v4 Slice C). */
export function clipRelativeSilences(
  silences: { start: number; end: number }[], clipStart: number, clipEnd: number,
): { start: number; end: number }[] {
  const dur = clipEnd - clipStart;
  const out: { start: number; end: number }[] = [];
  for (const s of silences) {
    const start = Math.max(0, s.start - clipStart);
    const end = Math.min(dur, s.end - clipStart);
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** PURE: map an arc survivor to the diversity selector's input (v4 Slice B). visual is 0-1. */
export function survivorToSelectable(clip: RankedClip, sourceId: string, topic: string, visual: number): Selectable {
  return { id: clip.clip_id, composite: clip.composite_score, visual, topic, sourceId };
}

/** PURE: reason codes gathered during render that the audit should surface as degradations. */
export function collectUpstreamReasons(
  framingMode: 'blur' | 'crop', usedCenterFallback: boolean, belowFloor: boolean,
): ReasonCode[] {
  const codes: ReasonCode[] = [];
  if (framingMode === 'crop' && usedCenterFallback) codes.push(ReasonCode.FRAMING_FALLBACK_CENTER_CROP);
  if (belowFloor) codes.push(ReasonCode.CF_BELOW_RETENTION_FLOOR);
  return codes;
}

/** PURE: which AVSS variant dimensions the user's explicit flags freeze. */
export function buildPins(opts: AllOpts, hasHookText: boolean, sfxAvailable: boolean): VariantPins {
  return {
    captionPreset: Boolean(opts.style || opts.caption),
    zooms: opts.zooms === false,
    sfx: opts.sfx === false || !sfxAvailable,
    hook: !hasHookText,
  };
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
  const dl = isLocalInput(url)
    ? await ingestLocal(url, dirs.downloads)
    : await download(url, dirs.downloads);
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

  // Claude is the primary semantic brain (accuracy); Gemini Flash is the redundant fallback.
  // Cache per provider so switching keys doesn't reuse the other provider's scores.
  const chosen = pickSemanticProvider(process.env);
  sp = ora(`Analyzing semantics (${chosen})…`).start();
  const { windows: semantic, provider } = await analyzeSemanticAuto(segments, {
    geminiModel: process.env.GEMINI_MODEL,
    claudeModel: process.env.ANTHROPIC_MODEL,
    outPath: join(dirs.analysis, `layer_semantic_${chosen}.json`),
  });
  if (semantic.length > 0) sp.succeed(`semantic: ${semantic.length} windows (${provider})`);
  else sp.warn('semantic: unavailable → trigger+audio fallback');

  // v6 mode: explicit --mode wins; otherwise detect from metadata + semantic profile.
  const profile = resolveMode(opts.mode, meta, semantic);
  logger.info(`Mode: ${profile.name}${opts.mode && opts.mode !== 'auto' ? '' : ' (auto-detected)'} — clips ${profile.lengths.min}-${profile.lengths.max}s`);

  sp = ora('Detecting clips…').start();
  const boosts = commentBoosts(meta.topComments ?? [], 30, meta.duration);
  const windows = scoreWindows(meta.duration, triggers, audio, semantic, boosts);
  const threshold = opts.minScore ?? defaultMinScore(windows);
  const candidates = buildClips(windows, segments, audio, threshold, meta.duration, profile.lengths);
  sp.succeed(`Found ${candidates.length} candidates${boosts.length ? ` (${boosts.length} viewer-flagged moments)` : ''}`);

  // v7 arc engine (recall pass): mine complete micro-stories the scorer never surfaces.
  // Fail-soft — mining errors leave the scorer candidates untouched. No LLM → engine off.
  let arcCandidates = candidates;
  let motion: { time: number; v: number }[] = [];
  if (chosen !== 'none') {
    sp = ora('Mining micro-story arcs…').start();
    try {
      motion = await motionLayer(dl.videoPath, join(dirs.analysis, 'layer_motion.json'));
      const arcs = await mineArcs(
        chunkTranscript(segments),
        (c) => buildEvidenceBlock({
          window: { start: c.start, end: c.end },
          rms: toCurve(audio), motion, silences: audio.silence_regions,
        }),
        { cachePath: join(dirs.analysis, `layer_arcs_${chosen}.json`), durationSec: meta.duration, mode: profile.name, maxSpanSec: profile.lengths.max },
      );
      arcCandidates = mergeMinedCandidates(candidates, arcs);
      sp.succeed(`arcs: ${arcs.length} mined, ${arcCandidates.length} candidates total`);
    } catch (e) {
      sp.warn(`arc mining unavailable (${e instanceof Error ? e.message : String(e)}) — scorer candidates only`);
    }
  } else {
    logger.warn('arc engine OFF — no LLM provider (SEMANTIC_PROVIDER/keys); story gate disabled, pipeline runs as before');
  }

  return { jobId, url, videoPath: dl.videoPath, meta, segments, triggers, audio, semantic, candidates: arcCandidates, mode: profile.name, motion };
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

// ---- v7 arc engine: completion-stage pure helpers -----------------------------------------

export interface ArcRejection { clip_id: string; start: number; end: number; missing: string[]; reason: string; }
export interface ArcStatus { complete: boolean; missing: string[]; }

/** PURE: adapt the audio layer's rms curve to generic {time,v} points. */
export function toCurve(audio: AudioEnergyLayer): { time: number; v: number }[] {
  return audio.rms_curve.map((p) => ({ time: p.time, v: p.rms }));
}

/** PURE: widen a span by pad seconds, clamped into [0, max]. */
export function padSpan(span: { start: number; end: number }, pad: number, max: number): { start: number; end: number } {
  return { start: Math.max(0, span.start - pad), end: Math.min(max, span.end + pad) };
}

/** PURE: invert arcWeightedComposite to recover the raw scorer composite
 *  (2dp rounding on composite_score tolerated — error ≤0.01/0.75). */
export function rawComposite(clip: RankedClip): number {
  return clip.arc ? (clip.composite_score - 2.5 * arcScore(clip.arc)) / 0.75 : clip.composite_score;
}

/** PURE: apply a completion's label + resolved bounds to a clip and re-score it. */
export function applyCompletionToClip(
  clip: RankedClip, completion: ArcCompletion, bounds: { start: number; end: number },
): RankedClip {
  const label: ArcLabel = {
    synopsis: completion.synopsis, confidence: completion.confidence,
    components: completion.components, reactionAfterPeak: completion.reactionAfterPeak,
  };
  return {
    ...clip,
    start: bounds.start, end: bounds.end, duration: +(bounds.end - bounds.start).toFixed(2),
    arc: label,
    composite_score: +arcWeightedComposite(rawComposite(clip), label).toFixed(2),
  };
}

/** PURE: one row of the gate-rejection report. */
export function arcRejectionRow(clip: RankedClip, missing: string[], reason: string): ArcRejection {
  return { clip_id: clip.clip_id, start: clip.start, end: clip.end, missing, reason };
}

/**
 * Rank candidates from one or more VideoAnalysis results GLOBALLY by composite score and export
 * the selected clips (extract + face-track reframe + caption render + raw copy + manifest).
 * Returns the exports directory.
 */
export async function rankAndExport(analyses: VideoAnalysis[], opts: AllOpts): Promise<string> {
  // Per-analysis rank (within-video dedup + semantic attachment), tag each with its source.
  // Unless --allow-repeats, candidates overlapping previously exported ranges are dropped
  // first, so re-running the same video surfaces NEW moments.
  const pool: SourcedRankedClip[] = [];
  for (const analysis of analyses) {
    let candidates = analysis.candidates;
    if (!opts.allowRepeats) {
      const used = await loadUsedRanges(analysis.jobId);
      candidates = filterUsedCandidates(candidates, used);
      const excluded = analysis.candidates.length - candidates.length;
      if (excluded > 0) {
        logger.info(`[${analysis.jobId}] ${excluded} candidate(s) skipped as previously exported (--allow-repeats to reuse)`);
      }
      if (candidates.length === 0 && analysis.candidates.length > 0) {
        logger.warn(`[${analysis.jobId}] all strong moments already exported in earlier runs — rerun with --allow-repeats to reuse them`);
      }
    }
    // Mode grammar shapes the ordering: clippies rank up humor/shock, mindcuts wisdom/story.
    const ranked = rank(candidates, analysis.segments, {
      top: Infinity, minScore: opts.minScore, priorities: MODE_PROFILES[analysis.mode].priorities,
    }, analysis.semantic);
    for (const clip of ranked) pool.push({ clip, source: analysis });
  }

  // v7 completion pass + STRICT 6/6 gate: the top-K ranked candidates each get one
  // vision-capable arc-completion call; only complete stories export (--lenient overrides;
  // no LLM → today's behavior, no gate). Survivors are re-sorted by the refined composite.
  const provider = pickSemanticProvider(process.env);
  const arcRejections: ArcRejection[] = [];
  const arcStatus = new Map<string, ArcStatus>();          // keyed by FINAL clip_id
  const selectionByClip = new Map<string, SelectionExport>(); // v4 Slice B: why each clip was picked
  let selected: SourcedRankedClip[];
  if (provider === 'none') {
    selected = rankAcrossAnalyses(pool, { top: opts.top, perVideoCap: opts.perVideoCap });
  } else {
    const K = Math.max(opts.arcTopk ?? 8, opts.top);
    const topK = rankAcrossAnalyses(pool, { top: K, perVideoCap: opts.perVideoCap });
    const survivors: { item: SourcedRankedClip; status: ArcStatus; visual: number }[] = [];
    const spArc = ora(`Arc completion + 6/6 gate (${topK.length} candidates)…`).start();
    for (const item of topK) {
      const { clip, source } = item;
      const window = { start: clip.start, end: clip.end };
      const rmsCurve = toCurve(source.audio);
      const motion = source.motion ?? [];
      const evidence = buildEvidenceBlock({
        window: padSpan(window, 10, source.meta.duration),
        rms: rmsCurve, motion, silences: source.audio.silence_regions,
      });
      // Ladder: keyframes fail → completion proceeds numbers-only.
      const images = await extractKeyframes(
        source.videoPath,
        keyframeTimes(window, peakTime(rmsCurve, window), peakTime(motion, window)),
        join(WS, 'analysis', source.jobId, 'keyframes'),
      ).catch(() => []);
      // Visual feasibility (v4 Slice B) — a cheap windowed face sample (~0.2fps, a handful of
      // frames): a window with a clear on-screen subject frames cleanly; a faceless one is
      // framing-hostile. Neutral 0.5 when sampling/detection fails (don't punish a failure).
      const vfFrames = await detectFrameObs(
        source.videoPath, source.meta.width, source.meta.height, 0.2, window.end - window.start, window.start,
      ).catch(() => []);
      const visual = vfFrames.length > 0 ? scoreVisualFeasibility(vfFrames, [], window.start, window.end).score : 0.5;

      const contextSegments = source.segments.filter((s) => s.end > window.start - 60 && s.start < window.end + 60);
      const completion = await completeArc({
        window, segments: contextSegments, evidence, images,
        priorArc: clip.arc, mode: source.mode, durationSec: source.meta.duration,
        maxSec: MODE_PROFILES[source.mode].lengths.max,
      });
      const gate = gateArc(completion);
      if (!gate.pass) {
        arcRejections.push(arcRejectionRow(clip, gate.missing, completion ? 'incomplete-arc' : 'arc-label-failed'));
        if (!opts.lenient) continue;
        const withLabel = completion ? applyCompletionToClip(clip, completion, window) : clip;
        survivors.push({ item: { source, clip: withLabel }, status: { complete: false, missing: gate.missing }, visual });
        continue;
      }
      const used = opts.allowRepeats ? [] : await loadUsedRanges(source.jobId);
      const bounds = resolveBounds(completion!, {
        envelope: MODE_PROFILES[source.mode].lengths, segments: source.segments,
        used, durationSec: source.meta.duration,
      });
      if ('reject' in bounds) {
        arcRejections.push(arcRejectionRow(clip, [], bounds.reject));
        if (!opts.lenient) continue;
        // Arc complete but the expansion collided with used ranges; keep the original bounds.
        survivors.push({ item: { source, clip: applyCompletionToClip(clip, completion!, window) }, status: { complete: true, missing: [] }, visual });
        continue;
      }
      survivors.push({ item: { source, clip: applyCompletionToClip(clip, completion!, bounds) }, status: { complete: true, missing: [] }, visual });
    }
    spArc.succeed(`arc gate: ${survivors.length}/${topK.length} passed${arcRejections.length ? ` (${arcRejections.length} rejected)` : ''}`);
    // v4 Slice B: pick the final set by composite + visual feasibility − topic redundancy
    // (not pure composite), so framing-hostile moments drop and the pack shows topic range.
    const selectables = survivors.map((s) => survivorToSelectable(
      s.item.clip, s.item.source.jobId, topicOf(s.item.clip.start, s.item.clip.end, s.item.source.semantic), s.visual,
    ));
    const byId = new Map(survivors.map((s) => [s.item.clip.clip_id, s]));
    const kept = selectDiverse(selectables, opts.top).map((w) => byId.get(w.id)!);
    selected = kept.map(({ item, visual }, i) => ({
      source: item.source,
      clip: { ...item.clip, rank: i + 1, clip_id: `clip_${String(i + 1).padStart(3, '0')}`, visual_score: +(visual * 10).toFixed(2) },
    }));
    kept.forEach((s, i) => arcStatus.set(`clip_${String(i + 1).padStart(3, '0')}`, s.status));
    if (arcRejections.length > 0) {
      const t = new Table({ head: ['Span', 'Missing', 'Reason'] });
      arcRejections.forEach((r) => t.push([`${r.start.toFixed(1)}-${r.end.toFixed(1)}s`, r.missing.join(', ') || '—', r.reason]));
      logger.info('\nArc gate rejections:\n' + t.toString());
    }
    if (selected.length === 0) {
      logger.warn('arc gate: ZERO clips passed 6/6 — nothing to export. See the rejection table (--lenient to export anyway).');
    }
  }

  // v4 Slice B: record why each selected clip was picked (top feature contributions). A topic
  // is "new" the first time it appears in the ordered selection; repeats aren't (diversity).
  const seenTopics = new Set<string>();
  for (const { clip, source } of selected) {
    const topic = topicOf(clip.start, clip.end, source.semantic);
    const isNew = topic !== '' && !seenTopics.has(topic);
    if (topic) seenTopics.add(topic);
    const visual = clip.visual_score / 10;
    const filler = +fillerRatio(clip.transcript_excerpt).toFixed(2);
    selectionByClip.set(clip.clip_id, {
      features: { composite: clip.composite_score, visual: +visual.toFixed(2), semantic: clip.semantic_score, filler_penalty: filler, topic },
      why: buildSelectionWhy({ visual, composite: clip.composite_score, semantic: clip.semantic_score, fillerPenalty: filler }, topic, isNew),
    });
  }

  const id = analyses.length === 1 ? analyses[0].jobId : batchId(analyses.map((a) => a.url));
  const exportsDir = join(WS, 'exports', id);

  const musicLib = opts.music === false
    ? {}
    : await scanLibrary(opts.musicDir ?? process.env.MUSIC_DIR ?? './music');
  const sfxLib = opts.sfx === false
    ? {}
    : await scanSfxLibrary(opts.sfxDir ?? process.env.SFX_DIR ?? './sfx');

  // AVSS: the learning policy + elite templates steer variant A (exploit); loaded once
  // per run, entirely fail-soft (cold start = mode defaults, no exploration bias).
  let policy: Policy = defaultPolicy();
  let templates: EliteTemplate[] = [];
  try {
    policy = await loadPolicy();
    templates = await loadTemplates();
  } catch (e) {
    logger.warn(`avss: policy/templates unavailable — cold start (${e instanceof Error ? e.message : String(e)})`);
  }
  if (templates.length > 0) logger.info(`avss: ${templates.length} elite template(s) loaded`);

  // Render each clip independently — a single clip that errors or hangs (killed by the render
  // stall-watchdog) is skipped so it can't lose the whole batch. Only clips that fully export
  // go into the manifest.
  const succeeded: SourcedRankedClip[] = [];
  const packs = new Map<string, SeoPack>();
  const brollByClip = new Map<string, BrollSegment[]>();
  const avssByClip = new Map<string, AvssExport>();
  const qualityByClip = new Map<string, ClipQuality>();
  const edlByClip = new Map<string, ClipEdl>();
  // AVSS retention floor. Clips are NOT dropped: those whose winning variant simulates below
  // the floor still render, but into the exports/<job>/below_retention/ subfolder instead of the
  // top-level dir. Set --min-retention 0 to send everything to the top level.
  const retentionFloor = opts.minRetention ?? 0.70;
  const belowFloor: { clip_id: string; start: number; end: number; retention: number }[] = [];
  const belowFloorIds = new Set<string>();
  const belowDir = join(exportsDir, 'below_retention');
  for (const { clip, source } of selected) {
    const sp2 = ora(`[${clip.clip_id}] (${source.jobId}) extract + caption…`).start();
    const clipsDir = join(WS, 'clips', source.jobId);
    const profile = MODE_PROFILES[source.mode];
    const dims = aspectDims(opts.aspect ?? '9:16');

    try {
      // SEO pack from THIS clip's source metadata (batch runs mix creators).
      const pack = buildSeoPack(clip, source.meta);
      packs.set(clip.clip_id, pack);

      const clipWords = source.segments.flatMap((s) => s.words).filter((w) => w.end > clip.start && w.start < clip.end);
      const captionWords = buildCaptionWords(clipWords, clip.start, source.triggers.map((t) => t.phrase));
      // SRT is written per-tier once the retention tier (top vs. below_retention/) is known below.

      // v4 Slice C: plan internal cuts (dead air + safe filler). AVSS + framing run on the
      // pre-cut timeline; the cut is applied to the extract, and everything the RENDER consumes
      // (words/zoom/broll) is remapped through the TimeMap just before render so the whole
      // render lives on one (compressed, output) timeline. Identity map = no behavior change.
      const clipRms = source.audio.rms_curve.filter((p) => p.time >= clip.start && p.time <= clip.end);
      const meanRms = clipRms.length ? clipRms.reduce((a, p) => a + p.rms, 0) / clipRms.length : 5;
      const pace = paceTarget({ wordsPerSec: captionWords.length / Math.max(clip.duration, 1e-6), meanRms, mode: source.mode });
      const tighten = opts.tighten === false
        ? { keep: [{ start: 0, end: clip.duration }] as KeepSegment[], map: identityTimeMap(clip.duration), removedSec: 0 }
        : planTighten(clip.duration, clipRelativeSilences(source.audio.silence_regions, clip.start, clip.end), captionWords, paceToTighten(pace));

      // Both modes render from the full 16:9 extract: 'crop' pans/zooms a face track over it,
      // 'blur' centers it over a blurred backdrop. Blur is the default (natural, no face cutting).
      // The extract is CUT to the kept segments (Slice C); planFraming then sees output time.
      const fullPath = join(clipsDir, `${clip.clip_id}_full.mp4`);
      await extractTightened(source.videoPath, clip.start, clip.duration, tighten.keep, fullPath);
      const { mode, track, faces } = await planFraming(fullPath, source.meta.width, source.meta.height, 3,
        resolveFraming(opts.framing, profile), dims.ratio);

      const accentColor = sentimentColor(clip.sentiment, opts.accent);

      // Contextual B-roll (narrative overlay): on for mindcuts by default, forced via --broll.
      // Entirely fail-soft — a clip never fails over B-roll.
      const brollOn = opts.broll ?? profile.brollDefault;
      const overlays = brollOn ? await acquireBroll({
        segments: source.segments, clipStart: clip.start, clipEnd: clip.end,
        sentiment: clip.sentiment, maxBroll: opts.maxBroll ?? profile.maxBroll,
        cacheDir: opts.brollDir ?? process.env.BROLL_DIR ?? './broll_cache',
        excludeId: source.jobId, label: clip.clip_id,
      }) : [];
      if (overlays.length > 0) brollByClip.set(clip.clip_id, overlays);

      // ---- AVSS: base plan → A/B/C variants → regulate → simulate → winner ----
      // Fail-soft: any error falls back to the regulated base plan (today's behavior).
      const preset = opts.style ?? profile.captionPreset;
      const sfxAvailable = Object.keys(sfxLib).length > 0 && opts.sfx !== false;
      const basePlan = buildEditPlan({
        profile, captionPreset: preset,
        hookMoment: clip.hook_moment || undefined, clipTitle: clip.clip_titles[0],
        words: captionWords,
        overlays: overlays.map((o) => ({ atSec: o.atSec, durationSec: o.durationSec })),
        zoomsEnabled: opts.zooms !== false, sfxEnabled: sfxAvailable,
        sfxVolume: opts.sfxVolume ?? 0.6, musicOn: opts.music !== false,
      });
      const signals = buildSourceSignals(clip, captionWords, source.audio, source.semantic);
      let plan = regulate(basePlan, clip.duration).plan;
      let winnerRetention: number | undefined;   // undefined ⇒ simulation failed ⇒ can't gate ⇒ keep
      try {
        const variants = generateVariants(basePlan, {
          mode: source.mode, policy, templates,
          pins: buildPins(opts, Boolean(basePlan.hookText), sfxAvailable),
          seed: `${source.jobId}_${clip.clip_id}`, words: captionWords, durationSec: clip.duration,
          hookAlternatives: { moment: clip.hook_moment || undefined, title: clip.clip_titles[0] },
        });
        const scored = scoreVariants(variants, signals);
        const winner = pickWinner(scored);
        plan = winner.variant.plan;
        winnerRetention = winner.sim.avgRetention;
        avssByClip.set(clip.clip_id, {
          winner, all: scored, dna: extractDna(plan, signals, source.mode), policyVersion: policy.version,
        });
        logger.info(`[${clip.clip_id}] avss: winner ${winner.variant.id} — predicted retention ${(winner.sim.avgRetention * 100).toFixed(0)}%${winner.variant.changed.length > 0 ? ` (changed: ${winner.variant.changed.join(', ')})` : ''}`);
      } catch (e) {
        logger.warn(`[${clip.clip_id}] avss simulation failed — using base plan: ${e instanceof Error ? e.message : String(e)}`);
      }

      // v4 Slice C: apply the internal cuts to everything the RENDER consumes → output timeline
      // (matches the cut extract's cropTrack/faces). Identity map = these are no-ops.
      const renderWords = mapWords(tighten.map, captionWords);
      const zoomOut = mapTimes(tighten.map, plan.zoom.times);
      const overlaysOut = overlays
        .filter((o) => isKept(tighten.map, o.atSec))
        .map((o) => ({ ...o, atSec: srcToOut(tighten.map, o.atSec) }));
      if (overlaysOut.length > 0) brollByClip.set(clip.clip_id, overlaysOut);
      else brollByClip.delete(clip.clip_id);
      if (tighten.removedSec > 0) logger.info(`[${clip.clip_id}] tightened −${tighten.removedSec.toFixed(1)}s (${tighten.keep.length} segments)`);

      // Retention tier: a complete-story clip can still simulate below the watchable bar. It's
      // NOT dropped — it renders into the below_retention/ subfolder so it's segregated but kept.
      // A failed simulation (no prediction) can't be judged, so it stays in the top tier.
      const isBelow = winnerRetention !== undefined && winnerRetention < retentionFloor;
      if (isBelow) {
        belowFloorIds.add(clip.clip_id);
        belowFloor.push({ clip_id: clip.clip_id, start: clip.start, end: clip.end, retention: winnerRetention! });
      }
      const outDir = isBelow ? belowDir : exportsDir;
      await mkdir(outDir, { recursive: true });
      const finalPath = join(outDir, `${clip.clip_id}_final.mp4`);
      await writeSrt(renderWords, join(outDir, `${clip.clip_id}.srt`));

      // Arrow callouts at the speaker's face on the same peak moments the zooms hit —
      // suppressed while B-roll covers the face. Rides the WINNER's zoom times (output timeline).
      const callouts = filterCallouts(zoomOut.length === 0 ? [] : planCallouts(
        zoomOut, faces,
        { mode, track, srcW: source.meta.width, srcH: source.meta.height },
      ), overlaysOut);

      // Caption preset: explicit --style/--caption pin wins; otherwise the winner plan's.
      const caption = opts.caption ?? resolveCaptionStyle(plan.captionPreset, opts.captionOverrides ?? {});

      await render({
        rawClipPath: fullPath, words: renderWords, outPath: finalPath, fps: source.meta.fps,
        accentColor, style: legacyStyle(plan.captionPreset), caption, zooms: opts.zooms,
        zoomIntensity: plan.zoom.intensity,
        zoomTimes: zoomOut,
        framing: mode,
        outWidth: dims.outW, outHeight: dims.outH,
        ...(mode === 'crop' ? { cropTrack: track, srcW: source.meta.width, srcH: source.meta.height } : {}),
        ...(callouts.length > 0 ? { callouts } : {}),
        ...(overlaysOut.length > 0 ? { broll: overlaysOut } : {}),
        hookText: plan.hookText,
      });
      if (callouts.length > 0) logger.info(`[${clip.clip_id}] ${callouts.length} arrow callout(s)`);
      logger.info(mode === 'crop'
        ? `[${clip.clip_id}] smart-crop (${track.length} face keyframes)`
        : `[${clip.clip_id}] blur-background framing`);

      // sound design: impact under the hook card + whooshes on the winner's zoom times
      // (visuals and sounds share the plan's array by construction).
      const sfxEvents = plan.sfx.enabled ? planSfx(zoomOut, sfxLib, {
        hasHook: Boolean(plan.hookText), seed: `${source.jobId}_${clip.clip_id}`,
      }) : [];
      if (sfxEvents.length) {
        const tmpSfx = finalPath.replace(/\.mp4$/, '.sfx.mp4');
        await mixSfx(finalPath, sfxEvents, tmpSfx, { sfxVolume: plan.sfx.volume });
        await rename(tmpSfx, finalPath);
        logger.info(`[${clip.clip_id}] sfx: ${sfxEvents.length} event(s)`);
      }

      // mood-matched background music, ducked under speech (skipped when no track fits)
      const mood = sentimentToMood(clip.sentiment);
      const musicTrack = pickTrack(musicLib, mood, `${source.jobId}_${clip.clip_id}`);
      if (musicTrack) {
        const tmpPath = finalPath.replace(/\.mp4$/, '.music.mp4');
        await mixMusic(finalPath, musicTrack, tmpPath, { musicVolume: opts.musicVolume ?? 0.25 });
        await rename(tmpPath, finalPath);
        logger.info(`[${clip.clip_id}] music: ${basename(musicTrack)} (${mood})`);
      }

      // Loudness normalization — the LAST audio step so it normalizes the final mix
      // (speech + sfx + music). Fail-soft: on measurement/apply failure the original ships.
      const targetLufs = opts.targetLufs ?? TARGET_LUFS;
      let measuredForGate: number | null;
      if (opts.loudnorm === false) {
        measuredForGate = targetLufs;                 // opted out → don't flag as un-normalized
      } else {
        const tmpLoud = finalPath.replace(/\.mp4$/, '.loud.mp4');
        const m = await normalizeLoudness(finalPath, tmpLoud, targetLufs);
        if (m) {
          await rename(tmpLoud, finalPath);
          measuredForGate = m.input_i;                // pre-norm level; audit → pass or "adjusted"
          logger.info(`[${clip.clip_id}] loudness: ${m.input_i.toFixed(1)} → ${targetLufs} LUFS`);
        } else {
          await rm(tmpLoud, { force: true });
          measuredForGate = null;                     // measurement failed → audit records a gate error
          logger.warn(`[${clip.clip_id}] loudness normalization unavailable — shipping source loudness`);
        }
      }

      // Pre-export audit: gates + reason codes → clip.json quality block. Cues on the OUTPUT
      // timeline (post-cut); cut integrity is checked against the pre-cut words + kept segments.
      const cues = buildCaptionCues(renderWords);
      const usedCenterFallback = mode === 'crop' && faces.filter((f) => f.box).length === 0;
      const quality = runAudit({
        arc: arcStatus.get(clip.clip_id),
        cues, cueConstraints: DEFAULT_CUE_CONSTRAINTS,
        measuredLufs: measuredForGate, targetLufs,
        durationSec: clip.duration, lenMin: profile.lengths.min, lenMax: profile.lengths.max,
        faces, cropTrack: mode === 'crop' ? track : null, subjectFloor: SUBJECT_IN_FRAME_FLOOR,
        upstreamReasons: collectUpstreamReasons(mode, usedCenterFallback, isBelow),
        keep: tighten.keep, preCutWords: captionWords,
      });
      qualityByClip.set(clip.clip_id, quality);
      edlByClip.set(clip.clip_id, buildClipEdl({
        clip, framing: mode, cropTrack: track, cues,
        zoomTimes: zoomOut, sfxTimes: sfxEvents.map((e) => e.time),
        captionPreset: plan.captionPreset, music: Boolean(musicTrack), hookText: plan.hookText,
        audioOps: opts.loudnorm === false ? [] : [{ type: 'loudnorm', targetLufs }],
        keep: tighten.keep.map((k) => ({ start: clip.start + k.start, end: clip.start + k.end })),
        rationale: {
          director: clip.reason,
          framing: mode === 'crop' ? 'full-screen face/speaker crop' : 'blur backdrop',
          ...(tighten.removedSec > 0 ? { editor: `tightened −${tighten.removedSec.toFixed(1)}s (${tighten.keep.length} segments)` } : {}),
        },
      }));
      if (!quality.passed) logger.warn(`[${clip.clip_id}] audit: ${quality.reasonCodes.join(', ')}`);

      // thumbnail: loudest frame of the clip, stamped with the SEO thumbnail text.
      // Never fail a fully-rendered clip over a PNG — warn and move on.
      try {
        // Thumbnail time is on the OUTPUT timeline (fullPath is the cut clip); map the chosen
        // source moment through the TimeMap so it lands on kept footage.
        const thumbRel = srcToOut(tighten.map, Math.max(0, pickThumbnailTime(clip, source.audio.rms_curve) - clip.start));
        // Zoom the thumbnail toward the face nearest the chosen moment (looser 2s tolerance).
        const thumbFace = faceAt(faces, thumbRel, 2);
        await generateThumbnail(fullPath, thumbRel, pack.thumbnailText, join(outDir, `${clip.clip_id}_thumbnail.png`), {
          accent: accentColor,
          ...(thumbFace?.box ? {
            face: {
              x: (thumbFace.box.x + thumbFace.box.w / 2) / source.meta.width,
              y: (thumbFace.box.y + thumbFace.box.h / 2) / source.meta.height,
            },
          } : {}),
        });
      } catch (e) {
        logger.warn(`[${clip.clip_id}] thumbnail failed (clip export continues): ${e instanceof Error ? e.message : String(e)}`);
      }

      // copy raw into the clip's tier folder for completeness
      await copyFile(fullPath, join(outDir, `${clip.clip_id}_raw.mp4`));
      succeeded.push({ clip, source });
      sp2.succeed(`[${clip.clip_id}] done`);
    } catch (e) {
      sp2.fail(`[${clip.clip_id}] skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (belowFloor.length > 0) {
    const t = new Table({ head: ['Clip', 'Span', 'Predicted retention', 'Floor'] });
    belowFloor.forEach((r) => t.push([
      r.clip_id, `${r.start.toFixed(1)}-${r.end.toFixed(1)}s`, `${(r.retention * 100).toFixed(0)}%`, `${(retentionFloor * 100).toFixed(0)}%`,
    ]));
    logger.info(`\n${belowFloor.length} clip(s) below the ${(retentionFloor * 100).toFixed(0)}% retention floor → segregated into below_retention/:\n` + t.toString());
  }

  // Record exported ranges per source so future runs avoid reusing this material.
  const bySource = new Map<string, typeof succeeded>();
  for (const s of succeeded) {
    (bySource.get(s.source.jobId) ?? bySource.set(s.source.jobId, []).get(s.source.jobId)!).push(s);
  }
  for (const [jobId, items] of bySource) {
    await appendUsedRanges(jobId, items.map(({ clip }) => ({
      start: clip.start, end: clip.end, clip_id: clip.clip_id, exportedAt: new Date().toISOString(),
    })));
  }

  const ranked = succeeded.map((s) => s.clip);
  const primary = analyses[0];
  const failedOrSkipped = selected.length - ranked.length;
  if (failedOrSkipped > 0) {
    logger.warn(`${failedOrSkipped}/${selected.length} clip(s) failed/skipped; manifest has the ${ranked.length} that exported.`);
  }
  // v7: per-clip arc block (gate status + refined label) for clip.json + the manifest.
  const arcByClip = new Map<string, ArcExport>();
  for (const clip of ranked) {
    const status = arcStatus.get(clip.clip_id);
    if (!status) continue;
    arcByClip.set(clip.clip_id, {
      complete: status.complete, missing: status.missing,
      arcScore: clip.arc ? +arcScore(clip.arc).toFixed(4) : 0,
      synopsis: clip.arc?.synopsis ?? '',
      reactionAfterPeak: clip.arc?.reactionAfterPeak ?? false,
      components: clip.arc?.components ?? {},
      provider,
    });
  }
  // Two self-contained folders: top-level exports/<job>/ keeps today's layout (GUI + upload read
  // it unchanged), while sub-floor clips get their own manifest under below_retention/.
  const aboveClips = ranked.filter((c) => !belowFloorIds.has(c.clip_id));
  const belowClips = ranked.filter((c) => belowFloorIds.has(c.clip_id));
  await writeExports(exportsDir, id, primary.url, primary.meta, aboveClips, packs, brollByClip, avssByClip, arcByClip, arcRejections, qualityByClip, edlByClip, selectionByClip);
  if (belowClips.length > 0) {
    await writeExports(belowDir, id, primary.url, primary.meta, belowClips, packs, brollByClip, avssByClip, arcByClip, [], qualityByClip, edlByClip, selectionByClip);
  }

  // Per-run report: every clip's audit outcome + a tally of every reason code that fired.
  const reportClips: RunReportClip[] = ranked.map((c) => {
    const q = qualityByClip.get(c.clip_id);
    const a = avssByClip.get(c.clip_id);
    return {
      clip_id: c.clip_id,
      passed: q?.passed ?? true,
      degraded: q?.degraded ?? false,
      degradations: q?.degradations ?? [],
      ...(a ? { predicted_retention: +a.winner.sim.avgRetention.toFixed(4) } : {}),
      tier: belowFloorIds.has(c.clip_id) ? 'below_retention' as const : 'top' as const,
    };
  });
  await writeRunReport(exportsDir, buildRunReport(id, primary.url, reportClips, []));
  const rep = { passed: reportClips.filter((c) => c.passed).length, degraded: reportClips.filter((c) => c.degraded).length };
  logger.info(`audit: ${rep.passed}/${reportClips.length} passed all gates, ${rep.degraded} degraded → run_report.json`);

  const baseHead = analyses.length === 1 ? ['Rank', 'Score', 'Dur', 'Excerpt'] : ['Rank', 'Score', 'Dur', 'Source', 'Excerpt'];
  const head = belowFloor.length > 0 ? [...baseHead, 'Tier'] : baseHead;
  const table = new Table({ head });
  ranked.forEach((c) => {
    const row: (string | number)[] = [c.rank, c.composite_score, `${Math.round(c.duration)}s`];
    if (analyses.length > 1) row.push(c.source_video ?? '');
    row.push(c.transcript_excerpt.slice(0, 40));
    if (belowFloor.length > 0) row.push(belowFloorIds.has(c.clip_id) ? 'below_retention' : 'top');
    table.push(row);
  });
  logger.info('\n' + table.toString());

  // Free the big source download(s) + intermediates once clips are safely exported.
  // Never delete the source if nothing exported — that would throw away recoverable work.
  if (opts.deleteSource && ranked.length > 0) {
    let freed = 0;
    for (const p of cleanupTargets(analyses, WS)) {
      freed += await pathSizeBytes(p);
      await rm(p, { recursive: true, force: true });
    }
    logger.info(`Deleted source video + intermediates — freed ~${(freed / 1e6).toFixed(0)} MB`);
  }

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
