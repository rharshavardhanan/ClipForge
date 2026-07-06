# v4 Slice B — Director Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clip SELECTION smarter — fill the dead `visual_score` so framing-hostile moments are penalized before they're rendered, add topic diversity so a run doesn't return six clips of one riff, penalize filler-heavy candidates, and record why each clip was chosen — addressing the user's "why did it pick this / not much improvement" pain at the selection stage.

**Architecture:** New pure-logic package `src/director/` (visual feasibility, diverse selection) plus `src/analysis/filler.ts`. Everything computes on the **arc survivors** (already bounded to ≤ `arcTopk`, default 8, and already keyframe-extracted by the arc gate) — never on every window — so cost stays bounded on a no-CUDA Mac. Topic labels ride along on the existing semantic pass (one extra field, ~zero marginal cost). The arc-gate `survivors.sort → slice` in `all.ts` is replaced by a diversity-penalized greedy selector that also consumes the new visual-feasibility score; `visual_score` in clip.json stops being `0`.

**Tech Stack:** TypeScript (ESM, Node 24), vitest, existing `detectFrameObs` (face presence) + `detectSceneCuts` (shot density), Claude/Gemini semantic pass (topic labels).

## Global Constraints

- No Python, no new models. Visual feasibility reuses the existing WASM face detector + ffmpeg scene-cut score, bounded to arc survivors (≤ arcTopk).
- Keep the 6/6 arc gate and the AVSS retention floor unchanged — Slice B re-orders and annotates *survivors*, it does not relax the gate.
- Feature scoring stays interpretable (v4 Part 2 §4): a transparent weighted combination, weights as named constants — no opaque regressor.
- All new core logic is pure (I/O — face sampling — stays in `all.ts`); tests mirror under `tests/director/` and `tests/analysis/`, importing `../../src/<pkg>/<mod>.js`.
- Determinism: selection is seeded/tie-broken by clip_id; same survivors ⇒ same selection.
- Standing gates after every task: `npx vitest run` green, `npx tsc --noEmit` clean (root), `cd remotion && npx tsc --noEmit` clean, `cd ui && npx next build` clean.

---

### Task 1: Filler detection (`src/analysis/filler.ts`)

**Files:**
- Create: `src/analysis/filler.ts`
- Test: `tests/analysis/filler.test.ts`

**Interfaces:**
- Produces (Tasks 5, 6; and Slice C reuses the lexicon):

```ts
/** Discourse fillers that add no content — lowercase, apostrophe-normalized. */
export const FILLER_LEXICON: ReadonlySet<string>;   // um, uh, er, ah, like, "you know", "i mean", basically, literally, actually, right, so, well
/** PURE: is this single token a filler word? (multi-word phrases handled by fillerRatio). */
export function isFillerWord(word: string): boolean;
/** PURE: fraction (0-1) of tokens in the text that are filler (single + known 2-grams). */
export function fillerRatio(text: string): number;
```

`isFillerWord` normalizes (`toLowerCase`, strip non-`[a-z']`) and checks single-word membership. `fillerRatio` tokenizes, counts single-word fillers plus 2-gram phrase fillers (`you know`, `i mean`, `kind of`, `sort of`), returns `fillerTokens / totalTokens` (0 when empty).

- [ ] **Step 1: Failing test** — `isFillerWord('Um,')` true, `isFillerWord('important')` false; `fillerRatio('um so like the point')` ≈ 3/5; `fillerRatio('you know what i mean')` counts both 2-grams; `fillerRatio('')` = 0.
- [ ] **Step 2:** Run `npx vitest run tests/analysis/filler.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(analysis): filler-word detection (lexicon + ratio)`

### Task 2: Visual feasibility (`src/director/visualFeasibility.ts`)

**Files:**
- Create: `src/director/visualFeasibility.ts`
- Test: `tests/director/visualFeasibility.test.ts`

**Interfaces:**
- Consumes: `FrameObs` from `src/types` (from `detectFrameObs`), scene-cut times (from `detectSceneCuts`).
- Produces (Tasks 4, 5):

```ts
export interface VisualFeasibility { facePresence: number; shotStability: number; score: number; }
export const VISUAL_WEIGHTS: { facePresence: number; shotStability: number }; // 0.6 / 0.4
/** PURE. facePresence = fraction of sampled frames with ≥1 face (a clear subject to frame).
 *  shotStability = 1 − clamp(cutsPerSec / MAX_CUTS_PER_SEC, 0, 1) (chaotic = hard to frame).
 *  score = weighted sum, 0-1. */
export function scoreVisualFeasibility(
  frames: FrameObs[], cutTimes: number[], windowStart: number, windowEnd: number,
): VisualFeasibility;
export const MAX_CUTS_PER_SEC: number; // 0.5 (a cut every 2s = fully chaotic)
```

