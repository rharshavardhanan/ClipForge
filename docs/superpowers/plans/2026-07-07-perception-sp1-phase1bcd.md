# SP1 Phase 1b–1d: Real Perception Producers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock-only semantic timeline with real perception: PyAnnote speaker diarization (1b), YAMNet audio events (1c), CLIP scene labels + embeddings (1d), plus the three small Node consumer wirings the design assigns to 1c/1d.

**Architecture:** Three new producers in the existing Python microservice (`perception/`), each behind the established `Producer` protocol with lazy imports so `--models mock` never touches torch/tensorflow. The pipeline gains incremental merge (an existing cached timeline is the starting point, so Node can request only missing producers). On the Node side: the subprocess client spawns only missing models; `audio_events` feed Slice E reaction candidates and the AVSS dopamine model; `scenes` labels become the Slice B topic fallback. Everything stays fail-soft: a missing dep, missing HF token, or failed producer omits its layer with a warning and the run still exits 0.

**Tech Stack:** Python 3.10+ (venv at `perception/.venv`), `pyannote.audio` (torch), `tensorflow`+`tensorflow-hub` (YAMNet), `open-clip-torch` (ViT-B-32), ffmpeg subprocess helpers (no python media deps for I/O), Node/TypeScript consumers, vitest + pytest.

## Global Constraints

- **Free-only mandate:** all models are free/open (HF token is a free account); no paid APIs, no always-on infra.
- **Mac, no CUDA:** producers run on CPU (torch MPS allowed but never required); perception is a once-per-source **cached** pass — slow first run is acceptable by design.
- **Python = perception, Node = reasoning:** Node never imports a model; it consumes `semantic_timeline.json` via the existing `SubprocessPerceptionClient` only.
- **Fail-soft everywhere:** producer failure → layer omitted + stderr warning + exit 0 (existing pipeline contract). Node consumers must behave identically when `perception === null`.
- **Perception stays OPT-IN (default OFF):** gate remains `opts.perception === true || PERCEPTION=1`. Do NOT flip the default in this plan.
- **Schema is frozen at version 1:** no changes to `semantic_timeline.v1.schema.json` or the golden fixture. Producers fill existing layers only.
- **Lazy imports:** heavy deps (`torch`, `tensorflow`, `open_clip`, `pyannote`) are imported inside `run()`/`warm()` bodies, never at module top level.
- **Gates:** root `npx vitest run` + `npx tsc --noEmit` must stay green. Python tests run in their own lane (`perception/.venv/bin/python -m pytest perception/tests/`) and are NOT part of the Node gates. Real-model integration tests are skipped unless `PERCEPTION_REAL_TESTS=1`.
- **Never `next build` in `ui/`** (corrupts a live dev server). UI is untouched by this plan.
- Commit messages: `feat(perception): …` / `feat(director): …` style, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
perception/
  pyproject.toml                              # + [real] extra (added across Tasks 3-5)
  clipforge_perception/
    ffmpeg.py                                 # + extract_wav_16k, extract_frame (Task 1)
    pipeline.py                               # + incremental merge, Ctx.out_dir (Task 2)
    cli.py                                    # + warm subcommand (Task 6)
    producers/
      base.py                                 # + Ctx.out_dir field (Task 2)
      pyannote_diar.py                        # Task 3
      yamnet_events.py                        # Task 4
      clip_scenes.py                          # Task 5
  tests/
    test_ffmpeg_helpers.py                    # Task 1
    test_pipeline_merge.py                    # Task 2
    test_pyannote_producer.py                 # Task 3
    test_yamnet_producer.py                   # Task 4
    test_clip_producer.py                     # Task 5
src/perception/
  subprocessClient.ts                         # spawn-only-missing + real default models (Task 7)
  query.ts                                    # NEW: clipReactionEvents, sceneTopicOf (Tasks 9-10)
src/director/arcTemplates.ts                  # + detectAudienceReactionCandidates (Task 8)
src/avss/editPlan.ts                          # + SourceSignals.reactionEvents (Task 9)
src/avss/simulator.ts                         # + real reaction events in dopamine (Task 9)
src/cli/commands/all.ts                       # wire all three consumers (Tasks 8-10)
start.sh                                      # perception-setup installs [real] + warm (Task 6)
docs/DEPENDENCIES.md                          # + new Python deps (Task 6)
```

---

### Task 1: ffmpeg audio/frame extraction helpers (Python)

**Files:**
- Modify: `perception/clipforge_perception/ffmpeg.py`
- Test: `perception/tests/test_ffmpeg_helpers.py`

**Interfaces:**
- Consumes: nothing new (subprocess + existing module style).
- Produces: `extract_wav_16k(video: str, out_wav: str) -> str` (writes 16kHz mono s16 WAV, returns `out_wav`, raises `RuntimeError` on ffmpeg failure) and `extract_frame(video: str, at_sec: float, out_jpg: str) -> str` (one JPEG at `at_sec`). Tasks 3-5 call these.

- [ ] **Step 1: Write the failing tests**

```python
# perception/tests/test_ffmpeg_helpers.py
import subprocess

from clipforge_perception import ffmpeg


def _probe(path: str, entries: str) -> str:
    return subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", entries, "-of", "default=nokey=1:noprint_wrappers=1", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_extract_wav_16k_mono(tiny_video, tmp_path):
    wav = ffmpeg.extract_wav_16k(tiny_video, str(tmp_path / "a.wav"))
    assert _probe(wav, "stream=sample_rate") == "16000"
    assert _probe(wav, "stream=channels") == "1"


def test_extract_wav_16k_raises_on_bad_input(tmp_path):
    import pytest
    with pytest.raises(RuntimeError):
        ffmpeg.extract_wav_16k(str(tmp_path / "missing.mp4"), str(tmp_path / "a.wav"))


def test_extract_frame_writes_jpeg(tiny_video, tmp_path):
    from pathlib import Path
    jpg = ffmpeg.extract_frame(tiny_video, 2.0, str(tmp_path / "f.jpg"))
    data = Path(jpg).read_bytes()
    assert data[:2] == b"\xff\xd8"  # JPEG SOI marker
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_ffmpeg_helpers.py -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'extract_wav_16k'`

- [ ] **Step 3: Implement the helpers**

Append to `perception/clipforge_perception/ffmpeg.py`:

```python
def extract_wav_16k(video: str, out_wav: str) -> str:
    """Extract a 16kHz mono s16 WAV (the input format PyAnnote and YAMNet share)."""
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", video,
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out_wav],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg wav extract failed ({proc.returncode}): {proc.stderr[-500:]}")
    return out_wav


def extract_frame(video: str, at_sec: float, out_jpg: str) -> str:
    """Extract one JPEG frame at `at_sec` (input-seek: fast and accurate enough for scenes)."""
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-ss", f"{at_sec:.3f}", "-i", video, "-frames:v", "1", "-q:v", "3", out_jpg],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg frame extract failed ({proc.returncode}): {proc.stderr[-500:]}")
    return out_jpg
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_ffmpeg_helpers.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add perception/clipforge_perception/ffmpeg.py perception/tests/test_ffmpeg_helpers.py
git commit -m "feat(perception): ffmpeg wav/frame extraction helpers for real producers (SP1 1b-1d)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Incremental timeline merge + Ctx.out_dir (Python)

**Files:**
- Modify: `perception/clipforge_perception/pipeline.py`
- Modify: `perception/clipforge_perception/producers/base.py`
- Test: `perception/tests/test_pipeline_merge.py`

