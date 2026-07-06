# Perception SP1 — Phase 1a (Contract + Mock Producer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Python perception microservice + Node integration end-to-end with a *mock* producer, so a real run produces a cached, schema-valid `semantic_timeline.json` — and the pipeline behaves exactly as today when perception is off.

**Architecture:** A self-contained Python package (`perception/`) exposes a `clipforge-perception analyze` CLI that runs selected producers, merges their layers into one versioned JSON, validates it, and writes it to `--out`. Node (`src/perception/`) has a Zod-free type mirror + validator and a `SubprocessPerceptionClient` that caches per-`jobId`, spawns the CLI via the existing `run()` util (stall-watchdog), reads the written file, validates, and returns it — failing soft to `null` on any error. Phase 1a ships the **mock** producer (ffmpeg silencedetect + scene-cut heuristics → schema-valid speakers/audio_events/scenes); real pyannote/yamnet/clip producers are later phases with their own plans.

**Tech Stack:** TypeScript (Node 20+, ESM/NodeNext, vitest), Python 3.10+ (stdlib + `jsonschema`, pytest), ffmpeg/ffprobe (already required), commander CLI, existing `run()` subprocess util.

## Global Constraints

- **Clean seam:** Node never imports a local model and never reaches into `perception/` at *runtime* except by spawning the CLI. (Test-time reading of the committed golden fixture across directories is allowed and is the point — it is the shared contract anchor.)
- **Fail-soft, never required:** with perception off/unavailable the pipeline behaves exactly as today. Any client error → log a reason code, return `null`.
- **Never parse the CLI's stdout for the timeline** — the CLI writes JSON to `--out`; Node reads that file. (Repo gotcha: `run()` stdout corrupts binary and is unreliable for payloads.)
- **Schema is versioned:** `schema_version` is the const `1` this phase. The JSON-schema at `perception/clipforge_perception/schema/semantic_timeline.v1.schema.json` is the source of truth; the Node validator and Python dataclasses mirror it; the golden fixture `perception/fixtures/golden_timeline.json` is the single cross-language conformance anchor (both suites load it).
- **Reserved layers always present:** `tracks`, `objects`, `depth`, `vlm_captions` are emitted as `[]` when unfilled (not omitted).
- **Cache key includes producers:** a cache hit requires the cached `producers_run` to be a **superset of the requested `--models`**, else re-run. (Prevents a `mock`-only cache from short-circuiting a later real-producer run.)
- **Workspace dir:** `process.env.WORKSPACE_DIR ?? './workspace'` (mirror `all.ts:72`). Timeline path: `<ws>/perception/<jobId>/semantic_timeline.json`.
- **All times seconds, source-absolute, ≥ 0.** `audio_events[].kind` enum: `laughter|applause|cheer|impact|music|speech|other`. `score` ∈ [0,1].

---

## File Structure

**Python — `perception/` (its own package, own venv, Node touches it only via the CLI):**
- `perception/pyproject.toml` — package metadata, deps (`jsonschema`), `console_scripts: clipforge-perception`.
- `perception/clipforge_perception/__init__.py` — package marker + version.
- `perception/clipforge_perception/schema/semantic_timeline.v1.schema.json` — JSON-schema **source of truth**.
- `perception/clipforge_perception/schema.py` — dataclasses (typed Python mirror) + `load_schema()` + `validate(dict) -> list[str]` + `empty_timeline(...)` + dict helpers.
- `perception/clipforge_perception/producers/base.py` — `Producer` protocol + `Ctx` dataclass.
- `perception/clipforge_perception/producers/mock.py` — mock producer (ffmpeg heuristics → speakers/audio_events/scenes).
- `perception/clipforge_perception/ffmpeg.py` — thin ffprobe/ffmpeg-stderr helpers (duration, silence spans, scene cuts).
- `perception/clipforge_perception/pipeline.py` — run producers, merge, validate, write.
- `perception/clipforge_perception/cli.py` — argparse CLI `analyze`, exit codes.
- `perception/fixtures/golden_timeline.json` — shared golden fixture (also consumed by Node tests).
- `perception/tests/conftest.py` — pytest fixture: synthesize a tiny video via ffmpeg lavfi.
- `perception/tests/test_schema.py`, `test_mock_producer.py`, `test_cli.py`.
- `perception/README.md`, `perception/.gitignore` (`models/`, `.venv/`).

**Node — `src/perception/`:**
- `src/perception/timeline.ts` — TS types + `validateTimeline()` (Zod-free) + `SemanticTimeline`.
- `src/perception/perceptionClient.ts` — `PerceptionClient` interface + `resolvePerception()` wiring helper.
- `src/perception/subprocessClient.ts` — `SubprocessPerceptionClient` (cache, spawn, fail-soft).

**Node — modified:**
- `src/report/reasonCodes.ts` — add `PERCEPTION_UNAVAILABLE`, `PERCEPTION_PRODUCER_FAILED`.
- `src/types/index.ts` — add `perception?: SemanticTimeline | null` to `VideoAnalysis`.
- `src/cli/commands/all.ts` — wire `resolvePerception()` into `analyzeVideo`; add `perception?: boolean` to `AllOpts`.
- `src/cli/index.ts` — add `--no-perception` flag.
- `start.sh` — add `perception-setup` subcommand branch.
- `docs/DEPENDENCIES.md` — add perception-service entry.

**Node — tests:**
- `tests/perception/timeline.test.ts`, `tests/perception/subprocessClient.test.ts`, `tests/perception/resolvePerception.test.ts`.

---

## Task 1: Node timeline contract — types, validator, golden fixture

**Files:**
- Create: `src/perception/timeline.ts`
- Create: `perception/fixtures/golden_timeline.json`
- Test: `tests/perception/timeline.test.ts`

**Interfaces:**
- Produces: `SemanticTimeline` (interface), `AudioEventKind` (type), `TIMELINE_SCHEMA_VERSION` (const `1`), `validateTimeline(obj: unknown): { ok: true; timeline: SemanticTimeline } | { ok: false; errors: string[] }`.
- Produces: `perception/fixtures/golden_timeline.json` — a valid timeline consumed by both Node and Python tests.

- [ ] **Step 1: Write the golden fixture**

Create `perception/fixtures/golden_timeline.json`:

```json
{
  "schema_version": 1,
  "job_id": "golden-fixture",
  "duration": 60.0,
  "sample_fps": 2,
  "producers_run": ["mock"],
  "speakers": [
    { "id": "S0", "turns": [ { "start": 0.5, "end": 12.3 }, { "start": 20.0, "end": 34.5 } ] },
    { "id": "S1", "turns": [ { "start": 12.3, "end": 20.0 } ] }
  ],
  "audio_events": [
    { "start": 0.5, "end": 12.3, "kind": "speech", "score": 1.0 },
    { "start": 18.0, "end": 19.5, "kind": "laughter", "score": 0.82 }
  ],
  "scenes": [
    { "start": 0.0, "end": 30.0, "label": "intro" },
    { "start": 30.0, "end": 60.0, "label": "demo", "embedding_ref": "clip/1.f32" }
  ],
  "tracks": [],
  "objects": [],
  "depth": [],
  "vlm_captions": []
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/perception/timeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTimeline, TIMELINE_SCHEMA_VERSION } from '../../src/perception/timeline.js';

const GOLDEN = join(__dirname, '../../perception/fixtures/golden_timeline.json');
function golden(): Record<string, unknown> {
  return JSON.parse(readFileSync(GOLDEN, 'utf8'));
}

describe('validateTimeline', () => {
  it('accepts the golden fixture and returns a typed timeline', () => {
    const res = validateTimeline(golden());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.timeline.schema_version).toBe(TIMELINE_SCHEMA_VERSION);
      expect(res.timeline.speakers.length).toBe(2);
      expect(res.timeline.audio_events[1].kind).toBe('laughter');
      expect(res.timeline.tracks).toEqual([]);
    }
  });

  it('rejects a wrong schema_version', () => {
    const res = validateTimeline({ ...golden(), schema_version: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/schema_version/);
  });

  it('rejects an out-of-enum audio_event kind', () => {
    const bad = golden();
    (bad.audio_events as { kind: string }[])[0].kind = 'giggle';
    const res = validateTimeline(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/kind/);
  });

  it('rejects a negative time', () => {
    const bad = golden();
    (bad.scenes as { start: number }[])[0].start = -1;
    expect(validateTimeline(bad).ok).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validateTimeline(null).ok).toBe(false);
    expect(validateTimeline('x').ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/perception/timeline.test.ts`
Expected: FAIL — cannot resolve `../../src/perception/timeline.js` (module not found).

- [ ] **Step 4: Write the implementation**

Create `src/perception/timeline.ts`:

```ts
/**
 * Semantic Timeline — the Node type mirror + Zod-free runtime validator for the perception
 * contract. Source of truth is the JSON-schema in the Python package; this mirrors it and the
 * golden fixture (perception/fixtures/golden_timeline.json) is the shared conformance anchor.
 */
export const TIMELINE_SCHEMA_VERSION = 1 as const;

export const AUDIO_EVENT_KINDS = [
  'laughter', 'applause', 'cheer', 'impact', 'music', 'speech', 'other',
] as const;
export type AudioEventKind = (typeof AUDIO_EVENT_KINDS)[number];

export interface TimelineSpan { start: number; end: number; }
export interface TimelineSpeaker { id: string; turns: TimelineSpan[]; }
export interface AudioEvent { start: number; end: number; kind: AudioEventKind; score: number; }
export interface TimelineScene { start: number; end: number; label: string; embedding_ref?: string; }

export interface SemanticTimeline {
  schema_version: typeof TIMELINE_SCHEMA_VERSION;
  job_id: string;
  duration: number;
  sample_fps: number;
  producers_run: string[];
  speakers: TimelineSpeaker[];
  audio_events: AudioEvent[];
  scenes: TimelineScene[];
  // reserved, GPU-gated layers — always present, empty until those producers run:
  tracks: unknown[];
  objects: unknown[];
  depth: unknown[];
  vlm_captions: unknown[];
}

export type ValidateResult =
  | { ok: true; timeline: SemanticTimeline }
  | { ok: false; errors: string[] };

const KIND_SET = new Set<string>(AUDIO_EVENT_KINDS);
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validateTimeline(obj: unknown): ValidateResult {
  const e: string[] = [];
  if (!isRec(obj)) return { ok: false, errors: ['timeline is not an object'] };

  if (obj.schema_version !== TIMELINE_SCHEMA_VERSION) {
    e.push(`schema_version must be ${TIMELINE_SCHEMA_VERSION}, got ${String(obj.schema_version)}`);
  }
  if (typeof obj.job_id !== 'string' || obj.job_id.length === 0) e.push('job_id must be a non-empty string');
  if (!isTime(obj.duration)) e.push('duration must be a finite number >= 0');
  if (typeof obj.sample_fps !== 'number' || !(obj.sample_fps > 0)) e.push('sample_fps must be a number > 0');
  if (!Array.isArray(obj.producers_run) || !obj.producers_run.every((p) => typeof p === 'string')) {
    e.push('producers_run must be an array of strings');
  }

  if (!Array.isArray(obj.speakers)) e.push('speakers must be an array');
  else obj.speakers.forEach((s, i) => {
    if (!isRec(s) || typeof s.id !== 'string' || s.id.length === 0) e.push(`speakers[${i}].id must be a non-empty string`);
    else if (!Array.isArray(s.turns) || !s.turns.every((t) => isRec(t) && isTime(t.start) && isTime(t.end))) {
      e.push(`speakers[${i}].turns must be spans with numeric start/end >= 0`);
    }
  });

  if (!Array.isArray(obj.audio_events)) e.push('audio_events must be an array');
  else obj.audio_events.forEach((a, i) => {
    if (!isRec(a) || !isTime(a.start) || !isTime(a.end)) e.push(`audio_events[${i}] needs numeric start/end >= 0`);
    else {
      if (!KIND_SET.has(a.kind as string)) e.push(`audio_events[${i}].kind '${String(a.kind)}' not in enum`);
      if (typeof a.score !== 'number' || a.score < 0 || a.score > 1) e.push(`audio_events[${i}].score must be in [0,1]`);
    }
  });

  if (!Array.isArray(obj.scenes)) e.push('scenes must be an array');
  else obj.scenes.forEach((s, i) => {
    if (!isRec(s) || !isTime(s.start) || !isTime(s.end)) e.push(`scenes[${i}] needs numeric start/end >= 0`);
    else if (typeof s.label !== 'string') e.push(`scenes[${i}].label must be a string`);
  });

  for (const k of ['tracks', 'objects', 'depth', 'vlm_captions'] as const) {
    if (!Array.isArray(obj[k])) e.push(`${k} must be an array`);
  }

  return e.length === 0 ? { ok: true, timeline: obj as unknown as SemanticTimeline } : { ok: false, errors: e };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/perception/timeline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/perception/timeline.ts perception/fixtures/golden_timeline.json tests/perception/timeline.test.ts
git commit -m "feat(perception): semantic-timeline TS contract + validator + golden fixture (SP1 1a)"
```

---

## Task 2: Python package + JSON-schema + validate() (contract parity)

**Files:**
- Create: `perception/pyproject.toml`
- Create: `perception/clipforge_perception/__init__.py`
- Create: `perception/clipforge_perception/schema/semantic_timeline.v1.schema.json`
- Create: `perception/clipforge_perception/schema.py`
- Create: `perception/tests/test_schema.py`
- Create: `perception/.gitignore`

**Interfaces:**
- Consumes: `perception/fixtures/golden_timeline.json` (from Task 1).
- Produces: `schema.load_schema() -> dict`; `schema.validate(obj: dict) -> list[str]` (empty = valid); dataclasses `Span, Speaker, AudioEvent, Scene`; `schema.empty_timeline(job_id, duration, sample_fps) -> dict`; `schema.scene_to_dict/speaker_to_dict/event_to_dict`.

- [ ] **Step 1: Write pyproject, package marker, .gitignore**

Create `perception/pyproject.toml`:

