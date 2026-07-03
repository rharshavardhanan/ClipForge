# AVSS v1 — Autonomous Viral Selection System (design)

**Date:** 2026-07-03 · **Branch:** slice-1 · **Spec source:** master spec retitled "ClipForge AVSS v1"

## What this delta adds

The master spec's self-improving layer — the only sections not yet built:

| Spec section | Deliverable |
|---|---|
| 6. Audience Simulator | attention heatmap, swipe hazard, rewatch score, dopamine spikes, retention curve — per clip |
| 7. Multi-armed bandit testing | variants A/B/C per clip, simulated, winner rendered |
| 8. Template Evolution Engine | edit DNA of real high-retention shorts → `./elite_templates/`, 90/10 reuse |
| 9. Editing Policy Network | persistent learning policy driving the exploit variant |
| 10. Consistency Regulator | central clamps on zoom/SFX/B-roll/callout density |
| RL Engine | `clipforge stats` — real YouTube metrics → reward → policy update + template promotion |
| New outputs | `attention_graph / retention_prediction / swipe_risk / rewatch_score / edit_variant_scores` JSONs + `avss` block in clip.json |

Scope: the main pipeline (`all` / `batch` / `process`). RankRot keeps its own engine (Gemini-only mandate) — AVSS-for-RankRot is deferred.

## Approaches considered

1. **Pixel-level simulation** — render all 3 variants, score the rendered video. Rejected: Remotion render is the slowest stage; 3× render time per clip on a laptop is not acceptable.
2. **Plan-level simulation (chosen)** — introduce an explicit **EditPlan** (hook, caption preset, zoom times/intensity, SFX events, B-roll windows) plus **SourceSignals** (word timing, RMS curve, silences, semantic subscores). The simulator scores plans deterministically; only the winner is rendered. Cheap, pure, unit-testable.
3. **Hybrid** — plan-level selection + a post-render ffmpeg `signalstats` novelty pass feeding the final attention graph. Deferred: plan-derived visual-change events (cuts, zooms, B-roll starts, caption emphasis) are an adequate frame-novelty proxy for v1.

**Policy "network":** a PyTorch net is dishonest with ~zero training data and violates the standing no-Python pivot. Chosen: a **per-mode contextual epsilon-greedy bandit** over discrete edit dimensions, persisted as JSON, updated by incremental mean reward. The interface (features in → plan dimensions out) lets a learned model replace it later without touching callers.

## Architecture

New directory `src/avss/`, all pure logic (I/O only at the edges):

```
src/avss/
  editPlan.ts    EditPlan + SourceSignals types; buildEditPlan(); buildSourceSignals()
  simulator.ts   attentionCurve, dopamineEvents, swipeHazard, retentionCurve,
                 rewatchScore, simulate() → SimResult
  regulator.ts   regulate(plan, durationSec) → { plan, violations[] }  (central caps)
  variants.ts    generateVariants(base, policy, pins, seed) → 3 plans; pickWinner()
  templates.ts   EditDna; extractDna(); load/save elite templates; applyTemplate()
  policy.ts      Policy file load/save; chooseArms(mode) ε-greedy; updatePolicy(dna, reward)
  performance.ts fetchVideoStats (Data API) + fetchAnalytics (Analytics API);
                 computeReward(); snapshot persistence
```

### EditPlan & SourceSignals (editPlan.ts)

`EditPlan` = every decision the renderer consumes: `{ hookText?, captionPreset, zoom: { times[], intensity }, sfx: { events[], volume }, broll: windows[], callouts[], musicOn }`. All times clip-relative seconds.

`SourceSignals` = `{ durationSec, words: CaptionWord[], rms: RmsPoint[] (clip-relative slice), silences, semantic: SemanticScores (of the clip's window), sentiment }`.

**Zoom timing single source of truth moves to node.** Today `sfx/events.buildZoomSfxTimes` must hand-mirror `remotion/punchZoom.buildZoomEvents` (a documented gotcha). The plan's `zoom.times` is computed once in node and passed to Remotion via a new optional `ClipCompositionProps.zoomTimes`; `CaptionedClip` uses it when present and falls back to its internal computation when absent (back-compat). SFX whooshes read the same array — the mirror-sync class of bug dies, and zoom-timing variants become possible.

### Audience simulator (simulator.ts)

