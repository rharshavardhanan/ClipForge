# v4 Slice C — Editor Tightening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead air and safe filler from inside each clip so it feels hand-cut and higher-energy — the single biggest retention lever — by cutting the clip into kept segments and remapping every clip-relative time (captions, zooms, B-roll, crop track) through a tested time map, so nothing desyncs.

**Architecture:** New `src/editor/` package: a pure **TimeMap** (kept-segments → source↔output time transforms + word/point remapping) is the safety-critical core, heavily property-tested. A pure **tighten** planner turns clip-relative silences + filler runs into kept segments (protecting the hook and the payoff tail, honoring a per-clip pace target). Extraction gains a single-pass ffmpeg `select`/`aselect` concat so the extract is physically shortened. In `all.ts` the tighten+remap happens **before** framing/AVSS/render, so the entire downstream operates on the compressed output timeline. The EDL's `segments` field (built empty in Slice A) is finally populated, and Slice A's placeholder cut-integrity gate becomes real.

**Tech Stack:** TypeScript (ESM, Node 24), vitest (heavy property-style tests), ffmpeg `select`/`aselect`+`setpts`/`asetpts` (single-pass segment concat).

## Global Constraints

- No Python, no new deps. Segment concat is one ffmpeg filter pass — no temp-file juggling.
- **Never cut mid-word** (v4 Part 3 §1): kept-segment boundaries must land in gaps between words; a boundary that would split a word is rejected → the cut-integrity gate fails it. Property-tested.
- **Protect the landing:** never remove inside the hook (first `HOOK_PROTECT_S`) or the payoff tail (last `PAYOFF_PROTECT_S`) — "tighten the runway, not the landing" (Part 3 §4.2). Dramatic pauses in the tail survive.
- All clip-relative times are 0-based from the clip's source start (as the pipeline already does for captionWords/zoomTimes/broll/cropTrack). The TimeMap operates in this clip-relative space: input = pre-cut clip-relative seconds, output = compressed clip-relative seconds.
- Fail-soft: if tightening would remove too little (< `MIN_TIGHTEN_GAIN_S`) or would drop below `MIN_KEPT_S`, ship the clip uncut (identity map) — never produce a stutter-cut or a clip shorter than the mode min.
- All new core logic pure; tests mirror under `tests/editor/`, importing `../../src/editor/<mod>.js`.
- Standing gates after every task: `npx vitest run` green, `npx tsc --noEmit` clean (root), `cd remotion && npx tsc --noEmit` clean, `cd ui && npx next build` clean.

---

### Task 1: TimeMap (`src/editor/timeMap.ts`)

**Files:**
- Create: `src/editor/timeMap.ts`
- Test: `tests/editor/timeMap.test.ts`

**Interfaces:**
- Consumes: `CaptionWord`, `RmsPoint` from `src/types`.
- Produces (Tasks 2, 5, 6):

```ts
export interface KeepSegment { start: number; end: number; }   // clip-relative, source time, ordered, disjoint
export interface TimeMap {
  keep: KeepSegment[];
  totalOut: number;                       // sum of kept durations = compressed clip length
  isIdentity: boolean;                    // true when nothing was removed
}
/** PURE: build a map from ordered disjoint kept segments (clip-relative source times). */
export function buildTimeMap(keep: KeepSegment[]): TimeMap;
/** PURE: identity map over [0, dur] (no cuts). */
export function identityTimeMap(dur: number): TimeMap;
/** PURE: source clip-relative t → output clip-relative t. t inside a removed gap maps to the
 *  start of the next kept segment (collapse). t past the end → totalOut. */
export function srcToOut(map: TimeMap, t: number): number;
/** PURE: is source time t inside a kept segment? (removed → false) */
export function isKept(map: TimeMap, t: number): boolean;
/** PURE: remap words to the output timeline; a word whose MIDPOINT is in a removed gap is
 *  dropped, otherwise start/end are mapped through srcToOut. */
export function mapWords(map: TimeMap, words: CaptionWord[]): CaptionWord[];
/** PURE: remap a list of event times; times in removed gaps are dropped. */
export function mapTimes(map: TimeMap, times: number[]): number[];
/** PURE: remap an RMS curve (drop removed points, shift kept ones). */
export function mapRms(map: TimeMap, rms: RmsPoint[]): RmsPoint[];
```

`srcToOut(map, t)`: walk kept segments accumulating output offset; if `t` in segment `i` at `[s,e]` with prior kept duration `acc`, return `acc + (t - s)`; if `t` in the gap before segment `i`, return that segment's `acc` (collapse to next kept start); `t ≥ last end` → `totalOut`.

