# v4 Slice A — Audit & Report Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ClipForge a measurement backbone — a shared reason-code vocabulary, a per-clip quality audit with typed pass/autofix/fail gates, loudness normalization, a persisted per-clip EDL (render-decision record), and a per-run `run_report.json` — so that no degradation is silent, every exported clip carries a `quality` block, and edit-decision drift fails CI.

**Architecture:** Two new pure-logic packages, `src/report/` (reason codes, EDL, run report) and `src/quality/` (safe-area config, gates, audit runner), plus one `src/audio/loudness.ts` ffmpeg wrapper. The pipeline (`rankAndExport` in `all.ts`) already computes everything the gates need (arc status, framing mode + crop track + face samples, caption words, retention prediction); Slice A reads those, runs the audit, and threads a `ClipQuality` + `ClipEdl` per clip into the exporter and a `RunReport` into the exports dir. No new capabilities, no Python, no new models — this is instrumentation over the existing pipeline.

**Tech Stack:** TypeScript (ESM, Node 24), vitest, ffmpeg (`loudnorm` two-pass via the existing `run`/`runFfmpegNull` utils), Next.js GUI (badge only).

## Global Constraints

- No Python, no new model dependencies (v4 decision, 2026-07-06). Reason codes and gates are TS-native.
- Reason-code enum values copied verbatim from spec Part 1 §7.4; ClipForge-specific additions are namespaced and documented.
- All new core logic is pure (I/O only in the ffmpeg wrapper + file writers); tests mirror under `tests/report/` and `tests/quality/`, importing `../../src/<pkg>/<mod>.js`.
- Fail-soft: the audit NEVER throws into the render path — a gate that errors is recorded as a `fail` with detail, the clip still exports (audit is advisory in Slice A; it gates hard only in a later slice once every gate is trustworthy). Loudness normalization failure logs and ships the un-normalized clip.
- Keep the existing arc gate (6/6) and AVSS retention floor exactly as they are — the audit *records* their outcomes, it does not replace them.
- Times are clip-relative seconds unless a field says otherwise. Safe-area rect values are fractions in [0,1].
- Standing gates after every task: `npx vitest run` green, `npx tsc --noEmit` clean (root), `cd remotion && npx tsc --noEmit` clean, `cd ui && npx next build` clean.

---

### Task 1: Reason-code enum (`src/report/reasonCodes.ts`)

**Files:**
- Create: `src/report/reasonCodes.ts`
- Test: `tests/report/reasonCodes.test.ts`

**Interfaces:**
- Produces (used by every later task): the `ReasonCode` enum and `ReasonCodeCounts` type.

```ts
export enum ReasonCode {
  // spec Part 1 §7.4 (verbatim)
  FRAMING_FALLBACK_CENTER_CROP = 'FRAMING_FALLBACK_CENTER_CROP',
  FRAMING_LOW_TRACK_CONFIDENCE = 'FRAMING_LOW_TRACK_CONFIDENCE',
  FRAMING_MULTI_SUBJECT_UNRESOLVED = 'FRAMING_MULTI_SUBJECT_UNRESOLVED',
  ASR_LOW_CONFIDENCE_SEGMENT = 'ASR_LOW_CONFIDENCE_SEGMENT',
  DIARIZATION_UNKNOWN_SPEAKER = 'DIARIZATION_UNKNOWN_SPEAKER',
  DIRECTOR_NO_ARC_FOUND = 'DIRECTOR_NO_ARC_FOUND',
  EDITOR_CUT_ON_NON_BOUNDARY = 'EDITOR_CUT_ON_NON_BOUNDARY',
  QUALITY_CAPTION_OVERFLOW = 'QUALITY_CAPTION_OVERFLOW',
  QUALITY_SUBJECT_OUT_OF_FRAME = 'QUALITY_SUBJECT_OUT_OF_FRAME',
  MODEL_UNAVAILABLE_STEPDOWN = 'MODEL_UNAVAILABLE_STEPDOWN',
  GPU_OOM_STEPDOWN = 'GPU_OOM_STEPDOWN',
  // ClipForge additions (namespaced CF_)
  CF_AUDIO_LOUDNESS_ADJUSTED = 'CF_AUDIO_LOUDNESS_ADJUSTED',
  CF_BELOW_RETENTION_FLOOR = 'CF_BELOW_RETENTION_FLOOR',
  CF_AUDIT_GATE_ERROR = 'CF_AUDIT_GATE_ERROR',
}
export type ReasonCodeCounts = Partial<Record<ReasonCode, number>>;
export function tallyReasonCodes(codes: ReasonCode[]): ReasonCodeCounts;
```

