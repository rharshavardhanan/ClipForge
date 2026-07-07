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
