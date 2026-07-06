# v4 six-part spec → existing system: gap analysis (running doc)

**Date started:** 2026-07-06 · **Decision (user, 2026-07-06):** UPGRADE the existing TypeScript
system — no Python rewrite, no Python sidecar. The spec's *philosophy and contracts* are adopted;
its *stack prescriptions* (Python/mypy/pydantic/typer, WhisperX/PyAnnote/YOLO11/ByteTrack/SAM2)
are treated as capability requirements to be met with the existing Node-native equivalents or
explicitly deferred. Standing constraints that override the spec text (per the spec's own
"philosophy wins / ask don't guess" rule, resolved with the user):

- **Pure Node/TS** (no Python microservices) — decided 2026-07-02, reaffirmed 2026-07-06.
- **Local-first, free-only, single Mac (Apple Silicon, no CUDA)** — GPU-class perception models
  (SAM2/YOLO/PyAnnote) are not viable at realtime here; ladder rungs stop at what the Mac runs.
- The working system stays live throughout — upgrades land as increments on `slice-1`, each
  gated by the standing test/build gates.

This document accumulates one section per spec part as the user pastes them. Each section maps
spec concepts → existing modules, and extracts the genuine deltas. The consolidated upgrade
design + prioritized plan happens after all parts are in.

---

## Part 1 — Vision, Architecture & Engineering Standards

### Already realized (concept → existing implementation)

| Part 1 concept | Existing equivalent |
|---|---|
| Director / Editor / Framing separation | `clipDetection/` + `analysis/` (what) · `avss/` + `captions/` + `sfx/` + `broll/` (how) · `extraction/` (where) — boundaries already match §3.1 |
| "A clip has an arc; ends mid-thought = defect" | Arc engine: strict 6/6 gate (hook/setup/tension/climax/payoff/reaction), sentence-aware boundary snap in merger |
| Cuts on natural boundaries, silence as information | Sentence-aware length clamp; silence regions feed the swipe-hazard model |
| Active-speaker framing, multi-person logic | `faceTracker.ts` active-speaker track w/ eased switches, scene-cut segmentation, edge-aware zoom |
| Center-crop only as explicit last resort | `forcedCropTrack` ladder: active-speaker → single-face → center (logged); auto mode prefers blur over bad crop |
| Determinism & seeds | Seeded variants (`rngFromSeed`), deterministic SFX/music picks; NOT yet byte-comparable end-to-end (see gaps) |
| Explainability / rationale fields | clip.json `arc` block, `avss` block (variants, violations, predictions), rejection tables, `reason` on ranked clips |
| Quality audit pass/fix/reject | Arc gate (reject) + AVSS retention floor (segregate) + regulator (fix/clamp) |
| Analytics/RL offline loop | `clipforge stats` → policy bandit + elite templates; channel-intelligence design approved |
| Stage caching / resumability | Workspace stage caching (downloads/transcripts/analysis per jobId) — same purpose as the CAS bus, keyed by jobId not content hash |
| Graceful degradation ladders | Exist ad hoc: semantic Claude→Gemini→triggers-only; transcript json3→whisper-cpp; thumbnail remotion→plain frame; broll LLM→heuristic |
| No hallucinated subtitles | Captions strictly from json3/whisper word timings |
| Local LLM fallback | Partial: pipeline degrades to trigger+audio scoring with no key (not a local model, but no hard cloud dependency) |

### Genuine deltas from Part 1 (candidate upgrade items — prioritize after Parts 2–6)

1. **Reason-code enum + run report.** Degradations are currently free-text `logger.warn`s. Adopt
   §7.4: one shared enum (`src/report/reasonCodes.ts`), every fallback path tagged, per-run
   aggregation into a `run_report.json` in the exports dir. Cheap, high-leverage, matches the
   existing fail-soft philosophy.
2. **EDL as the render contract.** Render decisions currently split between node-built props and
   Remotion-internal logic (zoomTimes prop closed part of this). Formalize: one
   `edl.json` per clip (segments, crop track, captions, transitions, audio ops, rationale) that
   the Remotion composition consumes verbatim → re-render reproducibility + auditability.
