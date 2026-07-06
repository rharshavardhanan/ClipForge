# ClipForge Hybrid Perception Architecture — Design

**Date:** 2026-07-06 · **Status:** Approved (brainstorm) · **Supersedes:** the no-Python mandate (explicit user decision, 2026-07-06)

## 0. Why this exists

The five v4 slices (A–E) upgraded ClipForge's editing/quality layers on the pure-TS stack. The
remaining ceiling is **understanding**: the Director reasons mostly from the transcript + shallow
audio/face signals. To produce top-tier Shorts it needs a deep multimodal understanding of the
video. The user's decision (2026-07-06): add a **Python AI Perception microservice** and a
**Node "Understanding" layer** so the system produces *understanding*, not just *data*.

**Governing correction (the design's core idea):** perception (models over pixels/audio) is
Python; **reasoning over facts is the LLM already in Node**. So:

- **Python = perception**: media → raw multimodal facts (the Semantic Timeline). Never reasons.
- **Node = orchestration + LLM reasoning (Understanding) + editing/render**. Never imports a
  local model (an LLM API call is not a local model).

This keeps a clean seam and means the Understanding layers **evolve existing Node components**
(arc engine, mode system, elite templates, Camera v2), not a second brain.

## 1. North-star pipeline

```
Video
 └─▶ [Python Perception service]  → semantic_timeline.json   (cached per source)
       raw facts: speakers·audio_events·scenes/embeddings·[vision: tracks/objects/depth/vlm]
       └─▶ [Node Understanding — LLM + heuristics over timeline + transcript]
              → Scene Graph      coherent scenes {span, participants, goal, events, emotion, importance}
              → Story Graph      narrative edges (setup→escalation→payoff→reaction)   ← evolves arc engine
              → Importance curve per-second 0–1
              → Content type     interview|challenge|gaming|debate|story|transformation|
                                 reaction|ranking|compilation|tutorial|comedy|workout → editing policy
              → Creator/template match                                                ← evolves elite templates
            └─▶ [Director]   moment/clip selection over Story Graph + importance       ← evolves ranker/arc-gate/selectDiverse
                  └─▶ [Camera Planner]  timeline speakers/tracks → camera path          ← elevates Slice D lock-on
                        └─▶ [Editor]  tighten/stitch/captions/sfx/music                 ← Slice C + existing
                              └─▶ [Quality Auditor]  ← Slice A audit
                                    └─▶ [Render (Remotion) → Export]
```

### 1.1 Existing components each layer evolves (not greenfield)

| North-star layer | Evolves |
|---|---|
| Story Graph | Arc engine (hook/setup/tension/climax/payoff/reaction + bounds already exist) |
| Content-type classification | Mode system (clippies/mindcuts → ~12 types, each a policy) |
| Creator/template memory | AVSS elite templates + approved Channel-Intelligence design |
| Camera Planner | Slice D lock-on (elevated from inside framing to its own stage) |
| Director | ranker + 6/6 arc gate + selectDiverse |
| Editor / Auditor | Slice C tightening / Slice A audit |

## 2. Decomposition (each sub-project = its own spec → plan → build)

- **SP1 — Perception service + Semantic Timeline** *(foundation; everything downstream needs it)* — **build first.**
- **SP2 — Understanding layer** (Scene Graph, Story Graph, Importance curve; Node/LLM, evolving the arc engine) — *the "understanding not data" payoff.*
- **SP3 — Content-type classification + per-type editing policies** (extends mode system).
- **SP4 — Camera Planner** as a first-class stage (elevates Slice D, consumes diarized speaker turns).
- **SP5 — Creator/template memory** (extends AVSS elite templates + Channel Intelligence).

SP2–SP5 depend on SP1's timeline. This spec covers the **north-star (all of §1)** at architecture
level and **SP1 in build detail (§3–§8)**. SP2–SP5 get their own specs when reached.

---

# SP1 — Perception service + Semantic Timeline (build-detail)

## 3. Hardware reality → Phase-1 model scope

Target hardware: the user's **Apple-Silicon Mac (no CUDA, thermally throttles)**. Perception is a
**once-per-source, cached** pass (like existing workspace stage-caching): a slow first analysis is
tolerable because every re-run/re-edit is instant off the cache.

- **Phase-1 producers (Mac-runnable, cached):** **PyAnnote** (diarization — speaker turns),
  **YAMNet** (audio events: laughter/applause/cheer/impact), **CLIP** (per-scene frame embeddings
  → scene/topic labels + novelty).
- **Optional:** **WhisperX** — only the local-file / no-captions path (YouTube json3 captions
  already give word timings). Off by default.
- **Schema-reserved, GPU-gated (later phases, absent until a GPU box exists — no Node change to
  enable):** YOLO11 + ByteTrack (person/object tracks), SAM2 (masks), MediaPipe (pose upgrade),
  GroundingDINO, DepthAnything, **Qwen2.5-VL** (rich scene captions — the eventual CLIP upgrade:
  "Speed challenges Brady to a vertical jump while the crowd laughs").

## 4. The Semantic Timeline (the contract / hinge)

One versioned JSON per source at `workspace/perception/<jobId>/semantic_timeline.json`.
**Layered** — each producer fills its own layer; a missing producer leaves its layer empty and the
Node consumer degrades. Shared definition in three synced forms: a JSON-schema (source of truth),
Node TS types (`src/perception/timeline.ts`), Python dataclasses (`perception/clipforge_perception/schema.py`).

```jsonc
{
  "schema_version": 1,
  "job_id": "…", "duration": 372.4, "sample_fps": 2,
  "producers_run": ["mock"],            // or ["pyannote","yamnet","clip"]
  "speakers":     [{ "id": "S0", "turns": [{ "start": 12.1, "end": 18.7 }] }],           // PyAnnote
  "audio_events": [{ "start": 40.2, "end": 42.9, "kind": "laughter", "score": 0.87 }],   // YAMNet
  "scenes":       [{ "start": 0, "end": 30, "label": "gym workout", "embedding_ref": "clip/0.f32" }], // CLIP
  // reserved, GPU-gated (omitted until those producers run):
  "tracks": [], "objects": [], "depth": [], "vlm_captions": []
}
```

`kind` enum: `laughter|applause|cheer|impact|music|speech|other`. Embeddings written as sidecar
binary files referenced by `embedding_ref` (never inlined). All times seconds, source-absolute.

## 5. Python perception service (`perception/`)

A self-contained Python package, its own venv, **never touched by Node except via the CLI**.

```
perception/
  pyproject.toml                 # deps pinned; console_script: clipforge-perception
  clipforge_perception/
    __init__.py
    cli.py                       # `clipforge-perception analyze <video> --out <json> --models a,b,c`
    schema.py                    # dataclasses mirroring the JSON-schema + validate()
    producers/
      base.py                    # Producer protocol: run(video, ctx) -> partial timeline layer
      mock.py                    # schema-valid timeline from cheap heuristics (Phase 1a)
      pyannote_diar.py           # (1b)
      yamnet_events.py           # (1c)
      clip_scenes.py             # (1d)
    pipeline.py                  # run selected producers, merge layers, validate, write JSON
  models/                        # downloaded weights (gitignored)
  tests/                         # pytest: each producer + schema validation
  README.md
```

- **CLI contract:** `clipforge-perception analyze <video> --out <path> --models pyannote,yamnet,clip
  [--sample-fps N]`. Exit 0 + valid JSON written = success; any producer that fails logs a
  structured warning, omits its layer, and the run still exits 0 with a valid (partial) timeline.
  Fatal errors (bad args, unreadable video) → non-zero exit + stderr message.
- **Setup:** `./start.sh perception-setup` creates the venv (`uv`/`pip`), installs deps, downloads
  models. PyAnnote needs a free **Hugging Face token** (`HF_TOKEN` in `.env`) — documented; absent
  → the pyannote producer is skipped with a clear message, not a crash.
- **Determinism:** producers seeded where stochastic; model versions pinned in `pyproject.toml` +
  recorded in `producers_run` metadata.

## 6. Node integration (`src/perception/`)

```
src/perception/
  timeline.ts            # TS types for the semantic timeline + a Zod-free runtime validator
  perceptionClient.ts    # interface PerceptionClient { analyze(video, jobId): Promise<SemanticTimeline | null> }
  subprocessClient.ts    # SubprocessPerceptionClient — spawns the CLI, caches, reads JSON
```

- **`SubprocessPerceptionClient.analyze`**: if `workspace/perception/<jobId>/semantic_timeline.json`
  exists and its `schema_version` matches → load + return (cache hit). Else spawn
  `clipforge-perception analyze …` (via the existing `run()` util, with a stall-watchdog like the
  Remotion renderer), read the written JSON, validate, cache, return. **Fail-soft: any error
  (no venv, CLI missing, timeout, invalid JSON) → log a `PERCEPTION_UNAVAILABLE` reason code and
  return `null`.**
- **Wiring (`analyzeVideo`):** after ingest/transcript, `const timeline = await client.analyze(videoPath, jobId)`.
  `timeline` (or null) is threaded into `VideoAnalysis`. Phase-1 consumers read it fail-soft:
  - diarization `speakers` → available for SP4 camera + SP2/Slice-E Q&A (Phase 1 just carries it);
  - `audio_events` → **Slice E reaction candidates** gain real laughter/applause anchors + the
    **AVSS dopamine model** gains real reaction events (wired in Phase 1d/e as a small follow-on);
  - `scenes` → **Slice B topic** gains a visual label (follow-on).
  Phase 1's bar is: the timeline is produced, cached, validated, and *carried* end-to-end; deep
  consumption is SP2. A `--no-perception` flag and auto-off when the venv is absent.

## 7. Error handling & degradation

Perception is **enrichment, never required** — with it off, ClipForge behaves exactly as today.
Reason codes (Slice A): `PERCEPTION_UNAVAILABLE` (no venv/CLI/timeout), `PERCEPTION_PRODUCER_FAILED`
(a producer errored; its layer omitted), surfaced in `run_report.json`. The throttling-Mac case:
a per-run stall-watchdog kills a hung pass → degrade, never hang.

## 8. Build order (contract-first) & testing

- **Phase 1a — Contract + skeleton (no heavy deps):** JSON-schema + TS types + Python dataclasses;
  Python CLI with the **mock producer** (schema-valid timeline from cheap heuristics using ffmpeg
  RMS/scene-cuts already available); `SubprocessPerceptionClient` + cache + `analyzeVideo` wiring +
  graceful-off; golden timeline fixture + schema-contract tests (Node consumer against the fixture,
  Python `validate()`); `perception-setup` scaffold + `DEPENDENCIES.md` entry. **Exit:** a real run
  produces a cached, schema-valid `semantic_timeline.json` (mock) end-to-end; pipeline unchanged
  when perception is off.
- **Phase 1b:** PyAnnote diarization producer (real speaker turns) + HF-token setup.
- **Phase 1c:** YAMNet audio-events producer + wire into Slice E reaction candidates + AVSS dopamine.
- **Phase 1d:** CLIP scene-embedding producer + wire into Slice B topic/novelty.
- Each phase: its own plan, benchmarked on the Mac as a cached pass, independently valuable.

**Testing:** Node — schema validator unit tests, consumer against a committed golden timeline,
cache hit/miss, fail-soft (missing CLI → null → pipeline runs). Python — `pytest` per producer
(mock + real) with output validated against the schema. Gates unchanged (vitest/tsc/next build);
Python tests run in their own lane (not required for the Node gates).

## 9. Deferrals (explicit)

WhisperX default-off (captions suffice); all heavy GPU producers (YOLO/ByteTrack/SAM2/MediaPipe-
upgrade/GroundingDINO/DepthAnything/Qwen2.5-VL) are schema-reserved but unbuilt until a GPU box
exists; SP2–SP5 (Understanding layer, classification, Camera Planner stage, creator memory) are
sequenced after SP1 with their own specs. gRPC/HTTP transport deferred behind the `PerceptionClient`
interface until perception moves off-Mac.