- [ ] **Step 1: Write the failing test** — `tests/report/reasonCodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ReasonCode, tallyReasonCodes } from '../../src/report/reasonCodes.js';

describe('ReasonCode', () => {
  it('enum values equal their keys (stable serialized strings)', () => {
    for (const [k, v] of Object.entries(ReasonCode)) expect(v).toBe(k);
  });
});
describe('tallyReasonCodes', () => {
  it('counts occurrences', () => {
    const t = tallyReasonCodes([
      ReasonCode.DIRECTOR_NO_ARC_FOUND, ReasonCode.DIRECTOR_NO_ARC_FOUND, ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED,
    ]);
    expect(t[ReasonCode.DIRECTOR_NO_ARC_FOUND]).toBe(2);
    expect(t[ReasonCode.CF_AUDIO_LOUDNESS_ADJUSTED]).toBe(1);
    expect(t[ReasonCode.GPU_OOM_STEPDOWN]).toBeUndefined();
  });
  it('empty input → empty tally', () => { expect(tallyReasonCodes([])).toEqual({}); });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/report/reasonCodes.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** `src/report/reasonCodes.ts` per the interface. `tallyReasonCodes` reduces into a `Partial<Record<...>>`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(report): reason-code enum + tally (v4 Slice A)`

### Task 2: Safe-area config (`src/quality/safeArea.ts`)

**Files:**
- Create: `src/quality/safeArea.ts`
- Test: `tests/quality/safeArea.test.ts`

**Interfaces:**
- Produces (Tasks 5, 6, 9): `SafeArea`, `PLATFORM_SAFE_AREA`, `captionBandRect`.

```ts
/** Fractions of the 9:16 output frame reserved by platform UI. */
export interface SafeArea { top: number; bottom: number; left: number; right: number; }
/** Shorts/Reels/TikTok share a similar band: ~12% top (clock/close), ~18% bottom (caption/CTA), 5% sides. */
export const PLATFORM_SAFE_AREA: SafeArea;
/** PURE: the vertical band (yTop..yBottom, fractions) where burned captions sit — just above the bottom UI. */
export function captionBandRect(sa?: SafeArea): { yTop: number; yBottom: number };
```

`captionBandRect` returns `{ yTop: 1 - sa.bottom - 0.14, yBottom: 1 - sa.bottom }` (a 14%-tall caption band sitting on top of the bottom UI).