```toml
[project]
name = "clipforge-perception"
version = "0.1.0"
description = "ClipForge AI perception microservice — media to semantic-timeline facts (never reasoning)."
requires-python = ">=3.10"
dependencies = ["jsonschema>=4.0"]

[project.optional-dependencies]
dev = ["pytest>=7.0"]

[project.scripts]
clipforge-perception = "clipforge_perception.cli:main"

[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["clipforge_perception*"]

[tool.setuptools.package-data]
clipforge_perception = ["schema/*.json"]
```

Create `perception/clipforge_perception/__init__.py`:

```python
"""ClipForge perception microservice — media to semantic-timeline facts."""

__version__ = "0.1.0"
```

Create `perception/.gitignore`:

```gitignore
.venv/
models/
__pycache__/
*.egg-info/
.pytest_cache/
```

- [ ] **Step 2: Write the JSON-schema (source of truth)**

Create `perception/clipforge_perception/schema/semantic_timeline.v1.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "clipforge:semantic_timeline:v1",
  "title": "ClipForge Semantic Timeline",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "job_id", "duration", "sample_fps", "producers_run",
    "speakers", "audio_events", "scenes", "tracks", "objects", "depth", "vlm_captions"],
  "properties": {
    "schema_version": { "const": 1 },
    "job_id": { "type": "string", "minLength": 1 },
    "duration": { "type": "number", "minimum": 0 },
    "sample_fps": { "type": "number", "exclusiveMinimum": 0 },
    "producers_run": { "type": "array", "items": { "type": "string" } },
    "speakers": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["id", "turns"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "turns": { "type": "array", "items": { "$ref": "#/$defs/span" } }
        }
      }
    },
    "audio_events": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["start", "end", "kind", "score"],
        "properties": {
          "start": { "type": "number", "minimum": 0 },
          "end": { "type": "number", "minimum": 0 },
          "kind": { "enum": ["laughter", "applause", "cheer", "impact", "music", "speech", "other"] },
          "score": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "scenes": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["start", "end", "label"],
        "properties": {
          "start": { "type": "number", "minimum": 0 },
          "end": { "type": "number", "minimum": 0 },
          "label": { "type": "string" },
          "embedding_ref": { "type": "string" }
        }
      }
    },
    "tracks": { "type": "array" },
    "objects": { "type": "array" },
    "depth": { "type": "array" },
    "vlm_captions": { "type": "array" }
  },
  "$defs": {
    "span": {
      "type": "object", "additionalProperties": false,
      "required": ["start", "end"],
      "properties": {
        "start": { "type": "number", "minimum": 0 },
        "end": { "type": "number", "minimum": 0 }
      }
    }
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `perception/tests/test_schema.py`:

```python
import copy
import json
from pathlib import Path

from clipforge_perception import schema

GOLDEN = Path(__file__).resolve().parents[1] / "fixtures" / "golden_timeline.json"


def golden() -> dict:
    return json.loads(GOLDEN.read_text())


def test_golden_fixture_is_valid():
    assert schema.validate(golden()) == []


def test_rejects_wrong_schema_version():
    bad = golden()
    bad["schema_version"] = 2
    errs = schema.validate(bad)
    assert errs and any("schema_version" in e or "const" in e for e in errs)


def test_rejects_out_of_enum_kind():
    bad = golden()
    bad["audio_events"][0]["kind"] = "giggle"
    assert schema.validate(bad)


def test_rejects_negative_time():
    bad = golden()
    bad["scenes"][0]["start"] = -1
    assert schema.validate(bad)


def test_empty_timeline_is_valid():
    t = schema.empty_timeline("job-x", 42.0, 2)
    assert schema.validate(t) == []
    assert t["tracks"] == [] and t["producers_run"] == []
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd perception && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" >/dev/null && .venv/bin/pytest tests/test_schema.py -q`
Expected: FAIL — `ModuleNotFoundError` / `AttributeError: module 'clipforge_perception.schema' has no attribute 'validate'`.

- [ ] **Step 5: Write the implementation**

Create `perception/clipforge_perception/schema.py`:

```python
"""Semantic-timeline schema: JSON-schema loader, validator, and typed dataclass mirror."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from importlib import resources
from typing import Optional

import jsonschema

SCHEMA_VERSION = 1


@lru_cache(maxsize=1)
def load_schema() -> dict:
    with resources.files("clipforge_perception.schema").joinpath(
        "semantic_timeline.v1.schema.json"
    ).open("r") as fh:
        return json.load(fh)


def validate(obj: dict) -> list[str]:
    """Return a list of human-readable errors; empty list means valid."""
    validator = jsonschema.Draft202012Validator(load_schema())
    return [
        f"{'/'.join(str(p) for p in err.path) or '<root>'}: {err.message}"
        for err in sorted(validator.iter_errors(obj), key=lambda e: list(e.path))
    ]


# --- typed dataclass mirror (built by producers, serialized to plain dicts) ---

@dataclass
class Span:
    start: float
    end: float


@dataclass
class Speaker:
    id: str
    turns: list[Span] = field(default_factory=list)


@dataclass
class AudioEvent:
    start: float
    end: float
    kind: str
    score: float


@dataclass
class Scene:
    start: float
    end: float
    label: str
    embedding_ref: Optional[str] = None


def scene_to_dict(s: Scene) -> dict:
    d = asdict(s)
    if d.get("embedding_ref") is None:
        d.pop("embedding_ref", None)  # optional; omit rather than emit null
    return d


def speaker_to_dict(s: Speaker) -> dict:
    return {"id": s.id, "turns": [asdict(t) for t in s.turns]}


def event_to_dict(e: AudioEvent) -> dict:
    return asdict(e)


def empty_timeline(job_id: str, duration: float, sample_fps: float) -> dict:
    """A schema-valid timeline with every layer empty (the merge starting point)."""
    return {
        "schema_version": SCHEMA_VERSION,
        "job_id": job_id,
        "duration": float(duration),
        "sample_fps": float(sample_fps),
        "producers_run": [],
        "speakers": [],
        "audio_events": [],
        "scenes": [],
        "tracks": [],
        "objects": [],
        "depth": [],
        "vlm_captions": [],
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd perception && .venv/bin/pytest tests/test_schema.py -q`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add perception/pyproject.toml perception/clipforge_perception/__init__.py \
  perception/clipforge_perception/schema perception/clipforge_perception/schema.py \
  perception/tests/test_schema.py perception/.gitignore
