"""Producer protocol: a producer turns media into one or more partial timeline layers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class Ctx:
    duration: float
    # Reserved for future frame-sampling producers (object/depth/VLM layers). MockProducer only
    # reads ctx.duration; sample_fps is plumbed through now so the Producer contract is stable.
    sample_fps: float


class Producer(Protocol):
    name: str

    def run(self, video: str, ctx: Ctx) -> dict:
        """Return a dict of timeline layers to merge (e.g. {'speakers': [...], 'scenes': [...]})."""
        ...