- [ ] **Step 1: Failing test** — `PLATFORM_SAFE_AREA` values in (0,0.5); `captionBandRect()` yTop < yBottom, both in (0,1), yBottom == 1 - bottom.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (`PLATFORM_SAFE_AREA = { top: 0.12, bottom: 0.18, left: 0.05, right: 0.05 }`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(quality): platform safe-area rect + caption band`

### Task 3: Caption cue constraints (`src/captions/captionCues.ts`)

**Files:**
- Create: `src/captions/captionCues.ts`
- Test: `tests/captions/captionCues.test.ts`

**Interfaces:**
- Consumes: `CaptionWord` from `src/types`.
- Produces (Tasks 5, 6, 9): 

```ts
export interface CaptionCue { start: number; end: number; lines: string[]; }
export interface CueConstraints {
  maxCharsPerLine: number;   // default 24 (9:16 legible)
  maxLines: number;          // default 2
  maxReadingCps: number;     // chars/sec a viewer can read; default 22
  minCueSec: number;         // anti-flash floor; default 0.7
}
export const DEFAULT_CUE_CONSTRAINTS: CueConstraints;
/** PURE: greedily pack words into cues that respect line width/count; extend too-short
 *  cues to minCueSec (borrowing from the gap to the next cue, never overlapping). */
export function buildCaptionCues(words: CaptionWord[], c?: CueConstraints): CaptionCue[];
/** PURE: a cue VIOLATES reading speed when totalChars / duration > maxReadingCps. */
export function cueViolatesReadingSpeed(cue: CaptionCue, maxReadingCps: number): boolean;
```

Packing rule: accumulate words into the current line while `line.length + word.length + 1 <= maxCharsPerLine`; when the line is full start a new line; when `maxLines` lines are full, flush a cue (`start` = first word start, `end` = last word end) and begin the next. Never split a word. After packing, for any cue with `end - start < minCueSec`, set `end = min(start + minCueSec, nextCue.start ?? start + minCueSec)`.

- [ ] **Step 1: Failing tests** — words of known widths pack to ≤24 chars/line, ≤2 lines; no line exceeds cap; a single 0.2s cue is extended to ≥0.7s but not past the next cue's start; `cueViolatesReadingSpeed` true for 60 chars in 1s at cps 22, false for 10 chars in 1s.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(captions): readability-constrained cue builder (chars/line, lines, reading speed, min duration)`

### Task 4: Loudness normalization (`src/audio/loudness.ts`)

**Files:**
- Create: `src/audio/loudness.ts`
- Test: `tests/audio/loudness.test.ts`

**Interfaces:**
- Consumes: `run` from `src/utils/cmd.js` (returns `{stdout, stderr}`).
- Produces (Task 10): 

```ts
export interface LoudnessMeasurement { input_i: number; input_tp: number; input_lra: number; input_thresh: number; target_offset: number; }
export const TARGET_LUFS: number;   // -14 (YouTube/TikTok norm)
export const TRUE_PEAK_CEILING: number; // -1.0 dBTP
/** PURE: args for the measurement pass (loudnorm print_format=json, null output). */
export function buildLoudnessMeasureArgs(input: string): string[];
/** PURE: pull the loudnorm JSON block out of ffmpeg stderr; null if absent. */
export function parseLoudnessJson(stderr: string): LoudnessMeasurement | null;
/** PURE: args for the second (apply) pass, seeded with measured values (linear=true). */
export function buildLoudnessApplyArgs(input: string, output: string, m: LoudnessMeasurement, targetLufs?: number): string[];
/** Two-pass loudnorm to targetLufs; returns the measurement, or null on failure (caller ships original). */
export async function normalizeLoudness(input: string, output: string, targetLufs?: number): Promise<LoudnessMeasurement | null>;
```

Measure args: `['-hide_banner','-i',input,'-af',`loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK_CEILING}:LRA=11:print_format=json`,'-f','null','-']`. Apply args: `['-y','-i',input,'-af',`loudnorm=I=${t}:TP=${TRUE_PEAK_CEILING}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`,'-c:v','copy','-c:a','aac','-b:a','192k',output]`.

- [ ] **Step 1: Failing tests** — `buildLoudnessMeasureArgs` contains `print_format=json` and `-f null`; `parseLoudnessJson` extracts the 5 numbers from a fixture stderr containing a `{ "input_i" : "-23.5", ... }` block and returns null for stderr without one; `buildLoudnessApplyArgs` echoes measured values + `linear=true` + `-c:v copy`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (`parseLoudnessJson` finds the last `{`…`}` block and `Number()`s the fields; `normalizeLoudness` = measure → parse → (null? return null) → apply). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(audio): two-pass loudnorm to -14 LUFS`

### Task 5: EDL builder (`src/report/edl.ts`)

**Files:**
- Create: `src/report/edl.ts`
- Test: `tests/report/edl.test.ts`

**Interfaces:**
- Consumes: `CropKeyframe` from `src/types`, `CaptionCue` (Task 3), `RankedClip`.
- Produces (Tasks 8, 9, 12): the render-decision record.

```ts
export interface EdlSegment { srcStart: number; srcEnd: number; speed: number; }
export interface ClipEdl {
  clip_id: string;
  source_span: { start: number; end: number };
  segments: EdlSegment[];               // Slice A: always one 1.0x span (internal cuts arrive in Slice C)
  framing: 'blur' | 'crop';
  crop_track: CropKeyframe[] | null;    // null for blur
  caption_cues: CaptionCue[];
  zoom_times: number[];
  sfx_event_times: number[];
  audio_ops: { type: string; [k: string]: unknown }[];
  caption_preset: string;
  music: boolean;
  hook_text?: string;
  rationale: { director?: string; editor?: string; framing?: string };
}
export function buildClipEdl(args: {
  clip: RankedClip; framing: 'blur' | 'crop'; cropTrack: CropKeyframe[];
  cues: CaptionCue[]; zoomTimes: number[]; sfxTimes: number[];
  captionPreset: string; music: boolean; hookText?: string;
  audioOps: { type: string; [k: string]: unknown }[];
  rationale: { director?: string; editor?: string; framing?: string };
}): ClipEdl;
```

`buildClipEdl` sets `source_span = {start: clip.start, end: clip.end}`, `segments = [{srcStart: clip.start, srcEnd: clip.end, speed: 1}]`, `crop_track = framing === 'crop' ? cropTrack : null`. Pure assembly, no I/O.

- [ ] **Step 1: Failing tests** — blur clip → `crop_track` null, one full-span 1.0x segment, cues/zoom/sfx/hook carried; crop clip → `crop_track` equals the passed track; `rationale` echoed.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(report): per-clip EDL render-decision record`