Deterministic curves at 0.5 s resolution, all 0–1:

- **Attention** — base from speech density (words/s) + normalized RMS; each visual-change event (hook card, zoom, B-roll start/end, emphasized caption word) adds a decaying boost; a staleness decay grows when >2.5 s pass with no visual change (spec: "visual change every 1–2 sec").
- **Dopamine spikes** — events `{ t, kind: impact|reward|humor|surprise, strength }` from emphasized words at RMS peaks (impact), semantic humor/surprise subscores gated to loud moments, hook reveal, payoff (final 20 % high-RMS moment → reward).
- **Swipe hazard** — per-tick exit probability: silence/dead air ↑, staleness ↑, low emotion ↑; the first 3 s are weighted ~3× (weak hook is the dominant swipe cause: no hook text, low RMS, no emphasized word in the window). Emphasized caption pops count as visual changes here too (calibrated after the first live smoke: caption-dense clips are not static frames, and per-tick rates are ~half the per-second intent so a typical clip predicts 25–60 % completion).
- **Retention curve** — survival: `retention[t] = Π (1 − hazard[s])`. Yields `avg_retention`, `completion = retention[end]`, and drop-off points (hazard local maxima).
- **Rewatch score** — surprise + humor subscores, dopamine density in the final 25 % (loop pull), tightness (≤ mode soft cap bonus, cut density), ending-on-a-spike bonus.

`simulate(plan, signals)` → `{ attention, dopamine, hazard, retention, avgRetention, completion, rewatch, overall }` where **overall reuses the spec's reward shape** with pre-upload proxies: `0.35·avgRetention + 0.20·completion + 0.20·rewatch + 0.10·likesProxy(emotional_intensity) + 0.10·commentsProxy(controversy, argument_peak) + 0.05·sharesProxy(humor, surprise)`.

### Consistency regulator (regulator.ts)

One clamp pass over any plan (base or explored): zooms ≤ 2 per 10 s and min-gap ≥ 2.5 s, SFX ≤ 3 per 10 s, B-roll coverage ≤ 40 % (re-verified; planner already enforces), callouts ≤ 2, hook text ≤ 8 words, zoom intensity within [0.3, 1.3]. Returns clamped plan + violation strings (logged, and recorded in `edit_variant_scores.json` so exploration that hits the rails is visible).

### Variants + bandit (variants.ts, policy.ts)

Exactly the spec's explore set — hook, subtitles, zoom timing, sound timing (replay timing is RankRot-only):

- **A = exploit**: mode defaults overridden by policy's best arms; when an elite template for the mode exists, ε-greedy (ε = 0.1) picks template-DNA application vs. exploration as the *base*.
- **B, C = explore**: deterministic seeded perturbations, each differing from A in 1–2 dimensions: hook text source (`hook_moment` vs `clip_titles[0]`), caption preset within the mode's family (clippies: mrbeast/gaming/hormozi; mindcuts: podcast/cinematic/gadzhi), zoom `minGap/maxEvents/intensity` nudges, SFX volume nudge / off. Never full random.
- **Pins**: explicit user flags freeze dimensions — `--style` pins captionPreset, `--no-zooms` pins zoom off, `--no-sfx` pins sfx, etc. Framing is **never** a variant dimension (user rejected dual-framing renders; auto-chosen framing stands). One render per clip, always.

All three are regulated, simulated, ranked by `overall`; the winner's plan drives the single render. `policy.json` (in `workspace/policy/`) holds per-mode arms: `{ captionPreset: { mrbeast: { n, mean }, … }, hookSource: …, zoomBucket: …, sfxOn: … }` plus `epsilon` and a version counter.

### Template evolution (templates.ts)

`EditDna` — the spec's "edit DNA": `{ mode, captionPreset, hookSource, zoom: { per10s, intensity, firstAt }, sfxPer10s, brollCoverage, pacing: { wordsPerSec, eventsPer10s } }`. Extracted from the winning plan at export time and embedded in clip.json's `avss` block.