git commit -m "feat(perception): python package + JSON-schema source-of-truth + validate() (SP1 1a)"
```

---

## Task 3: Mock producer + pipeline + CLI

**Files:**
- Create: `perception/clipforge_perception/ffmpeg.py`
- Create: `perception/clipforge_perception/producers/base.py`
- Create: `perception/clipforge_perception/producers/mock.py`
- Create: `perception/clipforge_perception/producers/__init__.py`
- Create: `perception/clipforge_perception/pipeline.py`
- Create: `perception/clipforge_perception/cli.py`
- Create: `perception/tests/conftest.py`
- Create: `perception/tests/test_mock_producer.py`
- Create: `perception/tests/test_cli.py`

**Interfaces:**
- Consumes: `schema.empty_timeline`, `schema.validate`, dataclasses + `*_to_dict` (Task 2).
- Produces: `producers.base.Ctx(duration, sample_fps)`; `producers.base.Producer` protocol; `producers.mock.MockProducer` with `.name = "mock"` and `.run(video: str, ctx: Ctx) -> dict` (partial layer dict); `pipeline.analyze(video, out, models, sample_fps, job_id) -> int` (exit code); `cli.main() -> None` (argparse entry, calls `sys.exit`).
- CLI contract: `clipforge-perception analyze <video> --out <path> --models a,b,c [--sample-fps N] [--job-id ID]`.

- [ ] **Step 1: Write ffmpeg helpers**

Create `perception/clipforge_perception/ffmpeg.py`:

```python
"""Thin ffprobe/ffmpeg helpers. We shell out and parse stderr — no python media deps."""

from __future__ import annotations

import re
import subprocess


def probe_duration(video: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", video],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def silence_spans(video: str, noise_db: int = -30, min_silence: float = 0.5) -> list[tuple[float, float]]:
    """Return (start, end) silence regions from ffmpeg silencedetect."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", video,
         "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    spans: list[tuple[float, float]] = []
    start: float | None = None
    for line in proc.stderr.splitlines():
        m = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m:
            start = float(m.group(1))
            continue
        m = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m and start is not None:
            spans.append((start, float(m.group(1))))
            start = None
    return spans


def scene_cut_times(video: str, threshold: float = 0.3) -> list[float]:
    """Return timestamps (s) of detected scene cuts via ffmpeg select+showinfo."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", video,
         "-filter:v", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    times: list[float] = []
    for line in proc.stderr.splitlines():
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            times.append(float(m.group(1)))
    return times


def speech_spans_from_silence(duration: float, silences: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Complement of silence within [0, duration]."""
    spans: list[tuple[float, float]] = []
    cursor = 0.0
    for s, e in sorted(silences):
        if s > cursor:
            spans.append((cursor, min(s, duration)))
        cursor = max(cursor, e)
    if cursor < duration:
        spans.append((cursor, duration))
    return [(round(s, 3), round(e, 3)) for s, e in spans if e - s > 0.05]
```

- [ ] **Step 2: Write the producer protocol**

Create `perception/clipforge_perception/producers/__init__.py` (empty), and `perception/clipforge_perception/producers/base.py`:

```python
"""Producer protocol: a producer turns media into one or more partial timeline layers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class Ctx:
    duration: float
    sample_fps: float


class Producer(Protocol):
    name: str

    def run(self, video: str, ctx: Ctx) -> dict:
        """Return a dict of timeline layers to merge (e.g. {'speakers': [...], 'scenes': [...]})."""
        ...
```

- [ ] **Step 3: Write the failing mock-producer test**

Create `perception/tests/conftest.py`:

```python
import subprocess
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def tiny_video(tmp_path_factory) -> str:
    """A 5s test clip (testsrc video + sine audio with a gap) synthesized via ffmpeg."""
    out = tmp_path_factory.mktemp("media") / "tiny.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=5",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
         "-shortest", "-pix_fmt", "yuv420p", str(out)],
        check=True,
    )
    return str(out)
```

Create `perception/tests/test_mock_producer.py`:

```python
from clipforge_perception import schema
from clipforge_perception.producers.base import Ctx
from clipforge_perception.producers.mock import MockProducer


def test_mock_producer_emits_valid_nonempty_layers(tiny_video):
    ctx = Ctx(duration=5.0, sample_fps=2)
    layers = MockProducer().run(tiny_video, ctx)

    assert set(layers).issubset({"speakers", "audio_events", "scenes"})
    assert layers["speakers"] and layers["scenes"]  # non-empty

    # Layers must slot into an empty timeline and validate clean.
    t = schema.empty_timeline("job-mock", 5.0, 2)
    t.update(layers)
    t["producers_run"] = ["mock"]
    assert schema.validate(t) == []


def test_mock_producer_is_deterministic(tiny_video):
    ctx = Ctx(duration=5.0, sample_fps=2)
    assert MockProducer().run(tiny_video, ctx) == MockProducer().run(tiny_video, ctx)
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd perception && .venv/bin/pytest tests/test_mock_producer.py -q`
Expected: FAIL — `ModuleNotFoundError: clipforge_perception.producers.mock`.

- [ ] **Step 5: Write the mock producer**

Create `perception/clipforge_perception/producers/mock.py`:

```python
"""Mock producer — schema-valid layers from cheap ffmpeg heuristics (Phase 1a).

Honest about what a mock knows: it detects speech regions (silencedetect) and scene cuts
(scene-change), but does NOT diarize (single speaker S0) or classify audio (events are 'speech').
Real diarization/classification/embeddings are Phases 1b–1d.
"""

from __future__ import annotations

from .. import ffmpeg
from ..schema import AudioEvent, Scene, Span, Speaker, event_to_dict, scene_to_dict, speaker_to_dict
from .base import Ctx


class MockProducer:
    name = "mock"

    def run(self, video: str, ctx: Ctx) -> dict:
        duration = ctx.duration
        silences = ffmpeg.silence_spans(video)
        speech = ffmpeg.speech_spans_from_silence(duration, silences)

        speaker = Speaker(id="S0", turns=[Span(start=s, end=e) for s, e in speech])
        events = [AudioEvent(start=s, end=e, kind="speech", score=1.0) for s, e in speech]

        cuts = [t for t in ffmpeg.scene_cut_times(video) if 0.0 < t < duration]
        bounds = [0.0, *sorted(cuts), duration]
        scenes: list[Scene] = []
        for i in range(len(bounds) - 1):
            start, end = round(bounds[i], 3), round(bounds[i + 1], 3)
            if end - start > 0.05:
                scenes.append(Scene(start=start, end=end, label=f"scene {len(scenes) + 1}"))
        if not scenes:  # no cuts at all → whole clip is one scene
            scenes = [Scene(start=0.0, end=round(duration, 3), label="scene 1")]

        return {
            "speakers": [speaker_to_dict(speaker)],
            "audio_events": [event_to_dict(e) for e in events],
            "scenes": [scene_to_dict(s) for s in scenes],
        }
