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
import { writeExports } from '../../export/exporter.js';
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
  let selected: SourcedRankedClip[];
  if (provider === 'none') {
    selected = rankAcrossAnalyses(pool, { top: opts.top, perVideoCap: opts.perVideoCap });
  } else {
    const K = Math.max(opts.arcTopk ?? 8, opts.top);
    const topK = rankAcrossAnalyses(pool, { top: K, perVideoCap: opts.perVideoCap });
    const survivors: { item: SourcedRankedClip; status: ArcStatus }[] = [];
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
        survivors.push({ item: { source, clip: withLabel }, status: { complete: false, missing: gate.missing } });
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
        survivors.push({ item: { source, clip: applyCompletionToClip(clip, completion!, window) }, status: { complete: true, missing: [] } });
        continue;
      }
      survivors.push({ item: { source, clip: applyCompletionToClip(clip, completion!, bounds) }, status: { complete: true, missing: [] } });
    }
    spArc.succeed(`arc gate: ${survivors.length}/${topK.length} passed${arcRejections.length ? ` (${arcRejections.length} rejected)` : ''}`);
    survivors.sort((a, b) => b.item.clip.composite_score - a.item.clip.composite_score);
    const kept = survivors.slice(0, opts.top);
    selected = kept.map(({ item }, i) => ({
      source: item.source,
      clip: { ...item.clip, rank: i + 1, clip_id: `clip_${String(i + 1).padStart(3, '0')}` },
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
  for (const { clip, source } of selected) {
    const sp2 = ora(`[${clip.clip_id}] (${source.jobId}) extract + caption…`).start();
    const finalPath = join(exportsDir, `${clip.clip_id}_final.mp4`);
    const clipsDir = join(WS, 'clips', source.jobId);
    const profile = MODE_PROFILES[source.mode];
    const dims = aspectDims(opts.aspect ?? '9:16');

    try {
      // SEO pack from THIS clip's source metadata (batch runs mix creators).
      const pack = buildSeoPack(clip, source.meta);
      packs.set(clip.clip_id, pack);

      const clipWords = source.segments.flatMap((s) => s.words).filter((w) => w.end > clip.start && w.start < clip.end);
      const captionWords = buildCaptionWords(clipWords, clip.start, source.triggers.map((t) => t.phrase));
      await writeSrt(captionWords, join(exportsDir, `${clip.clip_id}.srt`));

      // Both modes render from the full 16:9 extract: 'crop' pans/zooms a face track over it,
      // 'blur' centers it over a blurred backdrop. Blur is the default (natural, no face cutting).
      const fullPath = join(clipsDir, `${clip.clip_id}_full.mp4`);
      await extractFullFrame(source.videoPath, clip.start, clip.end, fullPath);
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
        avssByClip.set(clip.clip_id, {
          winner, all: scored, dna: extractDna(plan, signals, source.mode), policyVersion: policy.version,
        });
        logger.info(`[${clip.clip_id}] avss: winner ${winner.variant.id} — predicted retention ${(winner.sim.avgRetention * 100).toFixed(0)}%${winner.variant.changed.length > 0 ? ` (changed: ${winner.variant.changed.join(', ')})` : ''}`);
      } catch (e) {
        logger.warn(`[${clip.clip_id}] avss simulation failed — using base plan: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Arrow callouts at the speaker's face on the same peak moments the zooms hit —
      // suppressed while B-roll covers the face. Rides the WINNER's zoom times.
      const callouts = filterCallouts(plan.zoom.times.length === 0 ? [] : planCallouts(
        plan.zoom.times, faces,
        { mode, track, srcW: source.meta.width, srcH: source.meta.height },
      ), overlays);

      // Caption preset: explicit --style/--caption pin wins; otherwise the winner plan's.
      const caption = opts.caption ?? resolveCaptionStyle(plan.captionPreset, opts.captionOverrides ?? {});

      await render({
        rawClipPath: fullPath, words: captionWords, outPath: finalPath, fps: source.meta.fps,
        accentColor, style: legacyStyle(plan.captionPreset), caption, zooms: opts.zooms,
        zoomIntensity: plan.zoom.intensity,
        zoomTimes: plan.zoom.times,
        framing: mode,
        outWidth: dims.outW, outHeight: dims.outH,
        ...(mode === 'crop' ? { cropTrack: track, srcW: source.meta.width, srcH: source.meta.height } : {}),
        ...(callouts.length > 0 ? { callouts } : {}),
        ...(overlays.length > 0 ? { broll: overlays } : {}),
        hookText: plan.hookText,
      });
      if (callouts.length > 0) logger.info(`[${clip.clip_id}] ${callouts.length} arrow callout(s)`);
      logger.info(mode === 'crop'
        ? `[${clip.clip_id}] smart-crop (${track.length} face keyframes)`
        : `[${clip.clip_id}] blur-background framing`);

      // sound design: impact under the hook card + whooshes on the winner's zoom times
      // (visuals and sounds share the plan's array by construction).
      const sfxEvents = plan.sfx.enabled ? planSfx(plan.zoom.times, sfxLib, {
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

      // thumbnail: loudest frame of the clip, stamped with the SEO thumbnail text.
      // Never fail a fully-rendered clip over a PNG — warn and move on.
      try {
        const thumbRel = Math.max(0, pickThumbnailTime(clip, source.audio.rms_curve) - clip.start);
        // Zoom the thumbnail toward the face nearest the chosen moment (looser 2s tolerance).
        const thumbFace = faceAt(faces, thumbRel, 2);
        await generateThumbnail(fullPath, thumbRel, pack.thumbnailText, join(exportsDir, `${clip.clip_id}_thumbnail.png`), {
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

      // copy raw into exports for completeness
      await mkdir(exportsDir, { recursive: true });
      await copyFile(fullPath, join(exportsDir, `${clip.clip_id}_raw.mp4`));
      succeeded.push({ clip, source });
      sp2.succeed(`[${clip.clip_id}] done`);
    } catch (e) {
      sp2.fail(`[${clip.clip_id}] skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
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
  if (ranked.length < selected.length) {
    logger.warn(`${selected.length - ranked.length}/${selected.length} clip(s) failed/skipped; manifest has the ${ranked.length} that exported.`);
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
  await writeExports(exportsDir, id, primary.url, primary.meta, ranked, packs, brollByClip, avssByClip, arcByClip, arcRejections);

  const head = analyses.length === 1 ? ['Rank', 'Score', 'Dur', 'Excerpt'] : ['Rank', 'Score', 'Dur', 'Source', 'Excerpt'];
  const table = new Table({ head });
  ranked.forEach((c) => {
    const row = [c.rank, c.composite_score, `${Math.round(c.duration)}s`];
    if (analyses.length > 1) row.push(c.source_video ?? '');
    row.push(c.transcript_excerpt.slice(0, 40));
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
