"""Run selected producers, merge their layers, validate, write JSON."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import ffmpeg, schema
from .producers.base import Ctx
from .producers.mock import MockProducer
from .producers.pyannote_diar import PyannoteDiarizationProducer
from .producers.yamnet_events import YamnetEventsProducer

PRODUCERS = {"mock": MockProducer, "pyannote": PyannoteDiarizationProducer,
             "yamnet": YamnetEventsProducer}


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