- [ ] **Step 1: Write failing tests** — identity map: srcToOut(t)=t, mapWords unchanged. Two kept segments `[0,5]`,`[8,12]` (gap 5-8 removed, totalOut 9): srcToOut(3)=3, srcToOut(6)=5 (gap→next start), srcToOut(10)=7, srcToOut(99)=9; isKept(6)=false, isKept(10)=true; mapWords drops a word centered at 6.5, shifts a word at [9,10]→[6,7]; mapTimes([3,6,10])=[3,7] (6 dropped). **Property:** srcToOut is non-decreasing over a random sorted sample; totalOut = Σ kept durations.
- [ ] **Step 2:** Run `npx vitest run tests/editor/timeMap.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(editor): TimeMap — source↔output time remap for internal cuts`

### Task 2: Tighten planner (`src/editor/tighten.ts`)

**Files:**
- Create: `src/editor/tighten.ts`
- Test: `tests/editor/tighten.test.ts`

**Interfaces:**
- Consumes: `KeepSegment`, `buildTimeMap`, `identityTimeMap` (Task 1); `CaptionWord`; `isFillerWord` from `src/analysis/filler.js`.
- Produces (Task 5):

```ts
export interface TightenParams {
  maxInternalSilenceSec: number;   // silences longer than this are trimmed (pace-set, Task 3)
  keepBreathSec: number;           // padding left on each side of a removed span
  hookProtectSec: number;          // 3 — never cut inside the opening
  payoffProtectSec: number;        // 3 — never cut inside the closing (the landing)
  minSegmentSec: number;           // 1.2 — merge/skip tinier kept fragments
  fillerGapSec: number;            // 0.15 — a filler word is only removed if flanked by gaps ≥ this
}
export const DEFAULT_TIGHTEN: TightenParams;
export interface TightenResult { keep: KeepSegment[]; map: import('./timeMap.js').TimeMap; removedSec: number; }
/** PURE: compute kept segments for a clip of length `durSec`.
 *  Removes (a) silences longer than maxInternalSilenceSec (trimmed by keepBreathSec each side)
 *  and (b) filler-word spans flanked by gaps ≥ fillerGapSec — never inside the protected
 *  hook/payoff spans, never producing a kept fragment < minSegmentSec. Returns an identity
 *  map when the net gain < MIN_TIGHTEN_GAIN_S or kept total < MIN_KEPT_S. */
export function planTighten(
  durSec: number, silences: { start: number; end: number }[], words: CaptionWord[], p?: TightenParams,
): TightenResult;
export const MIN_TIGHTEN_GAIN_S: number;   // 0.8 — below this, not worth a cut
export const MIN_KEPT_S: number;           // 8 — never tighten a clip below this
```

Algorithm: collect removable spans = (silences ∩ unprotected, each shrunk by keepBreathSec both sides, kept only if still > 0) ∪ (filler-word spans in unprotected region whose left gap and right gap to neighboring words ≥ fillerGapSec). Merge overlapping removals. Kept segments = complement of removals over `[0, durSec]`, dropping kept fragments < minSegmentSec (fold them into the adjacent removal). If `Σremoved < MIN_TIGHTEN_GAIN_S` or `durSec − Σremoved < MIN_KEPT_S` → `{ keep: [{0,durSec}], map: identityTimeMap(durSec), removedSec: 0 }`.

- [ ] **Step 1: Failing tests** — a 30s clip with a 4s mid silence (10-14) and default params → removes ~[10.2,13.8], keep `[0,10.2]`+`[13.8,30]`, removedSec ≈ 3.6; a silence inside the last 3s (payoff) is NOT removed; a silence of 0.5s (< threshold) is NOT removed; a filler word at 15.0-15.4 flanked by 0.3s gaps → removed; a filler mid-run with no gaps → kept; a clip where removing everything leaves < MIN_KEPT_S → identity; total gain < 0.8s → identity.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(editor): tighten planner — dead-air + safe filler removal, protects hook/payoff`

### Task 3: Pace engine (`src/editor/pace.ts`)

**Files:**
- Create: `src/editor/pace.ts`
- Test: `tests/editor/pace.test.ts`

**Interfaces:**
- Consumes: `TightenParams`, `DEFAULT_TIGHTEN` (Task 2); `RmsPoint`, `ContentMode`.
- Produces (Task 5):

```ts
/** PURE: per-clip pace 0-1 from speech density + energy + mode (clippies punchier than mindcuts). */
export function paceTarget(args: { wordsPerSec: number; meanRms: number; mode: ContentMode }): number;
/** PURE: map pace → tighten params. Higher pace ⇒ shorter allowed silence + less breath. */
export function paceToTighten(pace: number): TightenParams;
```

`paceTarget` = clamp01(`0.4·clamp(wordsPerSec/3) + 0.3·clamp(meanRms/10) + (mode==='clippies'?0.3:0.1)`). `paceToTighten`: `maxInternalSilenceSec = lerp(1.2, 0.5, pace)` (high pace ⇒ tighter), `keepBreathSec = lerp(0.18, 0.10, pace)`, other fields from DEFAULT_TIGHTEN.

- [ ] **Step 1: Failing tests** — clippies with fast dense speech → pace > mindcuts with slow sparse; paceToTighten(1) has smaller maxInternalSilenceSec than paceToTighten(0); pace clamped [0,1].
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(editor): pace engine — content-driven tightening aggressiveness`

