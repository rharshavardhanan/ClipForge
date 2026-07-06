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
