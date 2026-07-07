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