3. **Golden tests.** Commit fixture EDLs/decision JSONs for 2–3 small fixtures; CI fails on
   silent edit-decision drift. Extends the existing vitest suite; no new infra.
4. **Speaker diarization.** Explicitly deferred to date (known deferral). Spec wants
   voice-to-face binding. Node-viable candidates to evaluate at Part 4 time: mouth-openness
   correlation (already have) upgraded to per-speaker segment attribution; whisper-cpp
   `--diarize`/tinydiarize; sherpa-onnx speaker embeddings (pure ONNX, Mac-friendly).
5. **Capability-ladder formalization.** Turn today's ad-hoc fallbacks into a declared ladder per
   stage (typed, logged with reason codes, surfaced in the run report as "degraded" flags).
6. **Config/run hash.** Config fields that change edit decisions → a run hash recorded in
   manifests (repro/debugging). Lightweight version of §5's rule.
7. **Structured logs.** `logger` gains optional JSON mode w/ run_id + stage fields. Low priority.
8. **Object detection beyond faces (YOLO-class).** No Node-native equivalent that's Mac-fast;
   candidate: onnxruntime-node + a small detector. Decide at Part 4 based on what Framing
   actually needs it for. Default: DEFER unless Part 4 justifies.

### Explicitly NOT adopted (with reason)

- Python toolchain (mypy/ruff/pydantic/typer) → TS strict mode + vitest already enforce the
  same standards natively.
- WhisperX/PyAnnote/SAM2/ByteTrack as named dependencies → capability requirements, not
  dependencies; Mac-viable equivalents or deferral per item above.
- `pyproject.toml` repo scaffold (§8) → existing layout stands; new shared contracts go in
  `src/types/` (the schema/ analogue), report machinery in `src/report/`.
- CAS artifact bus → jobId-keyed workspace caching already provides staged resume; a
  content-hash rewrite is high-churn/low-yield at this scale. Revisit only if Parts 2–6 hang
  hard requirements off content addressing.

---

## Part 2 — Director engine

### Already realized (concept → existing implementation)

| Part 2 concept | Existing equivalent |
|---|---|
|

| `DIRECTOR_NO_ARC_FOUND` handling | Arc rejection table (`arcRejectionRow`, printed per run) + `arc.complete=false` labeling under `--lenient` |
| Transparent weighted feature scoring, stored vector | Composite score over interpretable layers; `layer_scores` in clip.json; AVSS/Channel-Intelligence RL tunes weights/arms, never replaces features — same philosophy as §4 |
| `self_containedness` | Semantic layer's `is_standalone` flag (LLM-judged) |
| `quotability` | `wisdom` subscore ≈ |
| `length_fit` | `recommended_duration` + mode envelopes + adaptive merger |
| `boundary_cleanliness` | Sentence-aware boundary snap (merger) — enforced, not just scored |
| `arousal_peak` / `event_bonus` | RMS peaks in windowScorer; trigger hits ≈ emphasis events |
| Non-overlap + count/length constraints + quality floor | ranker dedup + `used_ranges` + `--top` + mode lengths + `minScore` floor; "return fewer, don't lower the bar" = existing behavior (arc gate + retention floor) |
| Per-speaker/multi-video spread | `--per-video-cap` (source diversity; speaker diversity absent) |
| Anti-clickbait (hook must be delivered on) | Arc gate requires a real payoff/reaction span to pass |
| Active-speaker cues (lip motion, size, centrality) | `pickActiveSpeaker` mouth-openness machinery — per-sample though, not globally solved (§1.3 wants global binding) |
| Shot boundaries | `sceneCuts.ts` (added for framing 2026-07-03) — reusable as the Shot signal |
| Escalation template | windowScorer rising-energy behavior ≈ implicit |

### Genuine deltas from Part 2

9. **Timeline query facade.** `VideoAnalysis` is a bag of arrays each consumer slices ad hoc
   (`buildSourceSignals`, `buildEvidenceBlock` are mini-fusions). A `Timeline` class per §1.2
   (`wordsIn/utterancesIn/silences/nearestBoundary/energyEnvelope/...`) over the EXISTING fields
   is a pure refactor that de-duplicates that slicing and gives later deltas a home. Low risk.
