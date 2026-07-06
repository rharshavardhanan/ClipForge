# v4 Slice E — Composite / Arc-Template Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface clip candidates the sliding-window scorer misses — question→answer exchanges and reaction/punchline moments — by scanning the transcript with pure arc-template heuristics and folding them into the candidate pool, so the Director selects moments anchored to narrative structure, not just a 30s grid.

**Architecture:** A new pure `src/director/arcTemplates.ts` scans transcript segments (+ trigger hits + RMS) for two patterns — Q&A (a question segment + the following answer) and reaction-anchored (a Tier-1 trigger with setup before + tail after) — and emits `ClipCandidate`s scored like the window fallback plus a small template bonus. These merge into the pool exactly like the arc miner's output (`mergeMinedCandidates` pattern), then flow through the UNCHANGED rank → 6/6 arc gate → diversity select → Slice C tighten → render path. No clip-model change: a composite is a contiguous outer span whose mid-clip aside (if any) is excised by Slice C's tightening. The full non-contiguous node_path + explicit stitcher from the spec is deferred (documented) — the outer-span-plus-tighten approach covers the common Q→A-with-aside case without rewriting the pipeline's contiguous `{start,end}` clip.

**Tech Stack:** TypeScript (ESM, Node 24), vitest. Pure heuristics — no LLM, no new cost (works even with SEMANTIC_PROVIDER=none).

## Global Constraints