```

- [ ] **Step 6: Run mock test to verify it passes**

Run: `cd perception && .venv/bin/pytest tests/test_mock_producer.py -q`
Expected: PASS (2 tests).

- [ ] **Step 7: Write the pipeline + CLI + failing CLI test**

Create `perception/clipforge_perception/pipeline.py`:

```python
"""Run selected producers, merge their layers, validate, write JSON."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import ffmpeg, schema
from .producers.base import Ctx
from .producers.mock import MockProducer

PRODUCERS = {"mock": MockProducer}


def analyze(video: str, out: str, models: list[str], sample_fps: float, job_id: str) -> int:
    if not Path(video).exists():
        print(f"error: video not found: {video}", file=sys.stderr)
        return 2

    duration = ffmpeg.probe_duration(video)
    ctx = Ctx(duration=duration, sample_fps=sample_fps)
    timeline = schema.empty_timeline(job_id, duration, sample_fps)

    ran: list[str] = []
    for name in models:
        factory = PRODUCERS.get(name)
        if factory is None:
            print(f"warning: unknown producer '{name}' — skipped", file=sys.stderr)
            continue
        try:
            layers = factory().run(video, ctx)
            for key, value in layers.items():
                timeline[key] = value
            ran.append(name)
        except Exception as exc:  # PERCEPTION_PRODUCER_FAILED — omit layer, keep going
            print(f"warning: producer '{name}' failed ({exc}) — layer omitted", file=sys.stderr)
    timeline["producers_run"] = ran

    errors = schema.validate(timeline)
    if errors:
        print("error: produced timeline is invalid:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 1

    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(timeline, indent=2))
    return 0
```

Create `perception/clipforge_perception/cli.py`:

```python
"""clipforge-perception CLI. Exit 0 + valid JSON written = success."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import pipeline


def main() -> None:
    parser = argparse.ArgumentParser(prog="clipforge-perception")
    sub = parser.add_subparsers(dest="command", required=True)

    analyze = sub.add_parser("analyze", help="analyze a video into a semantic timeline")
    analyze.add_argument("video")
    analyze.add_argument("--out", required=True, help="output semantic_timeline.json path")
    analyze.add_argument("--models", default="mock", help="comma-separated producers (default: mock)")
    analyze.add_argument("--sample-fps", type=float, default=2.0)
    analyze.add_argument("--job-id", default=None, help="defaults to the --out parent dir name")

    args = parser.parse_args()
    if args.command == "analyze":
        job_id = args.job_id or Path(args.out).resolve().parent.name or "job"
        models = [m.strip() for m in args.models.split(",") if m.strip()]
        sys.exit(pipeline.analyze(args.video, args.out, models, args.sample_fps, job_id))


if __name__ == "__main__":
    main()
```

Create `perception/tests/test_cli.py`:

```python
import json
import subprocess
import sys
from pathlib import Path

from clipforge_perception import schema


def test_cli_analyze_writes_valid_timeline(tiny_video, tmp_path):
    out = tmp_path / "job42" / "semantic_timeline.json"
    rc = subprocess.run(
        [sys.executable, "-m", "clipforge_perception.cli", "analyze", tiny_video,
         "--out", str(out), "--models", "mock", "--job-id", "job42"],
    ).returncode
    assert rc == 0
    timeline = json.loads(out.read_text())
    assert schema.validate(timeline) == []
    assert timeline["producers_run"] == ["mock"]
    assert timeline["job_id"] == "job42"


def test_cli_missing_video_is_fatal(tmp_path):
    rc = subprocess.run(
        [sys.executable, "-m", "clipforge_perception.cli", "analyze",
         str(tmp_path / "nope.mp4"), "--out", str(tmp_path / "o.json")],
    ).returncode
    assert rc == 2
```

Add `perception/clipforge_perception/__main__.py` so `-m clipforge_perception.cli` works cleanly is not needed (we invoke the module directly). No extra file.

- [ ] **Step 8: Run CLI test to verify it passes**

Run: `cd perception && .venv/bin/pytest tests/test_cli.py -q`
Expected: PASS (2 tests).

- [ ] **Step 9: Run the whole Python suite**

Run: `cd perception && .venv/bin/pytest -q`
Expected: PASS (all tests across test_schema/test_mock_producer/test_cli).

- [ ] **Step 10: Commit**

```bash
git add perception/clipforge_perception/ffmpeg.py perception/clipforge_perception/producers \
  perception/clipforge_perception/pipeline.py perception/clipforge_perception/cli.py \
  perception/tests/conftest.py perception/tests/test_mock_producer.py perception/tests/test_cli.py
git commit -m "feat(perception): mock producer + pipeline + analyze CLI (SP1 1a)"
```

---

## Task 4: Node SubprocessPerceptionClient — cache, spawn, fail-soft

**Files:**
- Create: `src/perception/perceptionClient.ts`
- Create: `src/perception/subprocessClient.ts`
- Modify: `src/report/reasonCodes.ts` (add two enum members)
- Test: `tests/perception/subprocessClient.test.ts`

**Interfaces:**
- Consumes: `SemanticTimeline`, `validateTimeline` (Task 1); `run` from `src/utils/cmd.js`; `ReasonCode` from `src/report/reasonCodes.js`.
- Produces: `interface PerceptionClient { analyze(videoPath: string, jobId: string): Promise<SemanticTimeline | null> }`; `class SubprocessPerceptionClient implements PerceptionClient` with constructor opts `{ workspaceDir?, models?, sampleFps?, cliPath?, stallMs?, run?, onReason? }`.
- Reason codes added: `PERCEPTION_UNAVAILABLE`, `PERCEPTION_PRODUCER_FAILED`.

- [ ] **Step 1: Add the reason codes**

In `src/report/reasonCodes.ts`, inside the `ReasonCode` enum, add after `MODEL_UNAVAILABLE_STEPDOWN` / `GPU_OOM_STEPDOWN` (before the `CF_` additions comment):

```ts
  // SP1 perception (hybrid perception architecture, 2026-07-06 design)
  PERCEPTION_UNAVAILABLE = 'PERCEPTION_UNAVAILABLE',       // no venv/CLI, timeout, or invalid output
  PERCEPTION_PRODUCER_FAILED = 'PERCEPTION_PRODUCER_FAILED', // a producer errored; its layer omitted
```

- [ ] **Step 2: Write the PerceptionClient interface**

Create `src/perception/perceptionClient.ts`:

```ts
import type { SemanticTimeline } from './timeline.js';

/** A perception backend: video → semantic timeline, or null when unavailable. */
export interface PerceptionClient {
  analyze(videoPath: string, jobId: string): Promise<SemanticTimeline | null>;
}

/**
 * Wiring helper (kept pure/testable so analyzeVideo stays thin): when perception is disabled,
 * return null without touching the client; otherwise delegate.
 */
export async function resolvePerception(
  enabled: boolean,
  videoPath: string,
  jobId: string,
  client: PerceptionClient,
): Promise<SemanticTimeline | null> {
  if (!enabled) return null;
  return client.analyze(videoPath, jobId);
}
```

- [ ] **Step 3: Write the failing client test**

Create `tests/perception/subprocessClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubprocessPerceptionClient } from '../../src/perception/subprocessClient.js';
import { ReasonCode } from '../../src/report/reasonCodes.js';

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, '../../perception/fixtures/golden_timeline.json'), 'utf8'),
);

function ws(): string {
  return mkdtempSync(join(tmpdir(), 'cf-perc-'));
}
function writeCache(dir: string, jobId: string, timeline: unknown): string {
  const d = join(dir, 'perception', jobId);
  mkdirSync(d, { recursive: true });
  const p = join(d, 'semantic_timeline.json');
  writeFileSync(p, JSON.stringify(timeline));
  return p;
}

