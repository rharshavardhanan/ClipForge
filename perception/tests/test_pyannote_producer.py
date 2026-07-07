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