- [ ] **Step 1: Failing tests** — all frames have a face + no cuts → `facePresence 1, shotStability 1, score 1`; no faces + no cuts → facePresence 0; a 10s window with 5 cuts → `shotStability = 1 − (0.5/0.5) = 0`; score is the weighted blend; empty frames → score 0.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (count frames with `faces.length > 0`; cuts within `[windowStart, windowEnd]` / duration). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(director): visual-feasibility feature (face presence + shot stability)`

### Task 3: Topic labels on the semantic layer

**Files:**
- Modify: `src/analysis/semantic.ts` (prompt + parse), `src/types/index.ts` (`SemanticWindow.topic?`), `src/analysis/claudeSemantic.ts` if it has a parallel prompt/parser
- Test: `tests/analysis/semanticTopic.test.ts`

**Interfaces:**
- Produces (Task 4): `SemanticWindow.topic?: string` — a short (≤4 word) extractive label per window; `topicOf`.

```ts
/** PURE: the topic label of the semantic window best overlapping [start,end), or '' if none. */
export function topicOf(start: number, end: number, semantic: SemanticWindow[]): string;
```

- [ ] **Step 1:** Extend the prompt: add `"topic":""` to the per-window JSON shape with the instruction `topic: 2-4 word label of what this window is about (for de-duplicating similar clips)`. Add `topic?: string` to `SemanticWindow`. Make the parser read `topic` (default `''` when absent — old caches stay valid). Add `topicOf` (reuse the overlap logic already in ranker/windowScorer — extract a shared `findOverlappingSemantic` or duplicate the tiny function locally).
- [ ] **Step 2: Failing test** — `topicOf` returns the overlapping window's topic; `''` when no overlap or topic absent. Parser tolerates a response object missing `topic`.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** PASS.
- [ ] **Step 6: Commit** `feat(analysis): per-window topic label for clip de-duplication`

### Task 4: Diversity-penalized selection (`src/director/selectDiverse.ts`)

**Files:**
- Create: `src/director/selectDiverse.ts`
- Test: `tests/director/selectDiverse.test.ts`

**Interfaces:**
- Consumes: `VisualFeasibility` (Task 2).
- Produces (Task 5):

```ts
export interface Selectable {
  id: string;            // clip_id (tie-break)
  composite: number;     // arc-weighted composite (0-10ish)
  visual: number;        // VisualFeasibility.score 0-1
  topic: string;         // '' = unknown (never penalized against another unknown)
  sourceId: string;      // jobId — cross-video redundancy
}
export const DIVERSITY_LAMBDA: number;       // 2.0 penalty weight
export const VISUAL_SELECT_WEIGHT: number;   // 1.5 — visual feasibility's pull on the ranked order
/** PURE, greedy + seeded tie-break: pick `top` maximizing
 *  composite + VISUAL_SELECT_WEIGHT·visual − DIVERSITY_LAMBDA·redundancy, where redundancy grows
 *  with how many already-picked clips share this one's topic (and, weaker, its source). */