Promotion happens in `clipforge stats`: a clip whose **real** `averageViewPercentage ≥ 70 %` gets its DNA written to `./elite_templates/elite_template_vN.json` `{ version, created_at, source: { videoId, clip_id }, retention, dna }` (skip if an existing template's DNA is near-identical). `applyTemplate(dna, base)` maps DNA back onto a plan (preset, hook source, zoom density/intensity targets).

### RL engine (performance.ts + `clipforge stats`)

`clipforge stats [exportsDir…]` (no dir = scan `workspace/exports/*`):

1. Collect clips whose clip.json has `youtube.videoId`.
2. **Data API** `videos.list part=statistics` (existing `youtube.readonly` scope) → views, likes, comments.
3. **Analytics API** (`yt-analytics.readonly` — appended to `SCOPES` for new auths) → `averageViewPercentage`, `averageViewDuration`, `shares`. A 401/403 (old token) degrades gracefully: snapshot marked `partial`, CLI prints "re-run ./start.sh auth youtube to grant analytics scope".
4. **Reward** (spec formula): `retention = min(1, avgViewPct/100)`; `rewatch = min(1, max(0, avgViewPct/100 − 1) × 2)` (Shorts loop past 100 % = literal rewatches); `completion = min(1, avgViewDuration/durationSec)`; `likesNorm = min(1, 20·likes/views)`, `commentsNorm = min(1, 200·comments/views)`, `sharesNorm = min(1, 100·shares/views)`. `r = 0.35·retention + 0.20·completion + 0.20·rewatch + 0.10·likesNorm + 0.10·commentsNorm + 0.05·sharesNorm`.
5. Snapshot to `workspace/performance/<videoId>.json` (append-only history). **Full** snapshots update policy arms from the clip's stored DNA and run template promotion. Partial snapshots are recorded only.

### Pipeline integration (all.ts)

Inside the per-clip loop, after framing and B-roll are known (B-roll is expensive I/O and not a variant dimension — acquired once, shared by all variants): build SourceSignals + base EditPlan → `generateVariants` (policy + templates loaded once per run) → regulate → simulate → write `clip_00N_edit_variant_scores.json` → pick the **winner** → compute callouts from the *winner's* zoom times (callouts ride zoom events, which vary per variant) → render the winner (its captionPreset/hook/zoomTimes/intensity/sfx flow into existing `render()`/`planSfx`/`mixSfx` calls) → write the four simulator JSONs for the winner → `avss` block into clip.json via exporter.

### Outputs (per clip, in the exports dir)

`clip_00N_attention_graph.json` (attention curve + dopamine spikes), `clip_00N_retention_prediction.json` (curve, avg, completion, drop-off points), `clip_00N_swipe_risk.json` (hazard curve, top-3 risk moments, overall), `clip_00N_rewatch_score.json` (score + factor breakdown), `clip_00N_edit_variant_scores.json` (all 3 variants: dimension diffs, violations, predicted metrics, winner flag). clip.json gains `avss: { variant, dna, predicted: { retention, completion, rewatch, overall }, policy_version }`.

### GUI

Minimal: Clips tab shows a predicted-retention badge (from the clip.json `avss` block) next to each clip. No new tabs.

## Error handling

AVSS is **fail-soft end to end**: any simulator/variant error logs a warning and falls back to the pre-AVSS base plan (today's behavior); `stats` never throws per-video (collects per-video errors like `upload` does); missing policy/templates files = cold start (mode defaults, no exploration bias). A clip export never fails because of AVSS.

## Testing

Vitest, pure functions: simulator monotonicity (dead air ⇒ hazard ↑; more visual events ⇒ attention ↑; uniform hazard ⇒ exponential retention; weak first-3 s ⇒ overall ↓), regulator clamp cases, variant determinism + pin respect + never-vary-framing, DNA extract/apply round-trip, ε-greedy arm selection + incremental mean update, reward formula (incl. >100 % avgViewPct → rewatch), template promotion threshold + dedupe, exporter writes all five JSONs + avss block, stats command with mocked fetch (full, partial-scope, quota-error paths), zoomTimes prop back-compat in Remotion logic tests.

Gates: full vitest suite, `tsc --noEmit` (root + remotion), `next build` (ui) — all standing.

## Deferrals (recorded, deliberate)

Post-render pixel novelty pass; AVSS for RankRot; neural policy (bandit interface is the slot); real per-second YouTube retention curves (`audienceWatchRatio` needs channel content-owner reports for Shorts in many cases — avgViewPercentage is the reliable metric); GUI graphs of the curves (badge only).