### Task 6: Quality gates (`src/quality/gates.ts`)

**Files:**
- Create: `src/quality/gates.ts`
- Test: `tests/quality/gates.test.ts`

**Interfaces:**
- Consumes: `ReasonCode` (Task 1), `CaptionCue`/`cueViolatesReadingSpeed`/`CueConstraints` (Task 3), `captionBandRect`/`SafeArea` (Task 2), `CropKeyframe`, `FaceSample` from `src/types`.
- Produces (Task 7): pure per-gate functions returning a `GateResult`.

```ts
export type GateOutcome =
  | { status: 'pass' }
  | { status: 'autofix'; note: string }
  | { status: 'fail'; reason: ReasonCode; detail: string };
export interface GateResult { gate: string; outcome: GateOutcome; }

/** arc complete (from the existing arc gate) → pass; incomplete (lenient export) → fail(DIRECTOR_NO_ARC_FOUND). */
export function narrativeGate(arc: { complete: boolean; missing: string[] } | undefined): GateResult;
/** every cue within reading speed and ≤ maxLines → pass; else fail(QUALITY_CAPTION_OVERFLOW). */
export function captionGate(cues: CaptionCue[], c: CueConstraints): GateResult;
/** measured loudness within ±1 LUFS of target → pass; adjusted → autofix; unmeasured → fail(CF_AUDIT_GATE_ERROR). */
export function audioGate(measuredLufs: number | null, targetLufs: number): GateResult;
/** duration within [min,max] → pass; else fail (report-only reason via detail). */
export function durationGate(durationSec: number, min: number, max: number): GateResult;
/** crop framing: fraction of face samples whose center lies inside the crop window ≥ floor → pass;
 *  below floor → fail(QUALITY_SUBJECT_OUT_OF_FRAME). blur framing (cropTrack null) → pass (whole frame shown). */
export function subjectInFrameGate(
  faces: FaceSample[], cropTrack: CropKeyframe[] | null, floor: number,
): GateResult;
export const SUBJECT_IN_FRAME_FLOOR: number; // 0.8
```

`subjectInFrameGate`: for each face sample with a box, find the nearest crop keyframe by time; count it "covered" if the face-box center is within `[cx±cropW/2, cy±cropH/2]`; pass when `covered/total >= floor` (or no face samples at all → pass, nothing to keep in frame).