10. **Topic segmentation + topic-diversity selection.** Nothing today prevents 6 clips from one
    riff (only per-VIDEO cap exists). Cheapest honest path: the semantic pass already reads the
    whole transcript in windows — extend the Claude/Gemini prompt to emit topic-boundary spans +
    labels (near-zero marginal cost), then add the §5.2 redundancy penalty (greedy + λ·topic/
    speaker/time-adjacency overlap) to `rankAcrossAnalyses`. Local-search swaps: seeded, bounded.
11. **Composite (non-contiguous) candidates — arc templates.** Biggest conceptual gap. Today all
    clips are contiguous spans; only the montage engine assembles non-contiguous material. §3.2's
    templates (Q&A pair, setup→punchline→laugh, claim→evidence→conclusion) as small pure
    functions producing multi-span candidates — requires Part 3's stitcher to assemble, so
    design lands only together with Part 3's delta. RESPONDS_TO detection: turn adjacency +
    question detection over segments (pure heuristics first, LLM assist optional).
12. **Visual feasibility features (`subject_clarity`, `shot_stability`).** `visual_score` in
    clip.json is literally 0 today — selection is blind to whether Framing will find a subject.
    Face-presence fraction (existing `detectFrameObs` on candidate spans, sampled cheap) +
    shot-change density (existing sceneCuts) as two new scored features. Directly reduces the
    "ceiling shot"-class failures at SELECTION time instead of framing time.
13. **Filler detection.** `is_filler` on words (um/uh/like lexicon + duration heuristics) —
    feeds `filler_penalty` here and Part 3's filler-removal cuts. Pure, testable.
14. **Sentiment swing.** Single sentiment label today; valence delta across the arc needs
    per-utterance sentiment — extend the semantic window prompt (marginal cost ~zero) rather
    than a new model.
15. **Laughter/applause event detection.** Recurs throughout (EMPHASIZES edges, event_bonus).
    No Node-native detector today. Candidates: spectral-flatness+energy heuristic (cheap, weak)
    vs. small ONNX audio classifier (YAMNet-class via onnxruntime-node). DECIDE at Part 6
    (integration matrix) — until then, trigger phrases + RMS spikes remain the proxy.