describe('SubprocessPerceptionClient', () => {
  let reasons: ReasonCode[];
  beforeEach(() => { reasons = []; });
  const onReason = (c: ReasonCode) => reasons.push(c);

  it('returns cached timeline without spawning when producers_run covers requested models', async () => {
    const dir = ws();
    writeCache(dir, 'job1', { ...GOLDEN, producers_run: ['mock'] });
    const run = vi.fn();
    const client = new SubprocessPerceptionClient({ workspaceDir: dir, models: ['mock'], run, onReason });
    const t = await client.analyze('/x/video.mp4', 'job1');
    expect(t?.job_id).toBe('golden-fixture');
    expect(run).not.toHaveBeenCalled();
  });

  it('re-runs when cache producers_run does not cover requested models', async () => {
    const dir = ws();
    writeCache(dir, 'job2', { ...GOLDEN, producers_run: ['mock'] });
    const run = vi.fn(async (_cmd, args: string[]) => {
      const out = args[args.indexOf('--out') + 1];
      writeFileSync(out, JSON.stringify({ ...GOLDEN, producers_run: ['mock', 'pyannote'] }));
      return { stdout: '', stderr: '' };
    });
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock', 'pyannote'], run, cliPath: __filename, onReason,
    });
    const t = await client.analyze('/x/video.mp4', 'job2');
    expect(run).toHaveBeenCalledOnce();
    expect(t?.producers_run).toContain('pyannote');
  });

  it('spawns on cache miss and returns the written timeline', async () => {
    const dir = ws();
    const run = vi.fn(async (_cmd, args: string[]) => {
      const out = args[args.indexOf('--out') + 1];
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, JSON.stringify(GOLDEN));
      return { stdout: '', stderr: '' };
    });
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock'], run, cliPath: __filename, onReason,
    });
    const t = await client.analyze('/x/video.mp4', 'job3');
    expect(run).toHaveBeenCalledOnce();
    expect(t?.speakers.length).toBe(2);
  });

  it('fails soft to null + PERCEPTION_UNAVAILABLE when the CLI binary is absent', async () => {
    const dir = ws();
    const run = vi.fn();
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock'], run, cliPath: '/no/such/clipforge-perception', onReason,
    });
    const t = await client.analyze('/x/video.mp4', 'job4');
    expect(t).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(reasons).toContain(ReasonCode.PERCEPTION_UNAVAILABLE);
  });

  it('fails soft to null when the CLI writes invalid JSON', async () => {
    const dir = ws();
    const run = vi.fn(async (_cmd, args: string[]) => {
      const out = args[args.indexOf('--out') + 1];
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, '{ not valid');
      return { stdout: '', stderr: '' };
    });
    const client = new SubprocessPerceptionClient({
      workspaceDir: dir, models: ['mock'], run, cliPath: __filename, onReason,
    });
    expect(await client.analyze('/x/video.mp4', 'job5')).toBeNull();
    expect(reasons).toContain(ReasonCode.PERCEPTION_UNAVAILABLE);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/perception/subprocessClient.test.ts`
Expected: FAIL — cannot resolve `../../src/perception/subprocessClient.js`.

- [ ] **Step 5: Write the SubprocessPerceptionClient**

Create `src/perception/subprocessClient.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { run as defaultRun } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import { ReasonCode } from '../report/reasonCodes.js';
import type { PerceptionClient } from './perceptionClient.js';
import { validateTimeline, type SemanticTimeline } from './timeline.js';

const DEFAULT_CLI = 'perception/.venv/bin/clipforge-perception';

export interface SubprocessClientOpts {
  workspaceDir?: string;
  models?: string[];
  sampleFps?: number;
  cliPath?: string;
  /** Kill a hung pass after this long with no output (throttling-Mac guard). */
  stallMs?: number;
  run?: typeof defaultRun;
  onReason?: (code: ReasonCode) => void;
}

export class SubprocessPerceptionClient implements PerceptionClient {
  private readonly ws: string;
  private readonly models: string[];
  private readonly sampleFps: number;
  private readonly cliPath: string;
  private readonly stallMs: number;
  private readonly run: typeof defaultRun;
  private readonly onReason?: (code: ReasonCode) => void;

  constructor(opts: SubprocessClientOpts = {}) {
    this.ws = opts.workspaceDir ?? process.env.WORKSPACE_DIR ?? './workspace';
    this.models = opts.models ?? ['mock'];
    this.sampleFps = opts.sampleFps ?? 2;
    this.cliPath = opts.cliPath ?? DEFAULT_CLI;
    this.stallMs = opts.stallMs ?? 5 * 60 * 1000;
    this.run = opts.run ?? defaultRun;
    this.onReason = opts.onReason;
  }

  async analyze(videoPath: string, jobId: string): Promise<SemanticTimeline | null> {
    const outPath = join(this.ws, 'perception', jobId, 'semantic_timeline.json');

    const cached = this.readValid(outPath);
    if (cached && this.models.every((m) => cached.producers_run.includes(m))) {
      logger.info(`[${jobId}] perception cache hit (${cached.producers_run.join(',') || 'none'})`);
      return cached;
    }

    // Auto-off: no venv/CLI on disk → degrade silently, no spawn attempt.
    if (!existsSync(this.cliPath)) {
      return this.fail(jobId, ReasonCode.PERCEPTION_UNAVAILABLE,
        `perception CLI not found at ${this.cliPath} — run ./start.sh perception-setup`);
    }

    try {
      await mkdir(dirname(outPath), { recursive: true });
      await this.run(resolve(this.cliPath), [
        'analyze', videoPath,
        '--out', outPath,
        '--models', this.models.join(','),
        '--sample-fps', String(this.sampleFps),
        '--job-id', jobId,
      ], { stallMs: this.stallMs, onStderr: (l) => logger.warn(`[perception] ${l}`) });
    } catch (e) {
      return this.fail(jobId, ReasonCode.PERCEPTION_UNAVAILABLE,
        `perception run failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const produced = this.readValid(outPath);
    if (!produced) {
      return this.fail(jobId, ReasonCode.PERCEPTION_UNAVAILABLE,
        'perception produced no valid timeline');
    }
    logger.info(`[${jobId}] perception: ${produced.speakers.length} spk, ` +
      `${produced.audio_events.length} audio-events, ${produced.scenes.length} scenes ` +
      `(${produced.producers_run.join(',') || 'none'})`);
    return produced;
  }

  private readValid(path: string): SemanticTimeline | null {
    if (!existsSync(path)) return null;
    try {
      const res = validateTimeline(JSON.parse(readFileSync(path, 'utf8')));
      return res.ok ? res.timeline : null;
    } catch {
      return null;
    }
  }

  private fail(jobId: string, code: ReasonCode, msg: string): null {
    logger.warn(`[${jobId}] ${code}: ${msg}`);
    this.onReason?.(code);
    return null;
  }
}
```

- [ ] **Step 6: Verify the logger import path**

Run: `grep -rn "export const logger\|export.*logger" src/utils/logger.ts`
Expected: a `logger` export exists. If the path/name differs (e.g. `src/utils/log.ts`), fix the import in `subprocessClient.ts` to match; other modules (`all.ts` uses `logger`) import it the same way — mirror that exact import.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/perception/subprocessClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add src/perception/perceptionClient.ts src/perception/subprocessClient.ts \
  src/report/reasonCodes.ts tests/perception/subprocessClient.test.ts
git commit -m "feat(perception): SubprocessPerceptionClient — cache/spawn/fail-soft + reason codes (SP1 1a)"
```

---

## Task 5: Wire perception into analyzeVideo + CLI flag

**Files:**
- Modify: `src/types/index.ts` (add field to `VideoAnalysis`)
- Modify: `src/cli/commands/all.ts` (`AllOpts` + `analyzeVideo` wiring)
- Modify: `src/cli/index.ts` (add `--no-perception`)
- Test: `tests/perception/resolvePerception.test.ts`

**Interfaces:**
- Consumes: `resolvePerception`, `SubprocessPerceptionClient` (Task 4); `SemanticTimeline` (Task 1).
- Produces: `VideoAnalysis.perception?: SemanticTimeline | null`; `AllOpts.perception?: boolean`; CLI `--no-perception`.

- [ ] **Step 1: Write the failing wiring test**

Create `tests/perception/resolvePerception.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolvePerception, type PerceptionClient } from '../../src/perception/perceptionClient.js';

const fakeTimeline = { job_id: 'j', producers_run: ['mock'] } as unknown;

function client(): PerceptionClient & { analyze: ReturnType<typeof vi.fn> } {
  const analyze = vi.fn(async () => fakeTimeline as never);
  return { analyze };
}

describe('resolvePerception', () => {
  it('returns null and does not call the client when disabled', async () => {
    const c = client();
    const res = await resolvePerception(false, '/v.mp4', 'j', c);
    expect(res).toBeNull();
    expect(c.analyze).not.toHaveBeenCalled();
  });

  it('delegates to the client when enabled', async () => {
    const c = client();
    const res = await resolvePerception(true, '/v.mp4', 'j', c);
    expect(c.analyze).toHaveBeenCalledWith('/v.mp4', 'j');
    expect(res).toBe(fakeTimeline);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/perception/resolvePerception.test.ts`
Expected: FAIL until `resolvePerception` is imported correctly — actually this passes if Task 4 landed. Run it; if it PASSES, that confirms the helper. Proceed. (This step exists to lock the wiring contract before touching the large `all.ts`.)

- [ ] **Step 3: Add the `SemanticTimeline` field to `VideoAnalysis`**

In `src/types/index.ts`, add the import at the top (with the other imports, or as the first `import type`):

```ts
import type { SemanticTimeline } from '../perception/timeline.js';
```

Then inside `interface VideoAnalysis { ... }` (currently ending at the `motion?` field, line ~135), add:

```ts
  /** SP1 perception: semantic timeline from the Python service, or null when off/unavailable. */
  perception?: SemanticTimeline | null;
```

- [ ] **Step 4: Add `perception` to `AllOpts`**

In `src/cli/commands/all.ts`, inside `interface AllOpts { ... }` (starts line ~91), add:

```ts
  /** Perception pass (semantic timeline). Default on; --no-perception disables. */
  perception?: boolean;
```

- [ ] **Step 5: Wire `analyzeVideo`**

In `src/cli/commands/all.ts`, add imports near the other `src/...` imports:

```ts
import { resolvePerception } from '../../perception/perceptionClient.js';
import { SubprocessPerceptionClient } from '../../perception/subprocessClient.js';
```

Then in `analyzeVideo`, right after the transcript block (after `sp.succeed(\`Transcript ready …\`)`, around line 245) insert:

```ts
  // SP1: Python perception pass (semantic timeline). Enrichment only — fail-soft to null,
  // pipeline unchanged when off or unavailable. Cached per source under workspace/perception/<jobId>.
  const perception = await resolvePerception(
    opts.perception !== false, dl.videoPath, jobId, new SubprocessPerceptionClient(),
  );
```

Then in the returned object (line ~309), add `perception` to the returned `VideoAnalysis`:

```ts
  return { jobId, url, videoPath: dl.videoPath, meta, segments, triggers, audio, semantic, candidates: finalCandidates, mode: profile.name, motion, perception };
```

- [ ] **Step 6: Add the `--no-perception` CLI flag**

In `src/cli/index.ts`, alongside the other `.option(...)` lines (e.g. near `--no-sfx`, line ~42), add:

```ts
    .option('--no-perception', 'disable the Python perception pass (semantic timeline enrichment)')
```

- [ ] **Step 7: Run tests + typecheck + build**

Run: `npx vitest run tests/perception/ && npm run build`
Expected: all perception tests PASS; `tsc` build succeeds with no type errors (confirms the `VideoAnalysis`/`AllOpts` additions compile and the return object is well-typed).

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/cli/commands/all.ts src/cli/index.ts tests/perception/resolvePerception.test.ts
git commit -m "feat(perception): wire perception pass into analyzeVideo + --no-perception flag (SP1 1a)"
```

---

## Task 6: Setup script + docs + end-to-end verification

**Files:**
- Modify: `start.sh` (add `perception-setup` subcommand)
- Modify: `docs/DEPENDENCIES.md` (perception-service entry)
- Create: `perception/README.md`

**Interfaces:**
- Consumes: everything above (the built CLI, the Node client).
- Produces: `./start.sh perception-setup` (idempotent venv + editable install); a documented, verifiable end-to-end pass.

- [ ] **Step 1: Add the `perception-setup` branch to `start.sh`**

In `start.sh`, immediately after the helper definitions (`say`/`fail`, right after the `bold=...reset=...` line, before `# ---------- 1. Required tools ----------`), insert:

```bash
# ---------- perception-setup (Python AI perception microservice) ----------
# Isolated: its own venv under perception/.venv; Node touches it only via the CLI.
if [ "${1:-}" = "perception-setup" ]; then
  command -v python3 >/dev/null || fail "python3 not found — install Python 3.10+ (brew install python@3.12)"
  command -v ffmpeg  >/dev/null || fail "ffmpeg not found — brew install ffmpeg"
  if command -v uv >/dev/null; then
    say "Setting up perception service with uv (perception/.venv)…"
    (cd perception && uv venv .venv && uv pip install --python .venv/bin/python -e ".[dev]")
  else
    say "Setting up perception service with venv+pip (perception/.venv)…"
    [ -d perception/.venv ] || python3 -m venv perception/.venv
    perception/.venv/bin/pip install --upgrade pip >/dev/null
    perception/.venv/bin/pip install -e "perception[dev]"
  fi
  say "Perception ready. Verify: perception/.venv/bin/clipforge-perception --help"
  echo "  ${dim}Phase 1a = mock producer (ffmpeg only): no Hugging Face token or model download needed yet.${reset}"
  echo "  ${dim}Later phases (pyannote diarization) will need a free HF_TOKEN in .env.${reset}"
  exit 0
fi
```

- [ ] **Step 2: Verify the setup script works**

Run: `./start.sh perception-setup`
Expected: creates/uses `perception/.venv`, installs the package, prints "Perception ready". Then:

Run: `perception/.venv/bin/clipforge-perception --help`
Expected: argparse help text listing the `analyze` subcommand.

- [ ] **Step 3: Add the DEPENDENCIES.md entry**

In `docs/DEPENDENCIES.md`, after the "System tools (not npm)" table, add a new section:

```markdown
## Python perception service (`perception/`, optional)

Isolated microservice (own venv `perception/.venv`), run once-per-source and cached. Node shells
out to its `clipforge-perception` CLI; it never imports a Python model. Absent venv → perception
degrades to off, pipeline unchanged.

| Component | Purpose | License | Notes |
|-----------|---------|---------|-------|
| Python 3.10+ | perception runtime | PSF | user-installed (`brew install python@3.12`) |
| jsonschema | validate the semantic timeline against the JSON-schema source of truth | MIT | only runtime dep in Phase 1a |
| ffmpeg/ffprobe | mock producer heuristics (silencedetect, scene cuts) | LGPL/GPL | already required by ClipForge |
| pyannote.audio (Phase 1b) | speaker diarization | MIT (code); models need a free **HF_TOKEN** | not installed in 1a |
| YAMNet / CLIP (Phases 1c/1d) | audio events / scene embeddings | Apache-2.0 / MIT | not installed in 1a |

Setup: `./start.sh perception-setup`.
```

- [ ] **Step 4: Write the perception README**

Create `perception/README.md`:

```markdown
# ClipForge Perception Service

Python microservice that turns media into **facts** — a versioned `semantic_timeline.json`. It
never reasons (that's the Node/LLM Understanding layer). Node touches it only via the CLI.

## Setup

```bash
./start.sh perception-setup           # creates perception/.venv, installs the package
perception/.venv/bin/clipforge-perception --help
```

## CLI

```bash
clipforge-perception analyze <video> --out <path> --models mock [--sample-fps 2] [--job-id ID]
```

Exit 0 + valid JSON written = success. A producer that fails logs a warning, omits its layer, and
the run still succeeds with a partial (valid) timeline. Fatal errors (bad args, unreadable video)
exit non-zero.

## Producers

| Producer | Phase | Layers | Notes |
|----------|-------|--------|-------|
| `mock` | 1a | speakers, audio_events, scenes | ffmpeg heuristics; single speaker S0, events kind `speech` |
| `pyannote` | 1b | speakers (real diarization) | needs free `HF_TOKEN` |
| `yamnet` | 1c | audio_events (laughter/applause/…) | |
| `clip` | 1d | scenes (embeddings + labels) | |

## Tests

```bash
perception/.venv/bin/pytest -q
```

The JSON-schema at `clipforge_perception/schema/semantic_timeline.v1.schema.json` is the contract
source of truth; `fixtures/golden_timeline.json` is the shared conformance anchor (Node tests load
it too).
```

- [ ] **Step 5: End-to-end verification (the Phase 1a exit criterion)**

Run a real analyze through the Node client against a synthesized clip and confirm a cached, valid timeline:

```bash
# synth a 5s clip
mkdir -p /tmp/cf-perc && ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i testsrc=size=320x240:rate=10:duration=5 \
  -f lavfi -i sine=frequency=440:duration=5 -shortest -pix_fmt yuv420p /tmp/cf-perc/tiny.mp4

# drive the Node client directly (mirrors analyzeVideo)
node --input-type=module -e '
import { SubprocessPerceptionClient } from "./dist/perception/subprocessClient.js";
const c = new SubprocessPerceptionClient({ workspaceDir: "/tmp/cf-perc/ws" });
const t = await c.analyze("/tmp/cf-perc/tiny.mp4", "smoke1");
console.log(JSON.stringify({ ok: !!t, producers: t?.producers_run, scenes: t?.scenes.length }));
'
```

Expected: `{"ok":true,"producers":["mock"],"scenes":N}` and the file `/tmp/cf-perc/ws/perception/smoke1/semantic_timeline.json` exists and is valid. Run the same command again → log shows "perception cache hit" (no re-spawn).

Then confirm **graceful-off / pipeline-unchanged** — a real clip export with perception disabled behaves exactly as today:

Run: `node dist/cli/index.js all <a-real-youtube-url> --no-perception` (or any existing smoke URL you use)
Expected: identical behavior to a pre-perception run; no perception logs, no errors.

- [ ] **Step 6: Full gate + commit**

Run: `npm test && npm run build`
Expected: all vitest suites PASS, tsc build clean.

```bash
git add start.sh docs/DEPENDENCIES.md perception/README.md
git commit -m "feat(perception): perception-setup script + docs + Phase 1a end-to-end (SP1 1a)"
```

---

## Self-Review

**1. Spec coverage (against §8 Phase 1a exit list):**
- JSON-schema + TS types + Python dataclasses → Tasks 1, 2. ✅
- Python CLI + mock producer (ffmpeg RMS/scene-cuts) → Task 3. ✅
- `SubprocessPerceptionClient` + cache + `analyzeVideo` wiring + graceful-off → Tasks 4, 5. ✅
- Golden timeline fixture + schema-contract tests (Node consumer against fixture, Python `validate()`) → Task 1 (Node) + Task 2 (Python), shared `perception/fixtures/golden_timeline.json`. ✅
- `perception-setup` scaffold + `DEPENDENCIES.md` entry → Task 6. ✅
- Cache hit/miss + fail-soft (missing CLI → null → pipeline runs) tests → Task 4. ✅
- Exit criterion: real run → cached valid mock timeline end-to-end; pipeline unchanged when off → Task 6 Step 5. ✅
- Reason codes `PERCEPTION_UNAVAILABLE` / `PERCEPTION_PRODUCER_FAILED` (§7) → Task 4 Step 1 (`PRODUCER_FAILED` emitted by the Python pipeline stderr in Task 3; the enum value exists for downstream run_report aggregation, which is a 1c follow-on per §6). ✅
- Stall-watchdog for the throttling Mac (§7) → Task 4 (`stallMs` passed to `run()`). ✅

**Deferred (correctly, per spec):** deep consumption of `speakers`/`audio_events`/`scenes` into Slice E / AVSS / Slice B is Phases 1b–1d and SP2 — Phase 1a only produces, caches, validates, and *carries* the timeline. run_report aggregation of the perception reason codes is wired when audio_events land (1c).

**2. Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N" — every code step has complete code; every command has expected output. ✅

**3. Type consistency:** `SemanticTimeline`/`validateTimeline` (Task 1) consumed identically in Tasks 4–5; `PerceptionClient.analyze(videoPath, jobId)` signature matches the client impl and `resolvePerception` call; `MockProducer.run(video, ctx) -> dict` matches the `Producer` protocol and `pipeline.analyze` merge; `producers_run ⊇ models` cache rule stated in Global Constraints and implemented in Task 4 Step 5; reason-code names identical across enum/client/tests. ✅

---

**Note on Task 4 Step 6 / Task 5 Step 3:** the plan assumes `src/utils/logger.ts` exports `logger` and `src/perception/timeline.js` is importable from `src/types/index.ts`. Both mirror existing patterns (`all.ts` imports `logger`; types importing a type across dirs is standard). If the logger export name differs, Task 4 Step 6 catches it before the client is used.