**Interfaces:**
- Consumes: `schema.validate`, `schema.empty_timeline` (existing).
- Produces: `analyze()` now starts from an existing valid timeline at `--out` (same duration ±0.5s) instead of an empty one, and `producers_run` becomes the union of prior + newly-run producers. `Ctx` gains `out_dir: str = "."` (the directory of the out JSON — Task 5's CLIP producer writes embedding sidecars relative to it). Task 7's Node client relies on this merge to request only missing producers.

- [ ] **Step 1: Write the failing tests**

```python
# perception/tests/test_pipeline_merge.py
import json
from pathlib import Path

from clipforge_perception import pipeline, schema


def test_analyze_merges_into_existing_timeline(tiny_video, tmp_path):
    out = tmp_path / "job1" / "semantic_timeline.json"
    out.parent.mkdir(parents=True)
    # Existing cached timeline from an earlier run of a fictional producer.
    import subprocess
    duration = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", tiny_video],
        capture_output=True, text=True, check=True).stdout.strip())
    prior = schema.empty_timeline("job1", duration, 2.0)
    prior["producers_run"] = ["prior"]
    prior["speakers"] = [{"id": "S9", "turns": [{"start": 0.0, "end": 1.0}]}]
    out.write_text(json.dumps(prior))

    rc = pipeline.analyze(tiny_video, str(out), ["mock"], 2.0, "job1")
    assert rc == 0
    merged = json.loads(out.read_text())
    assert set(merged["producers_run"]) == {"prior", "mock"}
    # mock overwrote the speakers layer (it ran later), scenes/audio_events also filled
    assert merged["speakers"] and merged["speakers"][0]["id"] == "S0"


def test_analyze_ignores_existing_with_wrong_duration(tiny_video, tmp_path):
    out = tmp_path / "job2" / "semantic_timeline.json"
    out.parent.mkdir(parents=True)
    stale = schema.empty_timeline("job2", 9999.0, 2.0)
    stale["producers_run"] = ["prior"]
    out.write_text(json.dumps(stale))

    rc = pipeline.analyze(tiny_video, str(out), ["mock"], 2.0, "job2")
    assert rc == 0
    merged = json.loads(out.read_text())
    assert merged["producers_run"] == ["mock"]  # stale cache discarded, fresh start


def test_analyze_ignores_corrupt_existing(tiny_video, tmp_path):
    out = tmp_path / "job3" / "semantic_timeline.json"
    out.parent.mkdir(parents=True)
    out.write_text("{not json")
    rc = pipeline.analyze(tiny_video, str(out), ["mock"], 2.0, "job3")
    assert rc == 0
    assert json.loads(out.read_text())["producers_run"] == ["mock"]


def test_ctx_carries_out_dir(tiny_video, tmp_path, monkeypatch):
    from clipforge_perception.producers.base import Ctx
    seen = {}

    class SpyProducer:
        name = "spy"
        def run(self, video: str, ctx: Ctx) -> dict:
            seen["out_dir"] = ctx.out_dir
            return {}

    monkeypatch.setitem(pipeline.PRODUCERS, "spy", SpyProducer)
    out = tmp_path / "job4" / "semantic_timeline.json"
    rc = pipeline.analyze(tiny_video, str(out), ["spy"], 2.0, "job4")
    assert rc == 0
    assert Path(seen["out_dir"]).resolve() == out.parent.resolve()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_pipeline_merge.py -v`
Expected: FAIL — merge test sees `producers_run == ["mock"]` (no union), Ctx test fails with `TypeError`/`AttributeError` on `out_dir`.

- [ ] **Step 3: Implement**

In `perception/clipforge_perception/producers/base.py`, extend `Ctx`:

```python
@dataclass
class Ctx:
    duration: float
    # Reserved for future frame-sampling producers (object/depth/VLM layers). MockProducer only
    # reads ctx.duration; sample_fps is plumbed through now so the Producer contract is stable.
    sample_fps: float
    # Directory of the out JSON — producers that write sidecar files (CLIP embeddings) anchor
    # relative refs like "clip/0.f32" here.
    out_dir: str = "."
```

In `perception/clipforge_perception/pipeline.py`, replace the body of `analyze` (keep the signature) with:

```python
def _load_existing(out_path: Path, duration: float) -> dict | None:
    """A prior timeline at out_path is the merge base iff it is schema-valid and belongs to
    the same source (duration within 0.5s). Anything else → start fresh."""
    if not out_path.exists():
        return None
    try:
        data = json.loads(out_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    if schema.validate(data):
        return None
    if abs(float(data.get("duration", -1.0)) - duration) > 0.5:
        return None
    return data


def analyze(video: str, out: str, models: list[str], sample_fps: float, job_id: str) -> int:
    if not Path(video).exists():
        print(f"error: video not found: {video}", file=sys.stderr)
        return 2

    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)  # before producers: CLIP writes sidecars here
    duration = ffmpeg.probe_duration(video)
    ctx = Ctx(duration=duration, sample_fps=sample_fps, out_dir=str(out_path.parent))
    # Incremental: an existing valid timeline for the same source is the merge base, so Node
    # can request only the producers whose layers are missing (producer-level caching).
    timeline = _load_existing(out_path, duration) or schema.empty_timeline(job_id, duration, sample_fps)
    prior_run = list(timeline["producers_run"])

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
    timeline["producers_run"] = prior_run + [n for n in ran if n not in prior_run]

    errors = schema.validate(timeline)
    if errors:
        print("error: produced timeline is invalid:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 1

    out_path.write_text(json.dumps(timeline, indent=2))
    return 0
```

- [ ] **Step 4: Run ALL Python tests (merge change touches the pipeline everything uses)**

Run: `perception/.venv/bin/python -m pytest perception/tests/ -v`
Expected: all pass (new + existing CLI/mock/schema tests)

- [ ] **Step 5: Commit**

```bash
git add perception/clipforge_perception/pipeline.py perception/clipforge_perception/producers/base.py perception/tests/test_pipeline_merge.py
git commit -m "feat(perception): incremental timeline merge + Ctx.out_dir (SP1 1b-1d)

An existing valid timeline for the same source is the merge base, so Node can
request only missing producers instead of re-running everything.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PyAnnote diarization producer (Phase 1b)

**Files:**
- Create: `perception/clipforge_perception/producers/pyannote_diar.py`
- Modify: `perception/clipforge_perception/pipeline.py` (registry)
- Modify: `perception/pyproject.toml` (start the `real` extra)
- Test: `perception/tests/test_pyannote_producer.py`

**Interfaces:**
- Consumes: `ffmpeg.extract_wav_16k` (Task 1), `schema.Span/Speaker/speaker_to_dict`.
- Produces: `PyannoteDiarizationProducer` (name `"pyannote"`, returns `{"speakers": [...]}`), pure `annotation_to_speakers(annotation) -> list[dict]`, and `warm() -> str` (Task 6's warm command calls it). Registry key `"pyannote"`.

- [ ] **Step 1: Write the failing tests** (pure conversion + no-token behavior; the real model is NOT loaded in unit tests)

```python
# perception/tests/test_pyannote_producer.py
import pytest

from clipforge_perception.producers.pyannote_diar import (
    PyannoteDiarizationProducer, annotation_to_speakers,
)
from clipforge_perception.producers.base import Ctx


class _Seg:
    def __init__(self, start, end):
        self.start, self.end = start, end


class _FakeAnnotation:
    """Duck-types pyannote.core.Annotation.itertracks(yield_label=True)."""
    def __init__(self, tracks):
        self._tracks = tracks

    def itertracks(self, yield_label=False):
        for start, end, label in self._tracks:
            yield _Seg(start, end), None, label


def test_annotation_to_speakers_groups_and_relabels_by_first_appearance():
    ann = _FakeAnnotation([
        (5.0, 8.0, "SPEAKER_01"),
        (0.0, 4.5, "SPEAKER_00"),
        (9.0, 12.0, "SPEAKER_01"),
    ])
    speakers = annotation_to_speakers(ann)
    # first appearance order: SPEAKER_01 spoke first in iteration order → S0
    assert [s["id"] for s in speakers] == ["S0", "S1"]
    assert speakers[0]["turns"] == [{"start": 5.0, "end": 8.0}, {"start": 9.0, "end": 12.0}]
    assert speakers[1]["turns"] == [{"start": 0.0, "end": 4.5}]


def test_annotation_to_speakers_rounds_to_ms():
    ann = _FakeAnnotation([(0.123456, 1.987654, "A")])
    speakers = annotation_to_speakers(ann)
    assert speakers[0]["turns"] == [{"start": 0.123, "end": 1.988}]


def test_missing_hf_token_raises_clear_message(monkeypatch, tiny_video):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="HF_TOKEN"):
        PyannoteDiarizationProducer().run(tiny_video, Ctx(duration=5.0, sample_fps=2.0))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_pyannote_producer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'clipforge_perception.producers.pyannote_diar'`

- [ ] **Step 3: Implement the producer**

```python
# perception/clipforge_perception/producers/pyannote_diar.py
"""PyAnnote speaker diarization (Phase 1b) — real speaker turns for the `speakers` layer.

Model: pyannote/speaker-diarization-3.1 (gated on Hugging Face). Requires a free HF_TOKEN
in the environment AND one-time acceptance of the model terms at:
  https://hf.co/pyannote/speaker-diarization-3.1
  https://hf.co/pyannote/segmentation-3.0
No token → a clear RuntimeError; the pipeline catches it, omits the layer, and the run
still succeeds (fail-soft contract).
"""

