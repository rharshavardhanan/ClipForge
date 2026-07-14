# SP2 — Understanding Layer (Scene Graph · Story Graph · Importance Curve)

**Date:** 2026-07-08 · **Status:** Approved (brainstorm) · **Parent:** `2026-07-06-hybrid-perception-architecture-design.md` §1–2 (SP2)
**Prereq shipped:** SP1 Phases 1a–1d (semantic timeline v1 with real PyAnnote/YAMNet/CLIP producers; pyannote pending the user's HF token — this design degrades without it).

## 0. Decisions (user-approved 2026-07-08)

1. **Scope: the full trio.** Scene Graph + Story Graph + Importance curve, all consumed on day one. (Option "substrate first" declined.)
2. **Architecture: one unified Understanding pass.** The existing per-chunk arc-mining LLM call *widens* into the understanding call — no second brain, no extra pass. Budget-flat: LLM calls per video unchanged vs today.
3. **Perception flips default ON, overlapped.** Launched right after download in the background, awaited only where understanding needs it. Fully local (user mandate: "this whole thing is made to be run locally").
4. **Pinned priors (not re-litigated):** strict 6/6 arc gate remains the export authority; clips remain contiguous `{start,end}` spans (edges inform bounds/gating, never stitch — Narrative Fabrication stays deferred); **Gemini-first mandate** (works fully on free Gemini 2.5 Flash + key pool; Claude structured-outputs is the drop-in upgrade; every Claude-facing schema object carries `additionalProperties: false`).

## 1. Outputs — the understanding contract

One cached artifact per source and provider:
`workspace/analysis/layer_understanding_<provider>.json` (internal `schema_version: 1`; per-chunk incremental entries mirroring the arc cache mechanics — failed chunks are NOT cached, so re-runs retry them). The old `layer_arcs_<provider>.json` is ignored (affected videos re-mine once).

```ts
// src/understanding/types.ts
export interface SceneNode {
  id: string;                    // "sc0"... global after assembly
  span: { start: number; end: number };   // source-absolute seconds
  label: string;                 // "gym workout bet", never "scene N"
  participants: string[];        // timeline speaker ids ("S0") when diarized, else LLM-inferred names
  goal: string;                  // what the people in the scene are trying to do
  emotion: string;               // dominant emotional tone, free text ("tense", "hype")
  events: string[];              // notable atomic happenings, ≤5
  importance: number;            // 0-1 LLM anchor (fused into the curve, §3)
}
export type StoryEdgeType = 'setup_for' | 'escalates' | 'pays_off' | 'reacts_to' | 'callback';
export interface StoryEdge {
  from: string; to: string;      // scene id ("sc3") or arc id ("arc1"); intra-chunk in v1
  type: StoryEdgeType;
  confidence: number;            // 0-1; edges < 0.3 dropped at validation
}
export interface UnderstandingResult {
  scenes: SceneNode[];           // the Scene Graph (nodes; adjacency implicit by time)
  arcs: ArcLabel[];              // EXACTLY today's mineArcs output shape — unchanged
  edges: StoryEdge[];            // the Story Graph edges
  importance: { t: number; v: number }[];  // 1s resolution, whole video, 0-1 (§3)
  provider: string;              // 'claude' | 'gemini' | 'none' (heuristic-only)
}
```

`ArcLabel`, `arcScore`, `validateArc`, `normalizeArcRaw`, the 6/6 gate, and `arcWeightedComposite` are all **unchanged**.

## 2. The unified call — the arc miner grows up

**Package `src/understanding/`** (each file one responsibility):

- `types.ts` — contract above + response JSON-schemas (arc schema imported from arcMiner; scene/edge schemas new, `additionalProperties: false` on every object).
- `digest.ts` — PURE: per-chunk **perception digest** appended to the existing evidence block: CLIP scene lines (`[12.0-45.2] scene: a gym workout`), audience audio events (`[40.2] laughter 0.87` — kinds laughter/applause/cheer/impact only, score ≥ 0.35), speaker turns when present (`[12.1-18.7] S0`). ≤ 40 lines per chunk (strongest-first truncation). Timeline absent → empty string (prompt degrades to today's evidence).
- `prompt.ts` — PURE: absorbs `miningPrompt` (mode vocab kept verbatim); adds instructions + exact JSON shape for `scenes` (2–8 per chunk, spans within the chunk, ≥3s each, non-overlapping) and `edges` (0–8, `from`/`to` are `"sc<i>"`/`"arc<i>"` indexes *within this response*).
- `normalize.ts` — PURE Gemini tolerance layer: `normalizeSceneRaw` / `normalizeEdgeRaw` siblings of `normalizeArcRaw` (string spans `"12.9-31.3"`, stringified numbers, flattened keys); arcs reuse `normalizeArcRaw`.
- `validate.ts` — PURE: clamp scene spans to chunk bounds, drop <3s, sort + trim overlaps (later scene's start snaps to prior end), drop edges with unknown refs or confidence <0.3, importance → `clamp01`.
- `assemble.ts` — PURE: chunk responses → global result. Scene merge across chunk seams: adjacent scenes merge iff gap ≤1s AND same label (case-insensitive) AND participant-set overlap ≥50% (or both empty); merged scene capped at 180s; ids re-assigned globally (`sc0`…), edge refs remapped. Importance curve per §3.
- `engine.ts` — orchestration: chunk loop over `chunkTranscript` output, per-chunk cache, per-chunk fail-soft (`continue`, uncached), key-pool/429 handling via existing `llmJson` helpers. Supersedes `mineArcs`; `arcMiner.ts` keeps the arc schema + `mergeMinedCandidates` (both still consumed), its `mineArcs` body moves/retires.

**Prompt input:** chunk transcript (as today) + evidence block (RMS/motion/silences, as today) + perception digest (new). **One call per chunk — the same call count as today.** Token size grows; the free tier is request-count-bound (20/day/key, pool-rotated), so this is the budget-flat path.

## 3. Importance curve — pure-Node fusion

The LLM only anchors per-scene importance; the curve is deterministic Node math at 1s resolution:

```
scene01(t)  = importance of the scene containing t (step fn), 3-point moving average
rms01(t)    = video-level RMS normalized so p95 → 1, clamped
motion01(t) = motion YDIF normalized so p95 → 1, clamped
event01(t)  = max score of audience events (laughter/applause/cheer/impact) overlapping t, else 0

v(t) = clamp01(0.45·scene01 + 0.20·rms01 + 0.15·motion01 + 0.20·event01)
```

**No-LLM degrade** (provider `none` or all chunks failed): drop the scene term, renormalize the rest (`0.36·rms01 + 0.27·motion01 + 0.36·event01`). **Perception-off degrade:** `event01 ≡ 0` and scenes come from silence boundaries — the curve still exists. Weights are constants in `assemble.ts`; live smoke may tune them, the spec values are the starting point.

## 4. Consumers (all wired in v1 — understanding nobody consumes is pure latency)

1. **Ranker — sort-only importance boost.** `rank`'s sort key (`src/clipDetection/ranker.ts`) gains `IMPORTANCE_SORT_WEIGHT (1.5) × meanImportance01(candidate span)` — the established sort-only pattern (mode-priority boost, filler penalty). Composite untouched; an absent/empty curve → sort key unchanged (bit-identical, function-level guarantee, tested). **Ratified (user decision 2026-07-14, final whole-branch review):** in no-LLM runs the *heuristic* importance curve (RMS/motion/audio-events, no LLM) IS an intended ranking/AVSS signal — offline runs are deliberately NOT bit-identical to pre-SP2; the identity guarantee applies to the empty-curve case, not to provider `none`.
2. **Arc completion + 6/6 gate — richer context.** The completion prompt for each candidate gains the scenes overlapping its bounds + edges touching those scenes (≤12 lines). The gate's 6/6 authority, envelope hard-gate, and `--lenient` escape are untouched — this is evidence, not policy.
3. **AVSS — importance in the attention curve.** `SourceSignals` gains optional `importance?: { t: number; v: number }[]` (clip-relative slice, mirroring `reactionEvents`); the simulator's attention curve adds `0.15 × (importance(t) − 0.5)` when present, clamped. Absent → bit-identical simulation (identity test required).
4. **Exports/GUI (minimal).** `clip.json` gains `understanding: { scene_labels: string[], edge_types: string[] }` for the clip's span; manifest gains `understanding: { scenes: N, edges: M, provider }`; one run-log line (`understanding: 14 scenes, 9 edges, importance ready`). No new GUI surface in v1.

**Deferred consumers (explicitly out of v1):** importance-peak template candidates (Slice E style), SP3 content-type classification (reads the Scene Graph when it arrives), scene-graph GUI visualization, cross-chunk `callback` edges (the type exists; v1 only emits intra-chunk).

## 5. Perception gate flip + overlap

- Gate becomes **default ON**: `--no-perception` flag (replacing `--perception`); `PERCEPTION=0` env kill; `PERCEPTION=1` still forces (back-compat). Venv absent → today's silent debug-level skip; **every failure path leaves the pipeline byte-identical to perception-off.**
- **Overlap:** `analyzeVideo` launches `resolvePerception(...)` immediately after download **without awaiting**; the promise is awaited right before the understanding pass builds digests (after transcript/triggers/audio/semantic — the ~16s pass hides behind that work). The existing 5-minute stall watchdog stands. This removes the Phase-1a frozen-GUI failure mode by construction.
- pyannote remains token-gated and fail-soft; when the user adds `HF_TOKEN`, speaker turns appear in digests and `participants` upgrade from names to speaker ids with no code change.

## 6. Degradation matrix

| LLM | Perception | Result |
|---|---|---|
| yes | yes | Full trio |
| yes | no | Scenes from transcript/silence structure, no audience events in digest/curve; arcs+edges still mined |
| no | yes | Heuristic scenes (timeline scenes as-is), heuristic curve (renormalized), no arcs/edges — no story gate (as today's no-LLM path); the heuristic curve DOES influence ranking/AVSS (ratified 2026-07-14) |
| no | no | Heuristic curve from RMS/motion only — influences ranking/AVSS (ratified); no arcs/edges/gate, everything else pre-SP2 |

Per-chunk LLM failures: warn, skip, uncached (retry next run) — mined chunks still contribute. A fully-failed understanding pass = row 3/4 behavior; the run never dies for understanding reasons.

## 7. Testing

- **Pure units:** digest builder (timeline fixtures incl. empty layers), scene/edge normalizers on captured Gemini loose-shape fixtures, validate (span clamping/overlap trim/edge ref checks), assemble (seam merge, id remap, curve fusion incl. both degrade renormalizations), ranker boost identity (no curve → identical order), AVSS identity (no importance → identical sim), completion-context rendering.
- **Engine:** fake `askJson` (per-chunk failure, cache hit/miss, provider switch).
- **Live smoke (Gemini free key):** real video end-to-end; verify layer file (scenes labeled non-generically, ≥1 edge, curve non-flat), run-log line, selection order shifts only via sort (composites unchanged), completion rejections cite scene context, **call count per video equals today's arc-mining count**, GUI run unaffected (default-ON overlapped: no visible stall after download).
- Gates unchanged: root vitest + tsc, remotion tsc, ui build (not run while dev server live).

## 8. Out of scope

SP3 classification & per-type policies (next; reads this Scene Graph — inputs already in `2026-07-07-sp3-spec-inputs.md`), SP4 Camera Planner, SP5 creator memory, cross-chunk edges, importance-peak candidates, non-contiguous stitching, GUI scene visualization, WhisperX, any paid infra.
