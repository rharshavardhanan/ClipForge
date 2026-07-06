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

## Part 2 — Director engine *(pending — paste to fill in)*

## Part 3 — Editor engine *(pending)*

## Part 4 — Framing engine *(pending)*

## Part 5 — Analytics, RL, template evolution, audience simulation, quality gates *(pending)*

## Part 6 — Integration matrix, scaffold, roadmap, acceptance tests *(pending)*