from __future__ import annotations

import os
import tempfile

from .. import ffmpeg
from ..schema import Span, Speaker, speaker_to_dict
from .base import Ctx

MODEL = "pyannote/speaker-diarization-3.1"
_TOKEN_HINT = (
    "HF_TOKEN not set — create a free token at hf.co/settings/tokens, add HF_TOKEN=… to "
    ".env, and accept the model terms at hf.co/pyannote/speaker-diarization-3.1 and "
    "hf.co/pyannote/segmentation-3.0"
)


def annotation_to_speakers(annotation) -> list[dict]:
    """PURE: pyannote Annotation → speakers layer. Labels renamed S0..Sn by first appearance."""
    turns: dict[str, list[Span]] = {}
    order: list[str] = []
    for segment, _, label in annotation.itertracks(yield_label=True):
        if label not in turns:
            turns[label] = []
            order.append(label)
        turns[label].append(Span(start=round(segment.start, 3), end=round(segment.end, 3)))
    return [
        speaker_to_dict(Speaker(id=f"S{i}", turns=turns[label]))
        for i, label in enumerate(order)
    ]


def _load_pipeline():
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError(_TOKEN_HINT)
    from pyannote.audio import Pipeline  # lazy: torch import only when selected

    return Pipeline.from_pretrained(MODEL, use_auth_token=token)


def warm() -> str:
    """Download/caches the model. Returns a human-readable status line."""
    _load_pipeline()
    return f"pyannote: {MODEL} ready"


class PyannoteDiarizationProducer:
    name = "pyannote"

    def run(self, video: str, ctx: Ctx) -> dict:
        if not ffmpeg.has_audio_stream(video):
            return {"speakers": []}
        pipe = _load_pipeline()
        with tempfile.TemporaryDirectory() as td:
            wav = ffmpeg.extract_wav_16k(video, os.path.join(td, "audio.wav"))
            annotation = pipe(wav)
        return {"speakers": annotation_to_speakers(annotation)}
```

Register it in `perception/clipforge_perception/pipeline.py`:

```python
from .producers.mock import MockProducer
from .producers.pyannote_diar import PyannoteDiarizationProducer