### Task 4: Segmented extraction (`src/extraction/clipExtractor.ts`)

**Files:**
- Modify: `src/extraction/clipExtractor.ts`
- Test: `tests/extraction/clipExtractor.test.ts` (extend)

**Interfaces:**
- Consumes: `KeepSegment` (Task 1).
- Produces (Task 5):

```ts
/** PURE: ffmpeg args that seek to clipStart and concatenate only the kept segments
 *  (clip-relative) into a shortened full-frame clip. One pass, no temp files. */
export function buildSegmentedExtractArgs(video: string, clipStart: number, keep: KeepSegment[], af: string, outPath: string): string[];
/** Extract [clipStart..] keeping only `keep` segments; falls back to a plain full-frame
 *  extract when keep is a single full span (identity). */
export function extractTightened(video: string, clipStart: number, clipDur: number, keep: KeepSegment[], outPath: string): Promise<void>;
```

Filter for N segments: video `select='between(t,s0,e0)+between(t,s1,e1)+...',setpts=N/FRAME_RATE/TB`; audio `aselect='between(t,s0,e0)+...',asetpts=N/SR/TB` chained after the existing `buildAudioFilter()` (loudness/denoise stays). `-ss clipStart -i video` so `t` is clip-relative. Identity (single full span) → delegate to `buildFullFrameExtractArgs` (unchanged path).

