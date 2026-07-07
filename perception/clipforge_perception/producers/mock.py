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
