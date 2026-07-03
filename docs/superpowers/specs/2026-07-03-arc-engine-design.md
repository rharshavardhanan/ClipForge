# Micro-Story Arc Engine — Design (v7 slice 1)

**Date:** 2026-07-03
**Status:** Approved (brainstorm session; user chose hybrid detection, hard gate, strict 6/6, Gemini-first)

## Goal

Stop extracting moments; construct complete shorts. Every exported clip must be a
micro-story — **setup → trigger → escalation → peak → payoff → reaction** — or it
does not export. This is v7's core architecture change and fixes the dominant
quality failures: starts-in-middle, ends-before-payoff, isolated screams,
context-free quotes.

**Scope:** the main pipeline (`all` / `process` / `batch`), both modes
(clippies + mindcuts). **Out of scope** (later v7 slices): RankRot rebuild
(topic validation, 10–20s segments), heavy per-sentence B-roll, framing v3
(object tracking / split crop), clippies style pack (freeze frames, impact
text). The Channel Intelligence spec (same date) is independent and untouched.

## Hard constraints

1. **Gemini-first:** every arc feature must run fully on Gemini 2.5 Flash (the
   user's free test path), with Claude as a drop-in upgrade via the existing
   provider routing (`pickSemanticProvider` / `SEMANTIC_PROVIDER`). No
   Claude-only capability. Gemini 2.5 Flash vision handles the keyframes.
2. **No LLM configured → arc engine disabled** with a logged warning; pipeline
   behaves exactly as today. The gate never runs on heuristics — it must never
   silently pass or fail clips without a labeler.
3. Existing pipeline invariants hold: sentence-aware boundaries, mode length
   envelopes, `used_ranges` no-repeat, one auto-chosen framing per clip.

## 1. Provider layer (`src/analysis/llmVisionJson.ts` or extension of `broll/llmJson.ts`)

One vision-capable JSON helper shared by mining and completion:

```ts
askVisionJson(opts: {
  prompt: string;
  images?: { data: Buffer; mimeType: 'image/jpeg' }[];   // ≤6, pre-downscaled
  schemaHint: string;            // JSON shape description embedded in prompt
  provider?: 'claude' | 'gemini';
}): Promise<unknown>
```

- Gemini: inline base64 parts. Claude: vision content blocks. Same prompt text.
- Malformed JSON → one repair retry (reuse existing llmJson pattern), then throw
  to the caller's degradation path (§6).
- Provider resolution identical to the semantic layer.

## 2. Motion evidence (`src/analysis/motion.ts`)

RankRot's ffmpeg `signalstats` YDIF extraction is promoted into the main
pipeline as an analysis layer: per-second motion series for the whole source,
computed once, cached in `workspace/analysis/<jobId>/layer_motion.json`
(same cache discipline as other layers; no LLM involved).

**Evidence block** (pure function, unit-tested): per candidate window, a compact
text summary fed to arc prompts — RMS curve (downsampled ~1 value/2s), motion
curve (same), silence gaps, face presence per second when framing data exists.
Numbers rounded to 1 decimal; block capped ~40 lines.

## 3. Mining pass — recall (`src/analysis/arcMiner.ts`)

- Transcript split into ~9-minute chunks with 1-minute overlap (pure chunker,
  boundary math unit-tested).
- One LLM call per chunk: transcript slice + that chunk's evidence block →
  0–4 micro-stories per chunk:

```json
{ "arcs": [ {
  "synopsis": "...",
  "confidence": 0.0-1.0,
  "components": {
    "setup":      { "start": s, "end": s },
    "trigger":    { "start": s, "end": s },
    "escalation": { "start": s, "end": s },
    "peak":       { "start": s, "end": s },
    "payoff":     { "start": s, "end": s },
    "reaction":   { "start": s, "end": s }
  }
} ] }
```

- Prompt states: components may be **brief (≥0.5s) or overlapping/nested**
  (trigger inside setup, escalation coinciding with peak) — identify all six or
  omit the arc. Mode-specific vocabulary: clippies (challenge/joke/fail setup,
  rage escalation, reaction payoff), mindcuts (hook, explanation, escalation,
  insight/payoff).
- Mined arcs → candidate windows (span = setup.start → reaction.end), merged
  into the scorer's candidate pool; dedupe: drop the mined arc when overlap with
  an existing candidate ≥50% of either span (the existing candidate keeps its
  composite score and gains the arc labels).
- Cache: `layer_arcs_<provider>.json` per jobId (mirrors semantic cache
  namespacing). Chunk results cached individually so resume skips priced work.

## 4. Completion pass — precision (`src/analysis/arcCompleter.ts`)

Runs after ranking, on the top `K = max(--arc-topk, requested clip count)`
(`--arc-topk` default 8) candidates:

- **Inputs per candidate:** transcript ±60s around the window, evidence block,
  existing arc labels if mined, and **4–6 keyframes** — ffmpeg still frames at
  window start, RMS/motion peak, and end (±0.5s), downscaled to ≤512px JPEG.
  Frames go through `askVisionJson` so silent fails and physical comedy are
  visible to the labeler.
- **Output:** the six component spans (source-absolute), missing components (if
  any), proposed bounds `{ start, end }`, confidence, synopsis, plus
  `reactionAfterPeak: boolean`.
- **Bounds rules (pure, unit-tested):** proposed start ≤ setup.start, end ≥
  reaction.end; expansion beyond the original window ≥3s backward and ≥3s
  forward when the model says context is incomplete ("context > shortness");
  clamped to the mode envelope (clippies 15–45s, mindcuts 20–60s), then the
  existing sentence-aware clamp applies; result must not collide with
  `used_ranges` (collision → pull the colliding edge back to the used range's
  boundary; if that cuts into any component span → candidate rejected with
  reason `overlap`).
- The clip is re-cut to the completed bounds before extraction/render.

## 5. The gate and scoring

- **Strict 6/6 (user mandate):** a clip exports only if all six components are
  identified within its final bounds. Any missing component → rejected, with
  the missing parts named. A run CAN export zero clips.
- `--lenient`: rejected clips export anyway, labeled
  `arc: { complete: false, missing: [...] }` in clip.json. No other behavior
  change.
- **arcScore** (pure): `confidence × completenessFraction × (reactionAfterPeak ? 1.15 : 1.0)`,
  clamped to [0,1]. With the strict gate, completenessFraction is 1 for
  exported clips; it matters under `--lenient` and in ranking pre-gate.
- **Ranker composite (two-stage, no circularity):** at initial ranking, only
  mining-derived labels exist — mined arcs carry their mining arcScore,
  scorer-only candidates rank with arcScore 0 (intended bias: mined arcs ARE
  complete stories). arcScore joins the composite at weight 0.25 with existing
  weights renormalized (deliberately NOT sort-only — story completeness is now
  the product). After the completion pass, the surviving gated clips are
  re-sorted by the updated composite (completion-refined arcScore) before
  export. **Export set = gated top-K only** — a candidate that never received a
  completion check can never export.

## 6. Degradation ladder

| Failure | Behavior |
|---|---|
| No LLM provider | Arc engine off, warning, pipeline as today (no gate) |
| Mining call/chunk fails | That chunk contributes no mined arcs; scorer candidates still flow |
| Completion call fails (after 1 JSON-repair retry) | Candidate rejected with reason `arc-label-failed` (never exported ungated); `--lenient` exports it labeled `unlabeled` |
| Keyframe extraction fails | Completion proceeds numbers-only (logged) |
| All top-K rejected | Zero-clip run: manifest + CLI table report per-candidate missing components |

## 7. Integration & outputs

- `clip.json` gains `arc: { components, complete, missing, arcScore, synopsis,
  reactionAfterPeak, provider }`.
- Manifest: per-clip `arc_complete` + rejection list with reasons; CLI prints a
  rejection table.
- GUI Clips tab: complete/incomplete badge (green/amber) from manifest — small,
  read-only.
- `all` / `process` / `batch` all flow through mining + completion + gate.
  `rank` (cross-video countdown) consumes gated clips unchanged. RankRot
  untouched.
- Hook stays chronological: the completed arc's setup opens the clip; curiosity
  comes from the hook-card text, now derived from the arc synopsis when
  available (falls back to existing hook text logic).

## 8. Cost control

~1 mining call per 9 source-minutes (text-only) + K completion calls (images
only here). `--arc-topk` (default 8) bounds the expensive pass. Both passes
cached per provider; re-runs after a crash pay nothing for completed chunks.

## 9. Tests & verification

- Pure units: chunker boundaries/overlap, evidence-block summarization + caps,
  arc JSON validation (spans ordered, within source, ≥0.5s), dedupe overlap
  rule, bounds clamping (envelope, sentence clamp interaction, used_ranges
  shrink/reject), gate rule (6/6, missing naming), arcScore formula + reaction
  bonus, ranker renormalization with the 0.25 weight.
- Provider layer: prompt assembly for both providers, image part encoding, JSON
  repair retry, error propagation (mock fetch — existing seam pattern).
- Pipeline integration test with a stubbed LLM: mined arc becomes a candidate,
  completion expands bounds, gate rejects a 5/6 candidate, `--lenient` exports
  it labeled.
- **Live smoke before completion claims:** real VOD end-to-end on Gemini 2.5
  Flash (`SEMANTIC_PROVIDER=gemini`), inspect an exported clip's arc block and
  at least one rejection reason.
