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