16. **Global voice-to-face binding.** Extends Part 1's diarization delta: solve speaker↔track
    assignment globally over the video (not per-sample), `MIN_SPEAKER_BIND_CONFIDENCE` + null
    over guessing. Gated on choosing the diarization approach (Part 1 delta #4).
17. **Feature explanation in report.** Per selected clip: top-3 positive / top-2 negative
    contributing features (straight from the existing layer/feature vector) → run report
    (delta #1's artifact).

### Notes / divergences to preserve

- Our 6-component arc gate is stricter than the spec's 3-tier arc — keep 6/6 (user mandate),
  map spec tiers onto it (hook→hook, development→setup+tension+climax, payoff→payoff+reaction).
- §2's full typed scene graph (nodes/edges/serialization) is heavier than needed to get the
  value: deltas #10–12 capture the behavioral wins without committing to a graph store. If
  Part 3's stitcher needs explicit RESPONDS_TO/SAME_TOPIC edges, introduce a minimal
  `SceneLink[]` structure then — not a full graph layer speculatively.
- The Director already has something Part 2 lacks entirely: AVSS pre-render audience simulation
  and the retention floor. Selection-time integration of predicted retention (already computed)
  as a feature is a candidate consolidation-phase item.

## Part 3 — Editor engine

### Already realized

| Part 3 concept | Existing equivalent |
|---|---|
| Never cut mid-word; boundary snapping | Merger's sentence-aware clamp + arc bounds resolution — ENFORCED, stronger than scored |
| Hook hits immediately | Arc hook span starts the clip; hook card overlay |
| Captions from ASR only, word timing, karaoke highlight, styling presets | json3/whisper word tokens → `captionWords` → 9 presets, emphasized-word highlight; never LLM text |
| Music ducking | `mixMusic` sidechain duck |
| Transitions default = hard cut, sparingly | Main pipeline has NO decorative transitions (correct per §6.1); montage engine owns the flash/ramp palette for its arc type |
| Cross-cut montage, beat-aligned | Montage engine: beat-grid cuts, escalation/drop density (already beyond §5.2 for its niche) |
| Pace differs by content type | Mode profiles (clippies vs mindcuts lengths/zoom/preset) — crude but real |
| Speed ramps | Deliberately deferred (Remotion time-remap = audio desync risk — standing decision) |

### Genuine deltas from Part 3

18. **Internal tightening — THE Editor gap.** Clips are single contiguous spans today; no dead-air
    or filler removal, no `segments[]`, no src↔out time map. Adopt: silence-over-threshold +
    filler-token removal within the span → multi-segment extraction (ffmpeg trim+concat at
    extract time) → remap caption words/zoom times/broll windows onto the output timeline.
    Guardrails per spec: never remove the pause before the payoff (arc payoff span protected),
    `MIN_SEGMENT_S`, `MAX_INTERNAL_CUTS`, keep-breath margin. Depends on #13 (filler flags).
19. **Loudness normalization.** No LUFS targeting exists — clips ship at source loudness.
    ffmpeg `loudnorm` (two-pass) to a platform target + true-peak ceiling as a final export
    step + audit check. Cheap, immediately audible quality win.
20. **Stitch crossfades / time-compression dissolves.** Only meaningful once #18/#11 create
    internal boundaries; tiny audio crossfade (~60ms) at stitches; ≤200ms visual dissolve for
    large excisions. Lands with #18.
21. **Shared safe-area rect.** Captions and framing don't coordinate today (callouts avoid
    B-roll, nothing keeps faces clear of the caption band). One config rect consumed by caption
    layout (Part 3) AND crop solving (Part 4 §5.1) AND the audit.
22. **Caption cue constraints formalized.** Max chars/line, max lines, reading-speed floor
    (`dur ≥ chars/MAX_READING_CPS`), `MIN_CUE_S` anti-flash — as tested rules in the caption
    builder instead of preset-implicit behavior.
23. **Pace engine.** Per-clip `pace_target` from energy/word-rate/arc-type/sentiment mapping to
    tightening params (#18's knobs) — mode profiles become priors, pace becomes per-clip.

## Part 4 — Framing engine

### Already realized

| Part 4 concept | Existing equivalent |
|---|---|
| Active speaker is the subject | `pickActiveSpeaker` (mouth openness) + `buildActiveSpeakerTrack` |
| Never pan across a cut; per-shot re-solve | Scene-cut segmentation (built 2026-07-03 — the "ceiling shot" fix) |
| Center crop = logged last resort | `forcedCropTrack` ladder: active-speaker → single-face → center |
| Rule of thirds / headroom | `FACE_VERTICAL_POSITION` upper-third + edge-aware cropH shrink |
| Speaker-switch easing, jump hysteresis | `SWITCH_JUMP_FRACTION` + 0.5s eased transitions |
| Zoom anti-breathing | `applyZoomHysteresis` deadband on cropH |
| Crop ⊆ source bounds | `clampCropWindow` (property: enforced by construction) |
| Aspect-aware geometry | 9:16 / 3:4 crop windows (aspect flag, another session 2026-07-04) |

### Genuine deltas from Part 4

24. **Camera v2: deadband/lock-on + hold/move path planning.** Current smoothing is a
    continuous zero-lag EMA — the camera always micro-drifts with the subject. Spec's model
    (hold still inside a comfort box; move only when the target exits it; eased, velocity/
    accel/jerk-bounded moves; anti-overshoot; hold+move segments) produces the "locked, then
    glides" look. This is the single biggest visual-quality upgrade available to the framing
    engine. Property tests: containment, bounded jerk, no-pan-across-cut (all pure math).
25. **Subject-in-frame coverage gate.** The exact metric used ad hoc to debug the ceiling-shot
    bug (93% face-in-window) becomes a formal audit gate with `SUBJECT_IN_FRAME_FRAC` +
    `QUALITY_SUBJECT_OUT_OF_FRAME`.
26. **Caption-zone avoidance** — crop solver biases vertical placement so faces stay clear of
    the caption band (needs #21's shared rect).
27. **Look-room from gaze/orientation** — face-api landmarks exist; bias horizontal placement
    toward facing direction. Nice-to-have, low priority.
28. **Duo/stacked layout** — REMAINS DEFERRED (user-accepted "5% case" decision stands unless
    re-prioritized). The §4.3 "cut-between speakers" alternative needs #18's segments; note as
    a consolidation-phase decision.
29. **Time-based subject-switch hysteresis** (`SUBJECT_SWITCH_MIN_S` challenger-sustain) — small
    upgrade over the current jump-distance-only rule; kills ping-pong on rapid banter.

## Part 5 — Quality gates, render, analytics & RL

### Already realized

| Part 5 concept | Existing equivalent |
|---|---|
| Narrative completeness gate | Arc engine strict 6/6 gate (harder than hook+payoff) |
| "Return zero clips rather than lower the bar" | Arc gate + retention floor behavior (verified live) |
| Auto-fix only what's safe | AVSS regulator (clamps density/intensity/coverage, logs violations) |
| Degraded exports labeled, never silent | `--lenient` arc labels, `below_retention/` segregation, blur fallbacks |
| Audience simulator: rank/advise, trained on real data | AVSS simulator + predicted-retention badge; retention floor SEGREGATES but never blocks render — compatible with the "never gates export" constraint in spirit; floor is user-mandated and stays |
| Bandit over interpretable params, never opaque scorer | AVSS policy (discrete arms) + Channel Intelligence design (EMA, views floor, confidence, negative templates) |
| Versioned, reversible promotions | Policy version counter; elite templates versioned; CI design adds confidence + replacement rules |
| Offline-only learning isolation | `stats` is a separate command; pipeline only READS policy/templates — isolation already structural |
| Render makes no creative decisions | Remotion consumes props verbatim; zoomTimes single-source move reinforced this |

### Genuine deltas from Part 5

30. **Unified pre-export audit.** Today's gates are scattered (arc in all.ts, regulator in avss,
    floor at export). One `src/quality/audit.ts` running the checklist per clip — narrative ✓
    (exists), cut integrity (new, with #18), framing coverage (#25), caption constraints (#22),
    audio loudness (#19), duration/format — writing `quality` into clip.json + the run report.
    The A.4 checklist becomes the audit's output structure.
31. **Promotion guardrails.** Spec's holdout evaluation is impractical at this channel's data
    volume (honest divergence — n is tiny); adopt the practical subset: bounded step size (CI
    design's 0.3 EMA), per-arm clamps, views floor (CI design), and version-recorded
    promotions. Revisit holdout when uploads/week justifies it.
32. **Render determinism test.** Persist the exact per-clip render props (= our EDL, delta #2)
    and add a golden round-trip test: re-render from persisted EDL ⇒ identical decisions,
    visual diff within tolerance.

## Part 6 — Integrations, scaffold, roadmap, acceptance tests

- **Integration matrix → Node equivalents** (engines already import capabilities, not libs):
  Transcriber = json3/whisper-cpp (word timestamps ✓); Diarizer = OPEN (Part 1 delta #4 —
  sherpa-onnx / tinydiarize candidates); SceneDetector = ffmpeg scene-score (`sceneCuts.ts`);
  Detector/Landmarks = @vladmandic/face-api (faces only — YOLO-class general detection stays
  deferred unless a concrete need emerges); Tracker = `associateTracks`; Segmenter (SAM2) =
  NOT adopted (GPU, low marginal value for talking-head content); AudioAnalyzer = ffmpeg
  RMS/silence (laughter/VAD = delta #15, Silero/YAMNet via onnxruntime-node is the candidate);
  Embedder = NOT adopted as a model — the LLM semantic pass covers topic/novelty (#10);
  LLMAssist = Claude→Gemini ladder ✓ (with no-key degradation).
- **Repo scaffold** → not adopted (Part 1 decision). New homes: `src/quality/`, `src/report/`.
- **`docs/DEPENDENCIES.md`** → adopt (small task: list deps + licenses + model files).
- **Phased roadmap** → superseded by the consolidated slices below (our Phases 0–3 largely
  exist already).
- **Acceptance tests** → adopt an adapted subset as the standing E2E bar:
  AT-2 (no mid-word cuts), AT-3 (framing integrity), AT-4 (arc completeness), AT-5 (caption
  fidelity), AT-6 (audio), AT-8 (quality over quantity), AT-9 (explainability via run report),
  AT-12 (golden stability). AT-1 scoped to decision-identity (Remotion encode is not
  bit-exact). AT-7 scoped to the ladders we actually have. AT-10 already structural.
  AT-11 folds into golden/contract tests.

---

# Consolidated upgrade roadmap (all six parts)

Numbered deltas above; grouped into slices, dependency-ordered. Each slice = one
design→plan→build cycle on `slice-1`, gated by the standing test/build gates, system stays
live throughout.

**Slice A — Audit & report backbone** *(foundation; everything else hooks into it)* — ✅ BUILT 2026-07-06 (plan `2026-07-06-v4-slice-a-audit-backbone.md`, 13 tasks, commits through 7e936c9→smoke).
Reason-code enum + per-run `run_report.json` (#1 ✅); EDL persisted per clip `clip_NNN_edl.json` (#2 ✅); loudness
normalization to -14 LUFS + audio gate (#19 ✅); caption cue constraints `buildCaptionCues` (#22 ✅) + shared safe-area rect (#21 ✅ — rect defined + consumed by caption gate; crop-solver caption-avoidance #26 still Slice D);
subject-in-frame gate (#25 ✅); unified audit module `src/quality/audit.ts` (#30 ✅ — ADVISORY in Slice A: records, does not block); golden decision test (#3 ✅) + EDL round-trip (#32 ✅, decision-identity);
`DEPENDENCIES.md` ✅. New pkgs `src/report/` + `src/quality/` + `src/audio/loudness.ts`. Audit is advisory — flip to hard-gating in a later slice once gates are trustworthy. cut-integrity gate trivially-passes until Slice C's segments exist. → After A: no silent degradation, every clip carries a `quality` block + EDL, decision drift fails CI. 670 tests.

**Slice B — Director quality** *(better selection = fewer wasted renders)* — ✅ BUILT 2026-07-06 (plan `2026-07-06-v4-slice-b-director-quality.md`, 7 tasks, commits through c097edd→smoke).
Visual-feasibility feature filling the dead `visual_score` (#12 ✅ — `src/director/visualFeasibility.ts`: face presence + shot stability; sampled on arc survivors via a cheap windowed `detectFrameObs` at ~0.2fps; `visual_score` now 0-10, was hardcoded 0); topic segmentation via the
existing semantic pass (#10 ✅ — `SemanticWindow.topic` label + `topicOf`) + diversity-penalized selection (#10 ✅ — `src/director/selectDiverse.ts` greedy composite + VISUAL_SELECT_WEIGHT·visual − DIVERSITY_LAMBDA·topic/source redundancy; REPLACED the arc-gate's pure composite `survivors.sort`); filler detection (#13 ✅ — `src/analysis/filler.ts` lexicon+ratio, FILLER_PENALTY_WEIGHT on the ranker sort key, composite untouched); feature explanations (#17 ✅ — `selection.why` block in clip.json via `buildSelectionWhy`).
DEFERRED within B (documented): #9 Timeline facade (pure refactor, not behavioral), #14 sentiment swing (further prompt extension, low value now). 696 tests.

**Slice C — Editor tightening** *(pacing = retention)* — ✅ BUILT 2026-07-06 (plan `2026-07-06-v4-slice-c-editor-tightening.md`, 7 tasks, commits through af77285→smoke).
Internal cuts: dead-air + safe-filler removal, segments + src↔out map, caption/zoom/broll remap
(#18 ✅ — `src/editor/timeMap.ts` property-tested TimeMap, `tighten.ts` planTighten protects hook/payoff + fail-soft to identity, `clipExtractor.buildSegmentedExtractArgs` select/aselect concat; all.ts remaps renderWords/zoomOut/overlays/thumbnail to the output timeline; EDL `segments` = kept spans); pace engine (#23 ✅ — `src/editor/pace.ts` paceTarget→paceToTighten); cut-integrity gate now REAL (#30 completed — `cutIntegrityGate`, 6th audit gate). `--no-tighten` flag. DEFERRED: #20 stitch crossfades (smoke-gated — cutting at silence edges minimizes clicks; add acrossfade only if the smoke reveals audible joins). AVSS/framing run pre-cut, tightening applied as a render-time remap (documented). Smoke on H14bBuluwB8 found + fixed two bugs (silence times ≠ word times → `snapOutOfWords` keeps cuts in word gaps; duration gate now uses post-cut `totalOut`); post-fix audit passes 1/1, a forced two-segment extract stays A/V-synced (16.1s = 8+8). Cuts land in low-energy word gaps so click risk is low; a final human listen is still recommended (unit tests can't hear). 730 tests.

**Slice D — Camera v2** *(the "locked then glides" look)* — ✅ BUILT 2026-07-06 (plan `2026-07-06-v4-slice-d-camera-v2.md`, 4 tasks, commits through f252a2e→smoke).
Deadband/lock-on + bounded eased glide + anti-overshoot (#24 ✅ — `src/extraction/camera.ts` `lockOnPath` + `smoothCameraAxis` = EMA-denoise → lock-on; replaced the continuous cx/cy EMA in `smoothTrack` + `buildActiveSpeakerTrack`; cropH keeps zoom hysteresis); the deadband comfort box subsumes time-based switch hysteresis (#29 ✅) for micro-jitter, the existing jump-distance switch easing handles real speaker changes. Smoke-verified: continuous single-shot clip holds 92% of samples with max within-shot step ≤ the velocity bound; cut-heavy footage snaps per shot (never pans across a cut). DEFERRED: #26 caption-zone avoidance (needs the safe-area rect wired into the crop solver), #27 look-room from gaze (low value). 739 tests.

**Slice E — Composite candidates** *(Q&A / setup-punchline arcs)* — ✅ BUILT 2026-07-06 (plan `2026-07-06-v4-slice-e-composite-candidates.md`, 4 tasks, commits through T3).
Arc-template functions over segments (#11 ✅ — `src/director/arcTemplates.ts`: `isQuestion` + `detectQaCandidates` (question '?'/interrogative opener → answer span), `detectReactionCandidates` (Tier-1 trigger → setup+tail), `spanComposite` (windowScorer-fallback shape + template bonus), `mergeTemplateCandidates` dedup ≥50% vs pool mirroring the arc miner). Wired into `analyzeVideo` after arc mining; flows through the UNCHANGED rank → 6/6 gate → select → tighten → render path. Verified: 8 Q&A candidates generated on H14bBuluwB8 anchored to question boundaries; merge+dedup + pipeline flow tested; exported clip passes all 6 audit gates. **DEFERRED (documented):** the spec's explicit non-contiguous `node_path` + `Stitcher` + `RESPONDS_TO`/`SAME_TOPIC` graph — a composite is a contiguous outer span whose mid-clip aside is excised by Slice C tightening (covers the common Q→A-with-aside case without the contiguous-clip-model rewrite); true speaker-turn Q&A pairing waits on Slice F diarization. 749 tests.

**ALL 5 v4 slices (A–E) COMPLETE.** Remaining v4 work is only Slice F capability decisions (each gated).

**Slice F — Capability decisions** *(each needs its own go/no-go)*
Diarization + global voice-to-face binding (#4/#16 — pick sherpa-onnx vs tinydiarize, Mac
benchmark first); laughter/applause detection (#15 — ONNX classifier benchmark); duo layout
(#28 — user decision to un-defer); structured JSON logs (#7); config run-hash (#6).

Recommended order: **A → B → C → D → E**, F items slotted when their decision gates clear.
Rationale: A gives the measurement backbone (and is cheap); B stops bad clips at selection
(the user's observed pain: weak/incoherent picks and framing-hostile moments); C is the
largest retention lever (dead air is the #1 amateur tell); D is the largest visual-polish
lever; E expands what's clippable at all.