- [ ] **Step 1: Failing tests** — narrativeGate: complete→pass, `{complete:false,missing:['payoff']}`→fail w/ DIRECTOR_NO_ARC_FOUND, undefined→pass (no arc stage). captionGate: 3-line cue → fail QUALITY_CAPTION_OVERFLOW; clean cues → pass. audioGate: -14.4 vs -14 → pass; -20 → autofix; null → fail CF_AUDIT_GATE_ERROR. durationGate: in/out of bounds. subjectInFrameGate: null track → pass; face centers inside windows → pass; face far outside → fail QUALITY_SUBJECT_OUT_OF_FRAME.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(quality): pure pass/autofix/fail gates (narrative, caption, audio, duration, subject-in-frame)`

### Task 7: Audit runner (`src/quality/audit.ts`)

**Files:**
- Create: `src/quality/audit.ts`
- Test: `tests/quality/audit.test.ts`

**Interfaces:**
- Consumes: all Task 6 gates, `ReasonCode`.
- Produces (Tasks 8, 9, 10): 

```ts
export interface ClipQuality {
  gates: GateResult[];
  passed: boolean;          // no gate failed
  degraded: boolean;        // any degradation reason present
  degradations: ReasonCode[];
  reasonCodes: ReasonCode[]; // all reason codes surfaced (fails + autofixes + upstream)
}
export function runAudit(args: {
  arc: { complete: boolean; missing: string[] } | undefined;
  cues: CaptionCue[]; cueConstraints: CueConstraints;
  measuredLufs: number | null; targetLufs: number;
  durationSec: number; lenMin: number; lenMax: number;
  faces: FaceSample[]; cropTrack: CropKeyframe[] | null; subjectFloor: number;
  upstreamReasons: ReasonCode[];   // framing fallbacks etc. gathered during render
}): ClipQuality;
```

`runAudit` runs all five gates, collects `GateResult[]`, sets `passed = gates.every(g => g.outcome.status !== 'fail')`, gathers reason codes from failing/autofix gates + `upstreamReasons`, and `degraded = degradations.length > 0` where degradations = the subset of reason codes that mean "shipped but compromised" (`FRAMING_FALLBACK_CENTER_CROP`, `CF_BELOW_RETENTION_FLOOR`, `ASR_LOW_CONFIDENCE_SEGMENT`, any autofix). Never throws: a gate that throws is caught → a `fail` GateResult with `CF_AUDIT_GATE_ERROR`.

- [ ] **Step 1: Failing tests** — all-good inputs → `passed:true, degraded:false, gates length 5`; a 3-line cue → `passed:false` with QUALITY_CAPTION_OVERFLOW in reasonCodes; upstream `[FRAMING_FALLBACK_CENTER_CROP]` → `degraded:true` even when all gates pass; a gate input crafted to throw → caught, `passed:false`, CF_AUDIT_GATE_ERROR present.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(quality): audit runner — gates → ClipQuality, never throws`

### Task 8: Run report (`src/report/runReport.ts`)

**Files:**
- Create: `src/report/runReport.ts`
- Test: `tests/report/runReport.test.ts`

**Interfaces:**
- Consumes: `ClipQuality` (Task 7), `ReasonCode`/`tallyReasonCodes` (Task 1).
- Produces (Task 10): 

```ts
export interface RunReportClip {
  clip_id: string; passed: boolean; degraded: boolean;
  degradations: ReasonCode[]; predicted_retention?: number; tier: 'top' | 'below_retention';
}
export interface RunReport {
  run_id: string; created_at: string; source: string;
  clips: RunReportClip[];
  reason_code_counts: ReasonCodeCounts;
  summary: { total: number; passed: number; degraded: number; rejected: number };
}
export function buildRunReport(runId: string, source: string, clips: RunReportClip[], extraReasons: ReasonCode[]): RunReport;
export async function writeRunReport(dir: string, report: RunReport): Promise<void>; // dir/run_report.json
```

`buildRunReport`: `reason_code_counts = tallyReasonCodes([...clips.flatMap(c => c.degradations), ...extraReasons])`; summary counts. `rejected` here = clips that failed a hard gate but were exported anyway in Slice A (advisory) — counted for visibility.

- [ ] **Step 1: Failing tests** — build from 3 clips (1 clean, 1 degraded, 1 below_retention) → summary counts correct, `reason_code_counts` tallies degradations; `writeRunReport` writes valid JSON to `dir/run_report.json` (tmp dir round-trip).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(report): run_report.json builder + writer`

### Task 9: Exporter — quality block + EDL file

**Files:**
- Modify: `src/export/exporter.ts` (buildClipJson + writeExports signatures)
- Test: `tests/export/exporter.test.ts` (extend)

**Interfaces:**
- Consumes: `ClipQuality` (Task 7), `ClipEdl` (Task 5).
- Produces: clip.json gains a `quality` block; a `clip_NNN_edl.json` is written per clip.

```ts
// buildClipJson gains optional trailing args:
//   quality?: ClipQuality, edl?: ClipEdl
// writeExports gains:
//   qualityByClip?: Map<string, ClipQuality>, edlByClip?: Map<string, ClipEdl>
```

Per clip with a quality entry: embed `quality: { passed, degraded, degradations, gates: gates.map(g=>({gate,status,reason?})) }` in clip.json; write `clip_NNN_edl.json` = `JSON.stringify(edl, null, 2)`. Clips without entries are unchanged (back-compat, like the existing `avss`/`broll` optional blocks).

- [ ] **Step 1: Failing test** — extend `tests/export/exporter.test.ts`: `buildClipJson(..., quality, edl)` includes a `quality` block with the gate summary; `writeExports` with a `qualityByClip`/`edlByClip` map writes `clip_001_edl.json` and a `quality` block, and clips absent from the maps get neither.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (pure `buildQualityBlock(q)` helper, exported for the test). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(export): quality block in clip.json + per-clip EDL file`