PRODUCERS = {"mock": MockProducer, "pyannote": PyannoteDiarizationProducer}
```

(The class import is light — `pyannote.audio` is only imported inside `_load_pipeline`.)

Add the `real` extra to `perception/pyproject.toml`:

```toml
[project.optional-dependencies]
dev = ["pytest>=7.0"]
real = [
  "pyannote.audio>=3.1,<4",
  "torch>=2.1",
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_pyannote_producer.py -v`
Expected: 3 passed (no model download — pure functions + token guard only)

- [ ] **Step 5: Commit**

```bash
git add perception/clipforge_perception/producers/pyannote_diar.py perception/clipforge_perception/pipeline.py perception/pyproject.toml perception/tests/test_pyannote_producer.py
git commit -m "feat(perception): PyAnnote diarization producer — real speaker turns (SP1 1b)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: YAMNet audio-events producer (Phase 1c, Python side)

**Files:**
- Create: `perception/clipforge_perception/producers/yamnet_events.py`
- Modify: `perception/clipforge_perception/pipeline.py` (registry)
- Modify: `perception/pyproject.toml` (extend `real` extra)
- Test: `perception/tests/test_yamnet_producer.py`

**Interfaces:**
- Consumes: `ffmpeg.extract_wav_16k`, `schema.AudioEvent/event_to_dict`.
- Produces: `YamnetEventsProducer` (name `"yamnet"`, returns `{"audio_events": [...]}`), pure `frames_to_events(scores, class_names, hop, patch, score_min) -> list[dict]`, `warm() -> str`. Registry key `"yamnet"`. Kinds emitted are exactly the schema enum values `laughter|applause|cheer|impact|music|speech` (never `other` — unmapped classes are dropped).

- [ ] **Step 1: Write the failing tests** (pure frame→event logic on synthetic score matrices)

```python
# perception/tests/test_yamnet_producer.py
from clipforge_perception.producers.yamnet_events import KIND_MAP, frames_to_events

# Build a tiny fake class table: index 0 = Speech, 1 = Laughter, 2 = Applause, 3 = Zither (unmapped)
NAMES = ["Speech", "Laughter", "Applause", "Zither"]
HOP, PATCH = 0.48, 0.96


def test_frames_to_events_merges_consecutive_frames_of_same_kind():
    scores = [
        [0.0, 0.9, 0.0, 0.0],   # t=0.00 laughter
        [0.0, 0.8, 0.0, 0.0],   # t=0.48 laughter (merges)
        [0.0, 0.1, 0.0, 0.0],   # t=0.96 below threshold → gap
        [0.0, 0.0, 0.7, 0.0],   # t=1.44 applause
    ]
    events = frames_to_events(scores, NAMES, hop=HOP, patch=PATCH, score_min=0.35)
    assert [e["kind"] for e in events] == ["laughter", "applause"]
    laugh = events[0]
    assert laugh["start"] == 0.0
    assert laugh["end"] == round(1 * HOP + PATCH, 3)   # last merged frame start + patch
    assert laugh["score"] == 0.9                        # max over merged frames


def test_frames_to_events_ignores_unmapped_classes_and_clamps_score():
    scores = [[0.0, 0.0, 0.0, 0.99]]      # Zither only → nothing
    assert frames_to_events(scores, NAMES, hop=HOP, patch=PATCH, score_min=0.35) == []
    scores = [[1.7, 0.0, 0.0, 0.0]]       # over-1 model output must clamp to 1.0
    ev = frames_to_events(scores, NAMES, hop=HOP, patch=PATCH, score_min=0.35)
    assert ev[0]["kind"] == "speech" and ev[0]["score"] == 1.0


def test_kind_map_targets_are_schema_enum_values():
    assert set(KIND_MAP.values()) <= {"laughter", "applause", "cheer", "impact", "music", "speech"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_yamnet_producer.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement the producer**

```python
# perception/clipforge_perception/producers/yamnet_events.py
"""YAMNet audio events (Phase 1c) — laughter/applause/cheer/impact/music/speech for the
`audio_events` layer. Model: https://tfhub.dev/google/yamnet/1 (521 AudioSet classes,
0.96s patches, 0.48s hop, 16kHz mono input). Only mapped classes are emitted; everything
else is dropped (the schema's `other` kind stays unused by this producer)."""

from __future__ import annotations

import csv
import os
import tempfile
import wave

from .. import ffmpeg
from ..schema import AudioEvent, event_to_dict
from .base import Ctx

MODEL_URL = "https://tfhub.dev/google/yamnet/1"
SCORE_MIN = 0.35
HOP_SEC = 0.48
PATCH_SEC = 0.96

# AudioSet display_name → semantic-timeline kind. Names must match yamnet_class_map.csv.
KIND_MAP = {
    "Laughter": "laughter", "Giggle": "laughter", "Chuckle, chortle": "laughter",
    "Snicker": "laughter", "Belly laugh": "laughter",
    "Applause": "applause", "Clapping": "applause",
    "Cheering": "cheer", "Crowd": "cheer",
    "Thump, thud": "impact", "Bang": "impact", "Slam": "impact",
    "Smash, crash": "impact", "Explosion": "impact", "Boom": "impact",
    "Music": "music",
    "Speech": "speech",
}


def frames_to_events(scores, class_names: list[str], hop: float = HOP_SEC,
                     patch: float = PATCH_SEC, score_min: float = SCORE_MIN) -> list[dict]:
    """PURE: per-frame class scores → merged audio events.

    Per frame: the best-scoring MAPPED class wins if ≥ score_min. Consecutive frames of the
    same kind merge into one event (start = first frame start, end = last frame start + patch,
    score = max, clamped to [0,1])."""
    mapped_cols = [(i, KIND_MAP[n]) for i, n in enumerate(class_names) if n in KIND_MAP]
    events: list[AudioEvent] = []
    for f, row in enumerate(scores):
        best_kind, best_score = None, 0.0
        for col, kind in mapped_cols:
            if row[col] > best_score:
                best_kind, best_score = kind, float(row[col])
        if best_kind is None or best_score < score_min:
            continue
        t = f * hop
        score = min(1.0, best_score)
        last = events[-1] if events else None
        if last is not None and last.kind == best_kind and t <= last.end + 1e-6:
            last.end = round(t + patch, 3)
            last.score = max(last.score, score)
        else:
            events.append(AudioEvent(start=round(t, 3), end=round(t + patch, 3),
                                     kind=best_kind, score=score))
    return [event_to_dict(e) for e in events]


def _load_model():
    import tensorflow_hub as hub  # lazy: TF import only when selected

    return hub.load(MODEL_URL)


def warm() -> str:
    _load_model()
    return f"yamnet: {MODEL_URL} ready"


def _read_wav_f32(path: str):
    import numpy as np

    with wave.open(path) as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


class YamnetEventsProducer:
    name = "yamnet"

    def run(self, video: str, ctx: Ctx) -> dict:
        if not ffmpeg.has_audio_stream(video):
            return {"audio_events": []}
        model = _load_model()
        with tempfile.TemporaryDirectory() as td:
            wav = ffmpeg.extract_wav_16k(video, os.path.join(td, "audio.wav"))
            waveform = _read_wav_f32(wav)
        scores, _, _ = model(waveform)
        class_map = model.class_map_path().numpy().decode()
        with open(class_map, newline="") as fh:
            class_names = [row["display_name"] for row in csv.DictReader(fh)]
        events = frames_to_events(scores.numpy(), class_names)
        # events can run past EOF by up to a patch — clamp to the real duration
        for e in events:
            e["end"] = min(e["end"], round(ctx.duration, 3))
        return {"audio_events": [e for e in events if e["end"] - e["start"] > 0.05]}
```

Register in `pipeline.py`:

```python
from .producers.yamnet_events import YamnetEventsProducer

PRODUCERS = {"mock": MockProducer, "pyannote": PyannoteDiarizationProducer,
             "yamnet": YamnetEventsProducer}
```

Extend the `real` extra in `perception/pyproject.toml`:

```toml
real = [
  "pyannote.audio>=3.1,<4",
  "torch>=2.1",
  "tensorflow>=2.16",
  "tensorflow-hub>=0.16",
  "numpy>=1.26",
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_yamnet_producer.py -v`
Expected: 3 passed (pure function only — no TF import)

- [ ] **Step 5: Commit**

```bash
git add perception/clipforge_perception/producers/yamnet_events.py perception/clipforge_perception/pipeline.py perception/pyproject.toml perception/tests/test_yamnet_producer.py
git commit -m "feat(perception): YAMNet audio-events producer — laughter/applause/impact (SP1 1c)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: CLIP scenes producer (Phase 1d, Python side)

**Files:**
- Create: `perception/clipforge_perception/producers/clip_scenes.py`
- Modify: `perception/clipforge_perception/pipeline.py` (registry)
- Modify: `perception/pyproject.toml` (extend `real` extra)
- Test: `perception/tests/test_clip_producer.py`

**Interfaces:**
- Consumes: `ffmpeg.scene_cut_times`, `ffmpeg.extract_frame` (Task 1), `Ctx.out_dir` (Task 2), `schema.Scene/scene_to_dict`.
- Produces: `ClipScenesProducer` (name `"clip"`, returns `{"scenes": [...]}` with real labels + `embedding_ref` like `"clip/0.f32"`), pure `pick_label(sims: list[float], labels: list[str]) -> str`, `write_embedding(path, vec) -> None` (little-endian f32 sidecar), `spans_from_cuts(cuts, duration) -> list[tuple]`, `warm() -> str`. Registry key `"clip"`. Node's Slice B fallback (Task 10) treats any label NOT matching `/^scene \d+$/` as a real visual topic — labels here are natural-language phrases so they qualify.

- [ ] **Step 1: Write the failing tests**

```python
# perception/tests/test_clip_producer.py
import struct
from pathlib import Path

from clipforge_perception.producers.clip_scenes import (
    SCENE_LABELS, pick_label, spans_from_cuts, write_embedding,
)


def test_pick_label_returns_argmax_label():
    sims = [0.1, 0.9, 0.3]
    assert pick_label(sims, ["a", "b", "c"]) == "b"


def test_scene_labels_are_natural_phrases_not_generic():
    import re
    assert len(SCENE_LABELS) >= 20
    assert all(not re.fullmatch(r"scene \d+", l) for l in SCENE_LABELS)


def test_write_embedding_roundtrips_little_endian_f32(tmp_path):
    vec = [1.5, -2.25, 0.0]
    path = tmp_path / "clip" / "0.f32"
    write_embedding(str(path), vec)
    raw = Path(path).read_bytes()
    assert struct.unpack("<3f", raw) == (1.5, -2.25, 0.0)


def test_spans_from_cuts_bounds_and_filters_slivers():
    assert spans_from_cuts([2.5, 2.52], 5.0) == [(0.0, 2.5), (2.52, 5.0)]  # 20ms sliver dropped
    assert spans_from_cuts([], 5.0) == [(0.0, 5.0)]                        # no cuts → one scene
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_clip_producer.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement the producer**

```python
# perception/clipforge_perception/producers/clip_scenes.py
"""CLIP scene labels + embeddings (Phase 1d) — the `scenes` layer with a real visual label
per scene-cut segment and a per-scene image embedding written as a sidecar
(<out_dir>/clip/<i>.f32, little-endian f32, referenced by embedding_ref).

Model: open_clip ViT-B-32 / 'openai' weights (zero-shot over SCENE_LABELS)."""

from __future__ import annotations

import struct
import tempfile
from pathlib import Path

from .. import ffmpeg
from ..schema import Scene, scene_to_dict
from .base import Ctx

MODEL_NAME = "ViT-B-32"
PRETRAINED = "openai"
PROMPT = "a video frame of {}"
MIN_SCENE_SEC = 0.05

# Zero-shot label bank tuned to creator content — natural phrases on purpose: Node's Slice B
# topic fallback ignores generic /^scene \d+$/ labels (the mock's), so these must never look
# like that.
SCENE_LABELS = [
    "a podcast studio conversation", "an interview on stage", "a person talking to the camera",
    "a gaming screen with gameplay", "a live stream reaction facecam", "a gym workout",
    "a sports arena or stadium", "a basketball court", "a soccer field",
    "a street interview outdoors", "a busy city street", "a car interior",
    "a cooking kitchen", "a restaurant meal", "an outdoor vlog in nature",
    "a beach or pool", "a stage performance or concert", "a crowd celebrating",
    "a classroom or lecture", "an office desk with a computer", "a whiteboard presentation",
    "a boxing or mma fight", "people laughing together", "a person crying or emotional",
    "a product unboxing on a table", "money or cash on display", "a luxury car exterior",
    "a private jet or airport", "a hospital or medical setting", "a courtroom",
    "an animated cartoon", "a screenshot of a phone app", "text on a plain background",
]


def spans_from_cuts(cuts: list[float], duration: float) -> list[tuple[float, float]]:
    """PURE: cut times → (start, end) scene spans, slivers under MIN_SCENE_SEC dropped."""
    bounds = [0.0, *sorted(t for t in cuts if 0.0 < t < duration), duration]
    spans = [
        (round(bounds[i], 3), round(bounds[i + 1], 3))
        for i in range(len(bounds) - 1)
        if bounds[i + 1] - bounds[i] > MIN_SCENE_SEC
    ]
    return spans or [(0.0, round(duration, 3))]


def pick_label(sims: list[float], labels: list[str]) -> str:
    """PURE: argmax similarity → label."""
    best = max(range(len(sims)), key=lambda i: sims[i])
    return labels[best]


def write_embedding(path: str, vec) -> None:
    """Write a little-endian f32 sidecar (creates parent dirs)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    floats = [float(x) for x in vec]
    p.write_bytes(struct.pack(f"<{len(floats)}f", *floats))


def _load_model():
    import open_clip  # lazy: torch import only when selected

    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    model.eval()
    return model, preprocess, tokenizer


def warm() -> str:
    _load_model()
    return f"clip: {MODEL_NAME}/{PRETRAINED} ready"


class ClipScenesProducer:
    name = "clip"

    def run(self, video: str, ctx: Ctx) -> dict:
        import torch
        from PIL import Image

        model, preprocess, tokenizer = _load_model()
        with torch.no_grad():
            text_feat = model.encode_text(tokenizer([PROMPT.format(l) for l in SCENE_LABELS]))
            text_feat /= text_feat.norm(dim=-1, keepdim=True)

        spans = spans_from_cuts(ffmpeg.scene_cut_times(video), ctx.duration)
        scenes: list[dict] = []
        with tempfile.TemporaryDirectory() as td:
            for i, (start, end) in enumerate(spans):
                frame = ffmpeg.extract_frame(video, (start + end) / 2, f"{td}/{i}.jpg")
                image = preprocess(Image.open(frame)).unsqueeze(0)
                with torch.no_grad():
                    feat = model.encode_image(image)
                    feat /= feat.norm(dim=-1, keepdim=True)
                sims = (feat @ text_feat.T).squeeze(0).tolist()
                ref = f"clip/{i}.f32"
                write_embedding(str(Path(ctx.out_dir) / ref), feat.squeeze(0).tolist())
                scenes.append(scene_to_dict(Scene(
                    start=start, end=end,
                    label=pick_label(sims, SCENE_LABELS), embedding_ref=ref,
                )))
        return {"scenes": scenes}
```

Register in `pipeline.py`:

```python
from .producers.clip_scenes import ClipScenesProducer

PRODUCERS = {"mock": MockProducer, "pyannote": PyannoteDiarizationProducer,
             "yamnet": YamnetEventsProducer, "clip": ClipScenesProducer}
```

Extend the `real` extra in `perception/pyproject.toml` (final form):

```toml
real = [
  "pyannote.audio>=3.1,<4",
  "torch>=2.1",
  "tensorflow>=2.16",
  "tensorflow-hub>=0.16",
  "numpy>=1.26",
  "open-clip-torch>=2.24",
  "pillow>=10",
]
```

- [ ] **Step 4: Run the full Python lane**

Run: `perception/.venv/bin/python -m pytest perception/tests/ -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add perception/clipforge_perception/producers/clip_scenes.py perception/clipforge_perception/pipeline.py perception/pyproject.toml perception/tests/test_clip_producer.py
git commit -m "feat(perception): CLIP scenes producer — zero-shot labels + embedding sidecars (SP1 1d)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `warm` subcommand + perception-setup + docs

**Files:**
- Modify: `perception/clipforge_perception/cli.py`
- Modify: `start.sh`
- Modify: `perception/README.md` (HF token section)
- Modify: `docs/DEPENDENCIES.md` (new deps table rows)
- Test: `perception/tests/test_cli.py` (extend)

**Interfaces:**
- Consumes: `warm()` from each real producer module (Tasks 3-5).
- Produces: `clipforge-perception warm --models pyannote,yamnet,clip` — pre-downloads model weights, prints one status line per model, per-model failure prints a warning and continues, always exits 0. `./start.sh perception-setup` installs `.[dev,real]` and calls `warm`.

- [ ] **Step 1: Write the failing test** (registry-driven, monkeypatched — no real downloads)

Append to `perception/tests/test_cli.py`:

```python
def test_warm_reports_per_model_and_survives_failure(monkeypatch, capsys):
    from clipforge_perception import cli

    def ok():
        return "fake: ready"

    def boom():
        raise RuntimeError("no token")

    monkeypatch.setattr(cli, "WARMERS", {"good": ok, "bad": boom})
    monkeypatch.setattr("sys.argv", ["clipforge-perception", "warm", "--models", "good,bad,unknown"])
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 0          # per-model failure must NOT fail the command
    captured = capsys.readouterr()
    combined = captured.err + captured.out
    assert "fake: ready" in combined
    assert "no token" in combined
    assert "unknown" in combined
```

- [ ] **Step 2: Run test to verify it fails**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_cli.py -v -k warm`
Expected: FAIL with `AttributeError: ... has no attribute 'WARMERS'`

- [ ] **Step 3: Implement the warm subcommand**

In `perception/clipforge_perception/cli.py`, add a lazy warmer registry and the subparser:

```python
def _warm_pyannote():
    from .producers import pyannote_diar
    return pyannote_diar.warm()


def _warm_yamnet():
    from .producers import yamnet_events
    return yamnet_events.warm()


def _warm_clip():
    from .producers import clip_scenes
    return clip_scenes.warm()


WARMERS = {"pyannote": _warm_pyannote, "yamnet": _warm_yamnet, "clip": _warm_clip}
```

In `main()`, after the existing `analyze` subparser:

```python
    warm = sub.add_parser("warm", help="pre-download model weights for the real producers")
    warm.add_argument("--models", default="pyannote,yamnet,clip")
```

And handle it (before the `analyze` branch's `sys.exit`):

```python
    if args.command == "warm":
        for name in [m.strip() for m in args.models.split(",") if m.strip()]:
            fn = WARMERS.get(name)
            if fn is None:
                print(f"warning: unknown model '{name}' — skipped", file=sys.stderr)
                continue
            try:
                print(fn(), file=sys.stderr)
            except Exception as exc:  # warm is best-effort; setup must not hard-fail
                print(f"warning: warm '{name}' failed ({exc})", file=sys.stderr)
        sys.exit(0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `perception/.venv/bin/python -m pytest perception/tests/test_cli.py -v`
Expected: all pass

- [ ] **Step 5: Update `start.sh` perception-setup**

Replace the perception-setup block body (keep the guard checks) with:

```bash
if [ "${1:-}" = "perception-setup" ]; then
  command -v ffmpeg >/dev/null || fail "ffmpeg not found — brew install ffmpeg"
  # TF/torch wheels lag the newest python — prefer 3.12 when present.
  PY=python3; command -v python3.12 >/dev/null && PY=python3.12
  command -v "$PY" >/dev/null || fail "python3 not found — install Python 3.10+ (brew install python@3.12)"
  if command -v uv >/dev/null; then
    say "Setting up perception service with uv (perception/.venv)…"
    (cd perception && { [ -d .venv ] || uv venv --python "$PY" .venv; } && uv pip install --python .venv/bin/python -e ".[dev,real]")
  else
    say "Setting up perception service with venv+pip (perception/.venv)…"
    [ -d perception/.venv ] || "$PY" -m venv perception/.venv
    perception/.venv/bin/pip install --upgrade pip >/dev/null
    perception/.venv/bin/pip install -e "perception[dev,real]"
  fi
  # HF_TOKEN (free) unlocks pyannote diarization; yamnet/clip warm without it.
  if [ -f .env ] && grep -qE '^HF_TOKEN=.+' .env; then
    export "$(grep -E '^HF_TOKEN=.+' .env | head -1)"
  else
    echo "  ${dim}No HF_TOKEN in .env — pyannote diarization will be skipped. Get a free token at"
    echo "  hf.co/settings/tokens and accept the terms at hf.co/pyannote/speaker-diarization-3.1"
    echo "  and hf.co/pyannote/segmentation-3.0, then re-run ./start.sh perception-setup.${reset}"
  fi
  say "Pre-downloading models (first run only — this can take several minutes)…"
  perception/.venv/bin/clipforge-perception warm || true
  say "Perception ready. Verify: perception/.venv/bin/clipforge-perception --help"
  exit 0
fi
```

- [ ] **Step 6: Docs**

`perception/README.md`: add a "Real producers (Phase 1b-1d)" section — the three producers, what layer each fills, the HF-token steps (token + accepting both model pages), and that everything is fail-soft (no token → speakers layer stays mock/empty).

`docs/DEPENDENCIES.md`: add rows for `pyannote.audio`, `torch`, `tensorflow`, `tensorflow-hub`, `numpy`, `open-clip-torch`, `pillow` — all under a "perception venv only (never in Node's package.json)" note, each with one-line purpose.

- [ ] **Step 7: Verify setup script parses**

Run: `bash -n start.sh`
Expected: no output (syntax OK)

- [ ] **Step 8: Commit**

```bash
git add perception/clipforge_perception/cli.py perception/tests/test_cli.py start.sh perception/README.md docs/DEPENDENCIES.md
git commit -m "feat(perception): warm subcommand + perception-setup installs real producers (SP1 1b-1d)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Node — spawn only missing producers, default to real models

**Files:**
- Modify: `src/perception/subprocessClient.ts`
- Test: `tests/perception/subprocessClient.test.ts` (extend; update any test asserting the old `--models mock` default)

**Interfaces:**
- Consumes: Python-side incremental merge (Task 2) — spawning with a subset of models preserves other producers' cached layers.
- Produces: `SubprocessPerceptionClient` default `models` becomes `['mock', 'pyannote', 'yamnet', 'clip']` (mock stays FIRST so real producers overwrite its placeholder layers, and remains the fallback when a real producer fails). Cache hit requires all requested models in `producers_run`; a partial cache spawns with `--models <missing only>`. Tasks 8-10 need no client changes.

- [ ] **Step 1: Write the failing tests** (follow the existing fake-`run` pattern in this test file)

Add to `tests/perception/subprocessClient.test.ts` (adapt imports/helpers to the file's existing style — it already fakes `run` and pre-writes timelines):

```ts
it('spawns only the missing producers when the cache is partial', async () => {
  // pre-write a valid timeline with producers_run: ['mock']  (existing helper pattern)
  // fake run records its argv and writes the timeline back with all four producers_run
  const calls: string[][] = [];
  const client = new SubprocessPerceptionClient({
    workspaceDir: ws,
    run: async (_cmd, args) => {
      calls.push(args);
      writeTimeline(ws, 'job1', ['mock', 'pyannote', 'yamnet', 'clip']);
      return { stdout: '', stderr: '' } as never;
    },
  });
  const result = await client.analyze('/v.mp4', 'job1');
  expect(result?.producers_run).toEqual(['mock', 'pyannote', 'yamnet', 'clip']);
  const modelsArg = calls[0][calls[0].indexOf('--models') + 1];
  expect(modelsArg).toBe('pyannote,yamnet,clip'); // mock already cached — not re-run
});

it('cache hit requires ALL requested models', async () => {
  writeTimeline(ws, 'job2', ['mock', 'pyannote', 'yamnet', 'clip']);
  const client = new SubprocessPerceptionClient({
    workspaceDir: ws,
    run: async () => { throw new Error('must not spawn'); },
  });
  const result = await client.analyze('/v.mp4', 'job2');
  expect(result?.producers_run).toContain('clip');
});

it('defaults to mock plus the three real producers (no cache → full default list)', async () => {
  const calls: string[][] = [];
  const client = new SubprocessPerceptionClient({
    workspaceDir: ws,
    run: async (_cmd, args) => {
      calls.push(args);
      writeTimeline(ws, 'job3', ['mock', 'pyannote', 'yamnet', 'clip']);
      return { stdout: '', stderr: '' } as never;
    },
  });
  await client.analyze('/v.mp4', 'job3');
  const modelsArg = calls[0][calls[0].indexOf('--models') + 1];
  expect(modelsArg).toBe('mock,pyannote,yamnet,clip');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/perception/subprocessClient.test.ts`
Expected: FAIL — spawn arg is `mock` (old default), partial cache triggers full re-run.

- [ ] **Step 3: Implement**

In `src/perception/subprocessClient.ts`:

```ts
const DEFAULT_MODELS = ['mock', 'pyannote', 'yamnet', 'clip']; // mock first: real layers overwrite it
```

Constructor: `this.models = opts.models ?? DEFAULT_MODELS;`

In `analyze`, replace the cache-check block:

```ts
    const cached = this.readValid(outPath);
    const missing = cached
      ? this.models.filter((m) => !cached.producers_run.includes(m))
      : this.models;
    if (cached && missing.length === 0) {
      logger.info(`[${jobId}] perception cache hit (${cached.producers_run.join(',') || 'none'})`);
      return cached;
    }
    if (cached) {
      logger.info(`[${jobId}] perception cache partial (${cached.producers_run.join(',')}) — running ${missing.join(',')}`);
    }
```

…and pass `missing` (not `this.models`) to the spawn:

```ts
        '--models', missing.join(','),
```

(The Python pipeline merges into the existing file, so the returned timeline carries both old and new layers. A producer that persistently fails — e.g. pyannote without HF_TOKEN — is retried each run by design: its layer is enrichment and the retry is cheap relative to the producers that DID cache.)

- [ ] **Step 4: Run the Node gates**

Run: `npx vitest run tests/perception/ && npx tsc --noEmit`
Expected: all pass, tsc clean

- [ ] **Step 5: Commit**

```bash
git add src/perception/subprocessClient.ts tests/perception/subprocessClient.test.ts
git commit -m "feat(perception): client spawns only missing producers; real models by default (SP1 1b-1d)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: audio_events → Slice E audience-reaction candidates

**Files:**
- Modify: `src/director/arcTemplates.ts`
- Modify: `src/cli/commands/all.ts` (the `generateArcTemplateCandidates` call, currently at ~line 317)
- Test: `tests/director/arcTemplates.test.ts` (extend)

**Interfaces:**
- Consumes: `AudioEvent` type from `src/perception/timeline.js`; `perception` (SemanticTimeline | null) already returned by `analyzeVideo`.
- Produces: `detectAudienceReactionCandidates(events, triggers, audio, lengths, duration): ClipCandidate[]`; `generateArcTemplateCandidates` gains a final optional param `audioEvents: AudioEvent[] = []`. Constants `TEMPLATE_AUDIENCE_BONUS = 1.5`, `AUDIENCE_SCORE_MIN = 0.5`, `AUDIENCE_MAX_CANDIDATES = 12`. With `[]` (perception off) behavior is bit-identical to today.

- [ ] **Step 1: Write the failing tests**

Add to `tests/director/arcTemplates.test.ts` (reuse the file's existing fixture helpers for triggers/audio/lengths):

```ts
import { detectAudienceReactionCandidates, generateArcTemplateCandidates, TEMPLATE_AUDIENCE_BONUS } from '../../src/director/arcTemplates.js';
import type { AudioEvent } from '../../src/perception/timeline.js';

const LAUGH = (start: number, score = 0.8): AudioEvent =>
  ({ start, end: start + 1.5, kind: 'laughter', score });

describe('detectAudienceReactionCandidates', () => {
  it('anchors a candidate on a strong laughter event (setup before, tail after)', () => {
    const out = detectAudienceReactionCandidates([LAUGH(60)], [], emptyAudio, lengths, 300);
    expect(out).toHaveLength(1);
    // setup before the laugh: start = 60 - soft*0.6, end = 60 + soft*0.4 (then clamped)
    expect(out[0].start).toBeCloseTo(Math.max(0, 60 - lengths.soft * 0.6), 1);
    expect(out[0].end).toBeGreaterThan(60);
  });

  it('ignores weak (<0.5) and non-audience kinds', () => {
    const events: AudioEvent[] = [
      LAUGH(60, 0.3),
      { start: 80, end: 81, kind: 'music', score: 0.9 },
      { start: 100, end: 101, kind: 'speech', score: 1.0 },
    ];
    expect(detectAudienceReactionCandidates(events, [], emptyAudio, lengths, 300)).toHaveLength(0);
  });

  it('caps at the 12 strongest events', () => {
    const events = Array.from({ length: 20 }, (_, i) => LAUGH(10 + i * 14, 0.5 + i * 0.02));
    const out = detectAudienceReactionCandidates(events, [], emptyAudio, lengths, 400);
    expect(out.length).toBeLessThanOrEqual(12);
  });

  it('generateArcTemplateCandidates without events is unchanged (perception-off identity)', () => {
    const before = generateArcTemplateCandidates(segments, triggers, audio, lengths, 300);
    const after = generateArcTemplateCandidates(segments, triggers, audio, lengths, 300, []);
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/director/arcTemplates.test.ts`
Expected: FAIL — `detectAudienceReactionCandidates` not exported.

- [ ] **Step 3: Implement**

In `src/director/arcTemplates.ts` (import the type, add constants + detector, extend the combiner):

```ts
import type { AudioEvent } from '../perception/timeline.js';

export const TEMPLATE_AUDIENCE_BONUS = 1.5;
export const AUDIENCE_SCORE_MIN = 0.5;
export const AUDIENCE_MAX_CANDIDATES = 12;
const AUDIENCE_KINDS = new Set<AudioEvent['kind']>(['laughter', 'applause', 'cheer']);

/** PURE: real audience reactions (laughter/applause/cheer from perception) anchor
 *  reaction candidates the transcript can't see — setup before + tail after, exactly the
 *  Tier-1 trigger shape. Strongest events win; capped so laugh-track footage can't spam. */
export function detectAudienceReactionCandidates(
  events: AudioEvent[], triggers: TriggerHit[], audio: AudioEnergyLayer, lengths: ClipLengths, duration: number,
): ClipCandidate[] {
  const anchors = events
    .filter((e) => AUDIENCE_KINDS.has(e.kind) && e.score >= AUDIENCE_SCORE_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, AUDIENCE_MAX_CANDIDATES);
  const out: ClipCandidate[] = [];
  for (const e of anchors) {
    const start = Math.max(0, e.start - lengths.soft * 0.6);
    const end = Math.min(duration, e.start + lengths.soft * 0.4);
    const span = clampSpan(start, end, lengths, duration);
    if (span.end - span.start < lengths.min) continue;
    const sc = spanComposite(span.start, span.end, triggers, audio, TEMPLATE_AUDIENCE_BONUS);
    out.push({ start: span.start, end: span.end, ...sc });
  }
  return out;
}
```

Extend `generateArcTemplateCandidates`:

```ts
export function generateArcTemplateCandidates(
  segments: TranscriptSegment[], triggers: TriggerHit[], audio: AudioEnergyLayer,
  lengths: ClipLengths, duration: number, audioEvents: AudioEvent[] = [],
): ClipCandidate[] {
  return [
    ...detectQaCandidates(segments, triggers, audio, lengths, duration),
    ...detectReactionCandidates(segments, triggers, audio, lengths, duration),
    ...detectAudienceReactionCandidates(audioEvents, triggers, audio, lengths, duration),
  ];
}
```

In `src/cli/commands/all.ts`, the Slice E call site becomes:

```ts
  const templates = generateArcTemplateCandidates(
    segments, triggers, audio, profile.lengths, meta.duration, perception?.audio_events ?? [],
  );
```

- [ ] **Step 4: Run the gates**

Run: `npx vitest run tests/director/ && npx tsc --noEmit`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/director/arcTemplates.ts src/cli/commands/all.ts tests/director/arcTemplates.test.ts
git commit -m "feat(director): real laughter/applause anchors for Slice E reaction candidates (SP1 1c)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: audio_events → AVSS dopamine model

**Files:**
- Create: `src/perception/query.ts`
- Modify: `src/avss/editPlan.ts` (SourceSignals + buildSourceSignals)
- Modify: `src/avss/simulator.ts` (dopamineEvents)
- Modify: `src/cli/commands/all.ts` (the `buildSourceSignals` call, currently at ~line 634)
- Test: `tests/perception/query.test.ts` (create), `tests/avss/simulator.test.ts` + `tests/avss/editPlan.test.ts` (extend)

**Interfaces:**
- Consumes: `AudioEvent`/`SemanticTimeline` from `src/perception/timeline.js`.
- Produces: in `src/perception/query.ts` — `interface ReactionEvent { t: number; kind: 'laughter' | 'applause' | 'cheer' | 'impact'; score: number }` and `clipReactionEvents(events: AudioEvent[], clipStart: number, clipEnd: number, scoreMin = 0.5): ReactionEvent[]` (filters kind+score, rebases `t` to clip-relative). `SourceSignals` gains optional `reactionEvents?: ReactionEvent[]`; `buildSourceSignals` gains a final optional param `reactionEvents?: ReactionEvent[]`. `dopamineEvents` folds real events in as `laughter→'humor'`, `applause|cheer→'reward'`, `impact→'impact'` with `strength = score`. Task 10 adds `sceneTopicOf` to the same query.ts file.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/perception/query.test.ts
import { describe, expect, it } from 'vitest';
import { clipReactionEvents } from '../../src/perception/query.js';
import type { AudioEvent } from '../../src/perception/timeline.js';

const ev = (start: number, kind: AudioEvent['kind'], score: number): AudioEvent =>
  ({ start, end: start + 1, kind, score });

describe('clipReactionEvents', () => {
  it('filters to reaction kinds within the window and rebases to clip-relative time', () => {
    const events = [
      ev(12, 'laughter', 0.9),   // in window → t=2
      ev(5, 'laughter', 0.9),    // before window
      ev(14, 'speech', 1.0),     // not a reaction kind
      ev(15, 'impact', 0.6),     // in window → t=5
      ev(16, 'applause', 0.3),   // below scoreMin
      ev(60, 'cheer', 0.9),      // after window
    ];
    const out = clipReactionEvents(events, 10, 40);
    expect(out).toEqual([
      { t: 2, kind: 'laughter', score: 0.9 },
      { t: 5, kind: 'impact', score: 0.6 },
    ]);
  });

  it('returns [] for empty input (perception-off identity)', () => {
    expect(clipReactionEvents([], 0, 30)).toEqual([]);
  });
});
```

Add to `tests/avss/simulator.test.ts` (reuse its existing plan/signals fixtures):

```ts
it('real reaction events become dopamine events (laughter→humor, applause→reward)', () => {
  const withReactions = {
    ...baseSignals,
    reactionEvents: [
      { t: 8, kind: 'laughter' as const, score: 0.9 },
      { t: 20, kind: 'applause' as const, score: 0.7 },
    ],
  };
  const sim = simulate(basePlan, withReactions);
  expect(sim.dopamine.some((e) => e.kind === 'humor' && Math.abs(e.t - 8) < 1)).toBe(true);
  expect(sim.dopamine.some((e) => e.kind === 'reward' && Math.abs(e.t - 20) < 1)).toBe(true);
});

it('absent reactionEvents leaves the simulation unchanged', () => {
  expect(simulate(basePlan, baseSignals)).toEqual(simulate(basePlan, { ...baseSignals, reactionEvents: undefined }));
});
```

Add to `tests/avss/editPlan.test.ts`:

```ts
it('buildSourceSignals threads reactionEvents through', () => {
  const signals = buildSourceSignals(clip, words, audio, semantic, [{ t: 1, kind: 'laughter', score: 0.8 }]);
  expect(signals.reactionEvents).toEqual([{ t: 1, kind: 'laughter', score: 0.8 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/perception/query.test.ts tests/avss/`
Expected: FAIL — `src/perception/query.js` missing, `buildSourceSignals` rejects 5th arg, no reaction dopamine.

- [ ] **Step 3: Implement**

```ts
// src/perception/query.ts
/**
 * Read-side helpers over the semantic timeline for Node consumers (SP1 1c/1d wirings).
 * Everything degrades to empty/'' on empty input, so perception-off runs are bit-identical.
 */
import type { AudioEvent, TimelineScene } from './timeline.js';

export interface ReactionEvent {
  t: number;                                              // clip-relative seconds
  kind: 'laughter' | 'applause' | 'cheer' | 'impact';
  score: number;
}

const REACTION_KINDS = new Set(['laughter', 'applause', 'cheer', 'impact']);

/** PURE: timeline audio events → clip-relative reaction events for the AVSS simulator. */
export function clipReactionEvents(
  events: AudioEvent[], clipStart: number, clipEnd: number, scoreMin = 0.5,
): ReactionEvent[] {
  return events
    .filter((e) => REACTION_KINDS.has(e.kind) && e.score >= scoreMin
      && e.start >= clipStart && e.start < clipEnd)
    .map((e) => ({ t: e.start - clipStart, kind: e.kind as ReactionEvent['kind'], score: e.score }));
}
```

In `src/avss/editPlan.ts` — import the type, extend the interface and builder:

```ts
import type { ReactionEvent } from '../perception/query.js';

export interface SourceSignals {
  durationSec: number;
  words: CaptionWord[];                                   // clip-relative
  rms: RmsPoint[];                                        // clip-relative slice, rms 0–10
  silences: { start: number; end: number }[];             // clip-relative, clamped
  semantic: SemanticScores;                               // normalized 0–1
  sentiment?: string;
  /** Real audience reactions from perception (clip-relative), absent when perception is off. */
  reactionEvents?: ReactionEvent[];
}
```

`buildSourceSignals` gains a final optional param and includes it in the returned object:

```ts
export function buildSourceSignals(
  clip: { start: number; end: number; sentiment?: string },
  words: CaptionWord[],
  audio: AudioEnergyLayer,
  semantic: SemanticWindow[],
  reactionEvents?: ReactionEvent[],
): SourceSignals {
```

…and in the return: `reactionEvents,` (leave everything else untouched).

In `src/avss/simulator.ts`, inside `dopamineEvents` after the payoff block and before the merge:

```ts
  // Real audience reactions from perception outrank every proxy above — they are measured,
  // not inferred. laughter→humor, applause/cheer→reward, impact→impact.
  for (const r of signals.reactionEvents ?? []) {
    const kind: DopamineEvent['kind'] =
      r.kind === 'laughter' ? 'humor' : r.kind === 'impact' ? 'impact' : 'reward';
    raw.push({ t: r.t, kind, strength: clamp01(r.score) });
  }
```

In `src/cli/commands/all.ts` — import and wire at the `buildSourceSignals` call site (~line 634):

```ts
import { clipReactionEvents } from '../../perception/query.js';
```

```ts
      const signals = buildSourceSignals(
        clip, captionWords, source.audio, source.semantic,
        clipReactionEvents(source.perception?.audio_events ?? [], clip.start, clip.end),
      );
```

(If the `source` object's type in that scope doesn't expose `perception`, add it — `analyzeVideo` already returns it in its result at ~line 323.)

- [ ] **Step 4: Run the gates**

Run: `npx vitest run tests/perception/ tests/avss/ && npx tsc --noEmit`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/perception/query.ts src/avss/editPlan.ts src/avss/simulator.ts src/cli/commands/all.ts tests/perception/query.test.ts tests/avss/simulator.test.ts tests/avss/editPlan.test.ts
git commit -m "feat(avss): real laughter/applause/impact events feed the dopamine model (SP1 1c)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: scenes → Slice B visual-topic fallback

**Files:**
- Modify: `src/perception/query.ts` (add `sceneTopicOf`)
- Modify: `src/cli/commands/all.ts` (both `topicOf` call sites, ~lines 503 and 526)
- Test: `tests/perception/query.test.ts` (extend)

**Interfaces:**
- Consumes: `TimelineScene` from `src/perception/timeline.js`; `topicOf` from `src/analysis/semantic.js` (unchanged).
- Produces: `sceneTopicOf(start: number, end: number, scenes: TimelineScene[]): string` — dominant-overlap scene label, `''` when none; generic mock labels (`/^scene \d+$/`) never count. Selection topic becomes `topicOf(...) || sceneTopicOf(...)` so the LLM topic still wins when present.

- [ ] **Step 1: Write the failing tests**

Add to `tests/perception/query.test.ts`:

```ts
import { sceneTopicOf } from '../../src/perception/query.js';
import type { TimelineScene } from '../../src/perception/timeline.js';

describe('sceneTopicOf', () => {
  const scenes: TimelineScene[] = [
    { start: 0, end: 30, label: 'a gym workout' },
    { start: 30, end: 40, label: 'a crowd celebrating' },
  ];

  it('returns the label with the largest overlap', () => {
    expect(sceneTopicOf(10, 35, scenes)).toBe('a gym workout');     // 20s vs 5s overlap
    expect(sceneTopicOf(29, 40, scenes)).toBe('a crowd celebrating'); // 1s vs 10s
  });

  it('ignores generic mock labels and returns "" when nothing real overlaps', () => {
    expect(sceneTopicOf(0, 10, [{ start: 0, end: 30, label: 'scene 1' }])).toBe('');
    expect(sceneTopicOf(100, 120, scenes)).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/perception/query.test.ts`
Expected: FAIL — `sceneTopicOf` not exported.

- [ ] **Step 3: Implement**

Append to `src/perception/query.ts`:

```ts
const GENERIC_SCENE_LABEL = /^scene \d+$/;

/** PURE: dominant-overlap scene label for a clip window — the Slice B topic fallback when
 *  the LLM semantic topic is unavailable. Mock's numbered placeholders never count. */
export function sceneTopicOf(start: number, end: number, scenes: TimelineScene[]): string {
  let best = '';
  let bestOverlap = 0;
  for (const s of scenes) {
    if (GENERIC_SCENE_LABEL.test(s.label)) continue;
    const overlap = Math.min(end, s.end) - Math.max(start, s.start);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = s.label; }
  }
  return best;
}
```

In `src/cli/commands/all.ts`, import `sceneTopicOf` alongside `clipReactionEvents`, then change both topic derivations. At the `selectDiverse` mapping (~line 503):

```ts
      s.item.clip, s.item.source.jobId,
      topicOf(s.item.clip.start, s.item.clip.end, s.item.source.semantic)
        || sceneTopicOf(s.item.clip.start, s.item.clip.end, s.item.source.perception?.scenes ?? []),
      s.visual,
```

At the selection-why block (~line 526):

```ts
    const topic = topicOf(clip.start, clip.end, source.semantic)
      || sceneTopicOf(clip.start, clip.end, source.perception?.scenes ?? []);
```

- [ ] **Step 4: Run the full Node gates**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite green (this is the last Node code change — run everything)

- [ ] **Step 5: Commit**

```bash
git add src/perception/query.ts src/cli/commands/all.ts tests/perception/query.test.ts
git commit -m "feat(director): CLIP scene labels back the Slice B topic when the LLM topic is absent (SP1 1d)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Live smoke + Mac benchmark

**Files:**
- No source changes expected (fix-forward commits allowed if the smoke finds bugs).

**Interfaces:**
- Consumes: everything above.
- Produces: verified real timeline + recorded per-producer wall times.

> **USER GATE — pyannote needs two one-time human steps** before its part of the smoke:
> 1. Create a free token at `hf.co/settings/tokens` and add `HF_TOKEN=…` to `.env`.
> 2. While logged in, accept the conditions on BOTH model pages: `hf.co/pyannote/speaker-diarization-3.1` and `hf.co/pyannote/segmentation-3.0`.
>
> If the user isn't available, run the smoke WITHOUT pyannote (yamnet + clip need no token), verify the pyannote path fails soft (warning + layer omitted + exit 0), and leave a note that the diarization smoke is pending the token.

- [ ] **Step 1: Setup + warm**

Run: `./start.sh perception-setup`
Expected: deps install (several GB first time — torch + tensorflow), warm prints per-model status lines. Record wall time.

- [ ] **Step 2: Python lane green in the real venv**

Run: `perception/.venv/bin/python -m pytest perception/tests/ -v`
Expected: all pass.

- [ ] **Step 3: Real-producer run on synthesized media** (fast pre-check before a real video)

```bash
perception/.venv/bin/clipforge-perception analyze <a small local mp4 with speech, e.g. any file under workspace/downloads/> \
  --out /tmp/smoke/semantic_timeline.json --models mock,pyannote,yamnet,clip --job-id smoke
python3 -c "import json; t=json.load(open('/tmp/smoke/semantic_timeline.json')); print(t['producers_run'], len(t['speakers']), len(t['audio_events']), len(t['scenes']))"
```

Expected: exit 0; `producers_run` lists what ran; scene labels are natural phrases (not `scene N`); `clip/*.f32` sidecars exist next to the JSON; audio_events kinds within the enum. **Record per-producer wall time** (the pipeline prints producer warnings only — time the whole call per models flag: run once with `--models yamnet`, once `--models clip`, once `--models pyannote` on a fresh out dir and note the three durations; this is the Mac benchmark the design requires).

- [ ] **Step 4: End-to-end through Node**

```bash
PERCEPTION=1 node dist/cli/index.js all <a short YouTube URL or local file> --clips 1
```

(Build first with `npm run build` if dist is stale.) Expected: the run log shows the perception line with real counts (`N spk, M audio-events, K scenes`), `workspace/perception/<jobId>/semantic_timeline.json` has all four producers in `producers_run`, and — on content with real laughter — the run log shows Slice E template candidates and per-clip AVSS dopamine reflecting them. Then re-run the same command: expected `perception cache hit`.

- [ ] **Step 5: Fail-soft checks**

- Remove `HF_TOKEN` from the env and delete the pyannote layer's cache dir → run again: warning + run still succeeds (exit 0), `speakers` falls back to mock's.
- `--models mock` alone must not import torch/tensorflow (verify: fast, no TF logging noise).

- [ ] **Step 6: Record + commit any fixes**

Note the benchmark numbers (per-producer seconds on the test video + video length) in the final commit message or a short `perception/README.md` "Mac benchmarks" line. Commit any smoke fixes individually as `fix(perception): …`.

---

## Self-Review Notes (done at plan time)

- **Spec coverage:** design §5 producer files (pyannote_diar/yamnet_events/clip_scenes) → Tasks 3-5; §5 setup+HF token → Task 6; §8 phases 1b/1c/1d incl. the 1c wiring (Slice E + AVSS dopamine) → Tasks 8-9 and 1d wiring (Slice B topic) → Task 10; §8 "benchmarked on the Mac as a cached pass" → Task 11; determinism note → models pinned in pyproject, producers are deterministic given weights. Embedding sidecars per §4 (`embedding_ref`, never inlined) → Task 5.
- **Deliberate deltas from the design doc:** (a) producer-level incremental merge (Task 2) isn't in the design — it's required so a permanently-failing producer (no HF token) doesn't force re-running the expensive ones; (b) all three phases in one plan per user decision 2026-07-07 (design said one plan per phase); (c) WhisperX stays unbuilt (design: off by default, captions suffice).
- **Known risks, called out for the executor:** `tensorflow` wheel availability depends on the venv's python version (hence the python3.12 preference in Task 6); pyannote 3.x uses `use_auth_token=` (if a 4.x resolver sneaks in despite the `<4` pin, the kwarg is `token=`); YAMNet display names in `KIND_MAP` must match `yamnet_class_map.csv` exactly — verify in Task 11 Step 3 that expected kinds actually appear.
