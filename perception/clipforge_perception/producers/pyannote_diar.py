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