### Task 10: Pipeline wiring (`all.ts`) + loudness step

**Files:**
- Modify: `src/cli/commands/all.ts` (per-clip loop + post-loop report), `src/cli/index.ts` (`--target-lufs`, `--no-loudnorm` flags threaded through `renderOpts`)
- Test: `tests/cli/audit-wiring.test.ts` (pure helpers only)

**Interfaces:** Consumes Tasks 3–8. New pure helper in `all.ts`:

```ts
export function collectUpstreamReasons(framingMode: 'blur' | 'crop', usedCenterFallback: boolean, belowFloor: boolean): ReasonCode[];
```

Wiring inside the existing per-clip try (after render, before thumbnail):
1. `const cues = buildCaptionCues(captionWords)` — also pass to the EDL and (optionally) the SRT writer stays as-is.
2. Loudness: unless `opts.loudnorm === false`, `const m = await normalizeLoudness(finalPath, tmp, opts.targetLufs ?? TARGET_LUFS)`; on non-null rename tmp→finalPath and push `CF_AUDIO_LOUDNESS_ADJUSTED`; on null log + keep original. (Runs after music/sfx mix so it normalizes the final mix.)
3. `const quality = runAudit({ arc: arcStatus.get(clip.clip_id), cues, cueConstraints: DEFAULT_CUE_CONSTRAINTS, measuredLufs: m?.input_i ?? null, targetLufs, durationSec: clip.duration, lenMin: profile.lengths.min, lenMax: profile.lengths.max, faces, cropTrack: mode==='crop'?track:null, subjectFloor: SUBJECT_IN_FRAME_FLOOR, upstreamReasons: collectUpstreamReasons(mode, /*center fallback*/ track.length===1 && mode==='crop' && …, belowFloorIds.has(clip.clip_id)) })`.
4. `const edl = buildClipEdl({...winner plan fields already in scope...})`; `qualityByClip.set(id, quality)`, `edlByClip.set(id, edl)`.
5. After the loop (both top + below tiers): `const report = buildRunReport(id, primary.url, [...top clips as {tier:'top'}, ...below as {tier:'below_retention'}], extraReasons); await writeRunReport(exportsDir, report);` and log a one-line summary (`audit: N passed, M degraded, K flagged`).
6. Pass `qualityByClip`/`edlByClip` to `writeExports`.