- [ ] **Step 1: Failing tests** — `buildSegmentedExtractArgs` with two segments contains `between(t,0,5)` and `between(t,8,12)`, `setpts=N/FRAME_RATE/TB`, `aselect`, and `-ss <clipStart>`; single full span delegates to the plain args (no `select`).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (`extractTightened` builds args, `withRetry(run('ffmpeg', ...))`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(extraction): segmented (cut) full-frame extract via select/aselect concat`

### Task 5: Wire tightening into the pipeline (`all.ts`)

**Files:**
- Modify: `src/cli/commands/all.ts` (per-clip loop), `src/report/edl.ts` (segments from real keep list)
- Test: `tests/cli/tightenWiring.test.ts` (pure helper)

**Interfaces:** Consumes Tasks 1–4. New pure helper:

```ts
export function clipRelativeSilences(silences: { start: number; end: number }[], clipStart: number, clipEnd: number): { start: number; end: number }[];
```

Wiring order (all before framing/AVSS/render so the whole tail is on the output timeline):
1. Build `captionWords` (clip-relative source) as today.
2. `const pace = paceTarget({ wordsPerSec: captionWords.length / clip.duration, meanRms: mean(clip-relative rms), mode: source.mode })`; `const tp = opts.tighten === false ? undefined : paceToTighten(pace)`.
3. `const { keep, map, removedSec } = opts.tighten === false ? { keep:[{start:0,end:clip.duration}], map: identityTimeMap(clip.duration), removedSec:0 } : planTighten(clip.duration, clipRelativeSilences(source.audio.silence_regions, clip.start, clip.end), captionWords, tp)`.
4. `captionWords = mapWords(map, captionWords)` (output timeline).
5. Replace `extractFullFrame(...)` with `extractTightened(source.videoPath, clip.start, clip.duration, keep, fullPath)`.
6. `planFraming(fullPath, ...)` → cropTrack (already output-time — fullPath is the cut clip).
7. AVSS `buildSourceSignals` uses the remapped `captionWords` + `mapRms(map, clipRelativeRms)` so the simulation reflects the tightened clip; the winner plan's zoom times come out output-relative.
8. B-roll overlays: after acquire, `overlays = overlays.map(o => ({ ...o, atSec: srcToOut(map, o.atSec) })).filter(o => isKept-ish)` — drop overlays whose start fell in a removed gap.
9. `if (removedSec > 0) logger.info(\`[${clip.clip_id}] tightened −${removedSec.toFixed(1)}s (${keep.length} segments)\`)`.
10. EDL: `buildClipEdl` `segments` = keep mapped to absolute source (`{ srcStart: clip.start + k.start, srcEnd: clip.start + k.end, speed: 1 }`).
11. Add `--no-tighten` flag (AllOpts `tighten?: boolean`) in `index.ts`.

- [ ] **Step 1:** `clipRelativeSilences` test — a source silence [12,16] with clip [10,40] → [2,6]; a silence fully outside the clip is dropped; one straddling the start is clamped to 0.
- [ ] **Step 2:** Run — FAIL → implement helper → PASS.
- [ ] **Step 3:** Rewire the loop per above; `edl.ts` `buildClipEdl` gains a `keep: KeepSegment[]` arg (defaulting to the full span) and emits real segments. Keep every existing fail-soft path.
- [ ] **Step 4:** `npx vitest run` (full) + `npx tsc --noEmit` — clean.
- [ ] **Step 5: Commit** `feat(editor): tightening wired in — clips are cut, all times remapped, EDL segments populated, --no-tighten`

### Task 6: Real cut-integrity gate (`src/quality/gates.ts`)

**Files:**
- Modify: `src/quality/gates.ts` (implement `cutIntegrityGate`), `src/quality/audit.ts` (add it to the run), `all.ts` (pass keep + words)
- Test: `tests/quality/gates.test.ts` (extend), `tests/quality/audit.test.ts` (extend)

**Interfaces:**

```ts
/** A kept-segment boundary that lands strictly inside a word (start < boundary < end) splits it
 *  → fail EDITOR_CUT_ON_NON_BOUNDARY. Identity (one full span) always passes. */
export function cutIntegrityGate(keep: KeepSegment[], words: CaptionWord[]): GateResult;
```

- [ ] **Step 1:** gates test: identity keep → pass; a boundary at 5.0 with a word spanning [4.8,5.3] → fail EDITOR_CUT_ON_NON_BOUNDARY; boundaries in inter-word gaps → pass. audit test: `runAudit` gains `keep`/`preCutWords` inputs and includes the cut-integrity gate (6 gates now).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `cutIntegrityGate`; add to `runAudit` (checked against the PRE-cut words + keep boundaries); thread `keep` + pre-cut words from `all.ts`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(quality): real cut-integrity gate — no kept-segment boundary splits a word`

### Task 7: Live smoke + docs/memory

- [ ] **Step 1:** `npm run build`; run on a cached talky source (`node dist/cli/index.js all "<cached>" --top 2 --allow-repeats --min-retention 0`). Verify: a clip.json's `duration` is shorter than `end − start` when tightened; `edl.json` `segments` has >1 entry with matching spans; the log shows `tightened −Ns`; **play the clip and confirm audio/captions stay in sync and cuts don't click** (the real risk — use the `run` skill / open the mp4). Compare against `--no-tighten` on the same clip.
- [ ] **Step 2:** If cuts click audibly at joins, note it and (follow-up) add a short `acrossfade` at segment boundaries — do NOT expand scope now unless the smoke shows it's needed.
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-07-06-v4-sixpart-gap-analysis.md` (tick C deltas #18, #23 done; #20 stitch-xfade deferred unless smoke needed it) and memory; commit.

## Self-review

- **Spec coverage (Slice C deltas):** #18 internal dead-air + filler removal + segments + src↔out map → T1/T2/T4/T5; #23 pace engine → T3/T5; cut-integrity gate (completes Slice A #30) → T6. #20 stitch crossfades → deferred to a smoke-gated follow-up (cutting at silence edges already minimizes clicks; don't add filter complexity speculatively).
- **Risk control:** the TimeMap (the desync-risk core) is property-tested for monotonicity + kept-duration invariants before anything consumes it; tighten is fail-soft to identity; the smoke's play-and-listen step is mandatory because unit tests can't hear a click.
- **Type consistency:** `KeepSegment`/`TimeMap` T1 → T2/T4/T5/T6; `TightenParams`/`planTighten` T2 → T3/T5; `paceToTighten` T3 → T5; `buildSegmentedExtractArgs`/`extractTightened` T4 → T5; `cutIntegrityGate` T6. `buildClipEdl` `keep` arg added in T5 consumed by the existing EDL golden test (update the golden if the default-span output changes — it should not, since default keep = full span).
- **Placeholder scan:** every step has real signatures/filters/assertions; no TBD.
- **Ordering rationale:** tighten+remap happens before framing/AVSS/render so cropTrack, simulation, zooms, and captions are all computed on the compressed timeline — no post-hoc reconciliation.
