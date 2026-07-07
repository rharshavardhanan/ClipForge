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