- [ ] **Step 1: Failing test** — `collectUpstreamReasons('crop', true, false)` includes FRAMING_FALLBACK_CENTER_CROP; `('blur', false, true)` includes CF_BELOW_RETENTION_FLOOR and not the framing code; `('crop', false, false)` → `[]`.
- [ ] **Step 2:** Run — FAIL. Implement the helper — PASS.
- [ ] **Step 3:** Wire the loop + report per above; add `--target-lufs <n>` and `--no-loudnorm` to `addRenderOptions` and thread into `AllOpts` (`loudnorm?: boolean; targetLufs?: number`).
- [ ] **Step 4:** `npx vitest run` (full) — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(avss/quality): per-clip audit + loudness + run_report.json wired into the pipeline`

### Task 11: GUI — degraded badge + audit surface

**Files:**
- Modify: `ui/lib/workspace.ts` (`ClipInfo` gains `passed?`, `degraded?`, `degradations?`), `ui/components/clips-tab.tsx` (badge)
- Test: none (mirrors existing untested GUI mapping; covered by `next build`)

**Interfaces:** clip.json `quality` block → `ClipInfo`.

- [ ] **Step 1:** `workspace.ts` `mapManifestClips` reads `c.quality?.passed`, `c.quality?.degraded`, `c.quality?.degradations` into the clip info (the manifest already inlines per-clip fields; if `quality` isn't in the manifest, read it the same way `predicted_retention` is surfaced — add `quality` passthrough in `buildManifest` clip mapping in `exporter.ts` alongside `predicted_retention`).
- [ ] **Step 2:** clips-tab badge: `{c.degraded && <Badge tone="amber">degraded</Badge>}` and `{c.passed === false && <Badge tone="red">audit ✗</Badge>}`, with the `degradations` joined into the badge `title`.
- [ ] **Step 3:** `cd ui && npx next build` — clean.
- [ ] **Step 4: Commit** `feat(ui): audit/degraded badges on clips`

### Task 12: Golden EDL round-trip test + DEPENDENCIES.md

**Files:**
- Create: `tests/golden/edl.golden.test.ts`, `tests/golden/fixtures/clip_edl.expected.json`, `docs/DEPENDENCIES.md`
- Test: the golden test itself

**Interfaces:** Consumes `buildClipEdl` (Task 5).

- [ ] **Step 1:** Write `tests/golden/edl.golden.test.ts`: build a `ClipEdl` from a fixed fabricated clip/crop/cues input, compare deep-equal to the committed `clip_edl.expected.json`; the test message on mismatch says "edit-decision drift — update the golden with sign-off if intentional".
- [ ] **Step 2:** Run — FAIL (fixture missing). **Step 3:** Generate the fixture from the builder output once, eyeball it, commit it. Re-run — PASS.
- [ ] **Step 4:** Write `docs/DEPENDENCIES.md`: table of runtime deps (yt-dlp, ffmpeg, @vladmandic/face-api + model weights, remotion, next, commander, etc.) with license + purpose; flag the face-api model-weight license explicitly.
- [ ] **Step 5:** Full gates: `npx vitest run` + `npx tsc --noEmit` + `cd remotion && npx tsc --noEmit` + `cd ui && npx next build` — all clean.
- [ ] **Step 6: Commit** `test(golden): EDL decision round-trip + docs: DEPENDENCIES.md`

### Task 13: Live smoke + memory + gap-doc tick

- [ ] **Step 1:** `npm run build`; run the pipeline on a cached source (`node dist/cli/index.js all "<cached url>" --top 2 --allow-repeats`). Verify: `run_report.json` exists with reason-code counts + per-clip pass/degraded; each clip.json has a `quality` block; each clip has a `clip_NNN_edl.json`; the final mp4 is loudness-normalized (spot-check with `ffmpeg -i clip_001_final.mp4 -af loudnorm=print_format=json -f null -` shows input_i ≈ -14).
- [ ] **Step 2:** Inspect one `run_report.json` — degradations tally matches what the console logged.
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-07-06-v4-sixpart-gap-analysis.md` (tick Slice A deltas #1, #2, #3(partial), #19, #21, #22, #25, #30, #32 done) and memory `clipforge-progress.md`; commit.

## Self-review

- **Spec coverage (Slice A deltas):** #1 reason codes → T1; #2 EDL → T5/T9/T12; #3 golden tests → T12; #19 loudness → T4/T10; #21 safe-area rect → T2; #22 caption constraints → T3; #25 subject-in-frame gate → T6; #30 unified audit → T6/T7/T9/T10; #32 render-determinism round-trip → T12 (decision-identity, not bit-exact — matches the AT-1 scoping in the gap doc). `DEPENDENCIES.md` → T12. GUI surface → T11.
- **Deferred within A (documented):** cut-integrity gate is trivially-passing in Slice A (single contiguous span) and becomes real in Slice C — not a separate gate function now, folded into narrative/duration; caption *pixel* overflow is approximated by the chars/line + reading-speed constraints (true font-metric measurement waits for a render-side check). Both noted so a reviewer doesn't flag them as gaps.
- **Type consistency:** `ClipQuality`/`GateResult`/`GateOutcome` defined T6/T7, consumed T8–T11; `ClipEdl` T5 → T9/T12; `ReasonCode` T1 everywhere; `CaptionCue`/`CueConstraints` T3 → T5/T6/T7/T10; `SafeArea`/`captionBandRect` T2 → T6.
- **Placeholder scan:** every code step has real signatures/ffmpeg args/assertions; no TBD.