export function selectDiverse(items: Selectable[], top: number): Selectable[];
```

Redundancy for a candidate given the picked set = `(# picked with same non-empty topic) + 0.5·(# picked with same sourceId)`. Greedy: repeatedly pick the max-adjusted remaining (ties → lexicographically smaller id), append, recompute. Stop at `top` or when no items remain.

- [ ] **Step 1: Failing tests** — 4 items, 3 same topic + 1 other, top 2 → the off-topic one is picked 2nd over a higher-composite same-topic one when λ dominates; a high-visual low-composite item outranks a low-visual slightly-higher-composite one when the visual gap is large; deterministic (same input twice = same output); empty topic never penalizes; `top ≥ items.length` returns all in adjusted order.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(director): diversity + visual-feasibility clip selection`

### Task 5: Wire into the arc-gate selection path (`all.ts`) + ranker filler penalty

**Files:**
- Modify: `src/cli/commands/all.ts` (survivor loop: compute visual feasibility; replace `survivors.sort → slice` with `selectDiverse`; populate `visual_score`), `src/clipDetection/ranker.ts` (filler penalty on the adjusted score + real `visual_score` passthrough)
- Test: `tests/clipDetection/ranker.test.ts` (extend — filler penalty), `tests/cli/selectWiring.test.ts` (pure mapping helper)

**Interfaces:**
- Consumes Tasks 1–4. New pure helper in `all.ts`:

```ts
export function survivorToSelectable(clip: RankedClip, sourceId: string, topic: string, visual: number): import('../../director/selectDiverse.js').Selectable;
```

- [ ] **Step 1:** Ranker: subtract a filler penalty from the `adjusted` sort key — `adjusted -= FILLER_PENALTY_WEIGHT * fillerRatio(text)` (named const, e.g. 2.0), computed from the candidate's `clipText`. `visual_score` in the emitted clip stays 0 here (selection stage fills it). Extend `tests/clipDetection/ranker.test.ts`: two otherwise-equal candidates, the filler-heavy one ranks lower. Run — FAIL → implement → PASS.
- [ ] **Step 2:** In the arc-gate survivor loop (after a clip passes the gate), sample visual feasibility ONCE per survivor: `const vf = scoreVisualFeasibility(await detectFrameObs(source.videoPath, w, h, 1, window duration capped), await detectSceneCuts(...on the window clip...), window.start, window.end)` — fail-soft to `{score: 0.5}` on error (neutral, don't punish a detection failure). Store `vf.score` alongside the survivor. (Reuse the arc gate's per-survivor budget; this is one more bounded pass.)
- [ ] **Step 3:** Replace `survivors.sort(...).slice(opts.top)` with: build `Selectable[]` via `survivorToSelectable(clip, source.jobId, topicOf(clip.start, clip.end, source.semantic), vf.score)`, call `selectDiverse(selectables, opts.top)`, then map the winners back to their survivor items (by id) preserving order. Set each selected clip's `visual_score = +vf.score.toFixed(2)` (times 10 to match the 0-10 layer scale, or keep 0-1 and document — pick 0-10 for consistency with the other layer_scores). Add `survivorToSelectable` unit test in `tests/cli/selectWiring.test.ts`.
- [ ] **Step 4:** `npx vitest run` (full) — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(director): visual feasibility + topic diversity drive selection; filler penalty in ranker; visual_score no longer 0`

### Task 6: Feature explanation in clip.json + run report

**Files:**
- Modify: `src/export/exporter.ts` (a `selection` block on clip.json), `src/report/runReport.ts` (optional per-clip top-features)
- Test: `tests/export/exporter.test.ts` (extend)

**Interfaces:**
- Produces: clip.json gains `selection: { features: {composite, visual, semantic, trigger, audio, filler_penalty, topic}, why: string }` where `why` names the top-2 positive contributors + any notable negative (e.g. "high visual clarity, complete arc; topic 'X' new to the pack").

```ts
export interface SelectionExport { features: Record<string, number | string>; why: string; }
export function buildSelectionWhy(features: { visual: number; composite: number; semantic: number; fillerPenalty: number }, topic: string, topicIsNew: boolean): string;
```

- [ ] **Step 1: Failing test** — `buildSelectionWhy` names visual clarity when visual high, flags filler when penalty high, mentions a new topic; `buildClipJson(..., selection)` embeds the block; absent → no block.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (`buildSelectionWhy` pure; thread `selectionByClip?: Map` through writeExports as another trailing optional; populate in all.ts from the selection stage). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(export): per-clip selection rationale (top feature contributions)`

### Task 7: Live smoke + docs/memory

- [ ] **Step 1:** `npm run build`; run on a cached multi-topic source (`node dist/cli/index.js all "<cached>" --top 3 --allow-repeats`). Verify: `visual_score` in clip.json is non-zero and varies across clips; a chaotic/faceless window ranks below a clean talking-head one; clips span different `topic`s (not all one label); clip.json has a `selection.why`; `run_report.json` still writes.
- [ ] **Step 2:** Inspect the arc-gate log — confirm survivors get re-ordered by the diversity selector (not pure composite).
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-07-06-v4-sixpart-gap-analysis.md` (tick B deltas #10, #12, #13, #17 done; note #9 timeline facade + #14 sentiment swing deferred within B) and memory; commit.

## Self-review

- **Spec coverage (Slice B deltas):** #12 visual feasibility → T2/T5; #10 topic segmentation + diversity → T3/T4/T5; #13 filler → T1/T5; #17 feature explanation → T6. Deferred within B (documented): #9 Timeline facade (pure refactor, not behavioral — do it if a later slice needs it), #14 sentiment swing (a further prompt extension, low value now). #16 global voice-face binding stays in Slice F (needs diarization).
- **Cost:** visual feasibility runs only on arc survivors (≤ arcTopk, default 8), reusing the WASM detector + ffmpeg scene score already used elsewhere — bounded, Mac-viable. No per-window face detection.
- **Type consistency:** `VisualFeasibility` T2 → T4/T5; `Selectable`/`selectDiverse` T4 → T5; `fillerRatio` T1 → T5; `topicOf` T3 → T5; `SelectionExport`/`buildSelectionWhy` T6. `visual_score` documented as 0-10 (×10 from the 0-1 feasibility) to match sibling layer_scores.
- **Placeholder scan:** every step has real signatures/constants/assertions; no TBD.
- **Divergence preserved:** does not add the spec's full typed scene/story graph — the behavioral wins (visual, topic, filler) land without a graph store, per the gap-doc note. A minimal graph is introduced only if Slice E's composite candidates require it.