- Pure, no new deps, no LLM. Template detection runs on data `analyzeVideo` already has (segments, triggers, audio).
- Template candidates compete fairly: composite = `triggerScore·0.6 + audioScore·0.4 + templateBonus` (same shape as windowScorer's no-semantic fallback), capped at 10 — so strong pattern moments reach the arc-gate's top-K, weak ones don't.
- Merge dedups against the existing pool: a template candidate overlapping an existing candidate ≥ `TEMPLATE_MERGE_OVERLAP` (0.5) is dropped (the existing one already covers it); disjoint ones are added. Mirrors the arc-miner dedupe.
- Every emitted candidate respects the mode length envelope `[lengths.min, lengths.max]`.
- The 6/6 arc gate still validates these as real stories (a Q&A that isn't a complete arc gets rejected like any candidate) — template detection only proposes, it never bypasses the gate.
- All new logic pure; tests under `tests/director/`, importing `../../src/director/<mod>.js`.
- Standing gates after every task: `npx vitest run` green, `npx tsc --noEmit` clean (root), `cd remotion && npx tsc --noEmit` clean, `cd ui && npx next build` clean.

---

### Task 1: Arc-template detectors (`src/director/arcTemplates.ts`)

**Files:**
- Create: `src/director/arcTemplates.ts`
- Test: `tests/director/arcTemplates.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment`, `TriggerHit`, `AudioEnergyLayer`, `ClipCandidate`, `ClipLengths` (from `src/modes.js`).
- Produces (Tasks 2, 3):

```ts
export const TEMPLATE_QA_BONUS: number;         // 1.0
export const TEMPLATE_REACTION_BONUS: number;   // 1.5
export const PClipLengths = ...                 // (use ClipLengths from modes)
/** PURE: composite for an arbitrary span from triggers + audio (windowScorer fallback shape) + bonus. */
export function spanComposite(start: number, end: number, triggers: TriggerHit[], audio: AudioEnergyLayer, bonus: number): { composite: number; triggerScore: number; audioScore: number };
/** PURE: is this segment's text a question? (ends with '?' or opens with an interrogative). */
export function isQuestion(text: string): boolean;
/** PURE: question segment + following answer → a candidate spanning both, clamped to the
 *  mode envelope. Skips questions with no following content. */
export function detectQaCandidates(segments: TranscriptSegment[], triggers: TriggerHit[], audio: AudioEnergyLayer, lengths: ClipLengths, duration: number): ClipCandidate[];
/** PURE: each Tier-1 trigger anchors a reaction/punchline candidate = setup before + tail after. */
export function detectReactionCandidates(segments: TranscriptSegment[], triggers: TriggerHit[], audio: AudioEnergyLayer, lengths: ClipLengths, duration: number): ClipCandidate[];
/** PURE: both templates, concatenated. */
export function generateArcTemplateCandidates(segments: TranscriptSegment[], triggers: TriggerHit[], audio: AudioEnergyLayer, lengths: ClipLengths, duration: number): ClipCandidate[];
```

`isQuestion`: trimmed text ends with `?`, OR the first word matches `/^(what|why|how|when|where|who|which|is|are|do|does|did|can|could|would|should|will|has|have)$/i`. `detectQaCandidates`: for each question segment `q`, span = `{ start: q.start, end: min(duration, q.start + lengths.soft) }`; require at least one segment starting after `q.end` within the span (a real answer); clamp span length into `[lengths.min, lengths.max]`; composite via `spanComposite(..., TEMPLATE_QA_BONUS)`. `detectReactionCandidates`: for each Tier-1 trigger `t`, span = `{ start: max(0, t.time − lengths.soft·0.6), end: min(duration, t.time + lengths.soft·0.4) }`, clamped to the envelope; composite via `spanComposite(..., TEMPLATE_REACTION_BONUS)`. `spanComposite`: `triggerScore = min(10, Σ weights in span)`, `audioScore = mean rms in span (0 if none)`, `composite = min(10, triggerScore·0.6 + audioScore·0.4 + bonus)`.

- [ ] **Step 1: Write failing tests** — `isQuestion('Why did you do that?')` true, `isQuestion('Because I wanted to.')` false, `isQuestion('Is that real')` true (interrogative opener); `detectQaCandidates` on a question seg at 10s with an answer seg at 13s → one candidate starting at 10, length within envelope; a question at the very end (no answer) → none; `detectReactionCandidates` on a Tier-1 trigger at 40s → a candidate bracketing 40s within the envelope; `spanComposite` sums trigger weights + mean rms + bonus, capped at 10; every emitted candidate has `end − start` within `[lengths.min, lengths.max]`.
- [ ] **Step 2:** Run `npx vitest run tests/director/arcTemplates.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(director): Q&A + reaction arc-template candidate detectors`

### Task 2: Merge template candidates into the pool (`src/director/arcTemplates.ts`)

**Files:**
- Modify: `src/director/arcTemplates.ts` (add merge)
- Test: `tests/director/arcTemplates.test.ts` (extend)

**Interfaces:**
- Consumes: `overlapFraction` from `src/analysis/arcMiner.js` (reuse the existing span-overlap helper), `ClipCandidate`.
- Produces (Task 3):

```ts
export const TEMPLATE_MERGE_OVERLAP: number;   // 0.5
/** PURE: fold template candidates into an existing pool — drop any overlapping an existing
 *  candidate ≥ TEMPLATE_MERGE_OVERLAP (already covered), keep disjoint ones. Mirrors the
 *  arc-miner dedupe so template + window + arc candidates coexist without duplicates. */
export function mergeTemplateCandidates(existing: ClipCandidate[], templates: ClipCandidate[]): ClipCandidate[];
```

- [ ] **Step 1: Failing tests** — a template candidate 60%-overlapping an existing one is dropped; a disjoint template candidate is appended; two template candidates overlapping each other both survive if disjoint from the pool (merge is only vs `existing`); empty templates → pool unchanged.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (`overlapFraction` against each existing; keep if max overlap < threshold). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(director): merge arc-template candidates into the pool (dedupe vs window/arc)`

### Task 3: Wire into `analyzeVideo`

**Files:**
- Modify: `src/cli/commands/all.ts` (`analyzeVideo`, after arc mining)
- Test: covered by the existing `analyzeVideo` path + the pure tests above (no new unit test; the merge is pure and tested)

**Interfaces:** Consumes `generateArcTemplateCandidates` + `mergeTemplateCandidates` (Tasks 1–2).

- [ ] **Step 1:** After the arc-mining block sets `arcCandidates`, add: `const templates = generateArcTemplateCandidates(segments, triggers, audio, profile.lengths, meta.duration); const finalCandidates = mergeTemplateCandidates(arcCandidates, templates); if (templates.length) logger.info(\`arc templates: +\${finalCandidates.length - arcCandidates.length} Q&A/reaction candidate(s)\`);` and return `candidates: finalCandidates`. (Runs regardless of LLM — pure heuristics add value even with the arc engine off.)
- [ ] **Step 2:** `npx vitest run` (full) + `npx tsc --noEmit` — PASS/clean. (The change is additive to the candidate array; existing tests exercise the downstream path.)
- [ ] **Step 3: Commit** `feat(director): arc-template candidates feed the pipeline (Q&A + reaction anchors)`

### Task 4: Live smoke + docs/memory

- [ ] **Step 1:** `npm run build`; run on a cached podcast/interview-style source (`node dist/cli/index.js all "<cached>" --top 3 --allow-repeats --min-retention 0`). Verify the log shows `arc templates: +N` candidates; inspect a resulting clip.json to confirm a Q&A- or reaction-anchored span was selected (its start aligns to a question/trigger, not a 15s grid multiple).
- [ ] **Step 2:** Confirm the arc gate still governs — template candidates that aren't complete stories appear in the rejection table, not the exports.
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-07-06-v4-sixpart-gap-analysis.md` (tick #11 — note the non-contiguous stitcher deferred, outer-span+tighten covers the common case) and memory (all 5 slices done); commit.

## Self-review

- **Spec coverage (Slice E delta #11):** Q&A + setup→punchline arc templates → T1; merge into pool → T2; pipeline wiring → T3. Deferred (documented): the spec's explicit multi-span `node_path` + `Stitcher` and `RESPONDS_TO`/`SAME_TOPIC` graph edges — a composite here is a contiguous outer span whose mid-clip aside is excised by Slice C tightening, which handles the common Q→A case without the contiguous-clip-model rewrite. Full diarization-based speaker-turn Q&A pairing waits on Slice F diarization.
- **Reuse:** mirrors the proven `mergeMinedCandidates` pattern; template candidates traverse the entire existing rank/gate/select/tighten/render path unchanged — lowest-risk way to add candidate sources.
- **Type consistency:** `spanComposite`/`detectQaCandidates`/`detectReactionCandidates`/`generateArcTemplateCandidates` T1 → `mergeTemplateCandidates` T2 → `analyzeVideo` T3; all emit `ClipCandidate` (existing type, `arc` field left undefined — the arc gate labels them downstream).
- **Placeholder scan:** every step has real signatures/regex/formulas/assertions; no TBD.
