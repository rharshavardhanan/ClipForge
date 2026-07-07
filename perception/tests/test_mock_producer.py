from clipforge_perception import schema
from clipforge_perception.producers.base import Ctx
from clipforge_perception.producers.mock import MockProducer


def test_mock_producer_emits_valid_nonempty_layers(tiny_video):
    ctx = Ctx(duration=5.0, sample_fps=2)
    layers = MockProducer().run(tiny_video, ctx)

    assert set(layers).issubset({"speakers", "audio_events", "scenes"})
    assert layers["speakers"] and layers["scenes"]  # non-empty

    # Layers must slot into an empty timeline and validate clean.
    t = schema.empty_timeline("job-mock", 5.0, 2)
    t.update(layers)
    t["producers_run"] = ["mock"]
    assert schema.validate(t) == []


def test_mock_producer_is_deterministic(tiny_video):
    ctx = Ctx(duration=5.0, sample_fps=2)
    assert MockProducer().run(tiny_video, ctx) == MockProducer().run(tiny_video, ctx)


def test_mock_producer_derives_multiple_turns_and_scenes_from_signal(signal_video):
    """The real parsing paths: two silent gaps → 3 speech turns/events; one hard cut → 2 scenes."""
    ctx = Ctx(duration=5.0, sample_fps=2)
    layers = MockProducer().run(signal_video, ctx)

    assert len(layers["speakers"]) == 1
    assert len(layers["speakers"][0]["turns"]) > 1  # multiple derived turns, not one fallback span
    assert len(layers["audio_events"]) == len(layers["speakers"][0]["turns"])
    assert len(layers["scenes"]) > 1  # a real scene cut split the clip

    t = schema.empty_timeline("job-signal", 5.0, 2)
    t.update(layers)
    t["producers_run"] = ["mock"]
    assert schema.validate(t) == []

    # still deterministic on signal-bearing input
    assert MockProducer().run(signal_video, ctx) == layers


def test_mock_producer_emits_empty_audio_layers_when_no_audio_stream(silent_video):
    """A video-only clip must NOT fabricate a speaker/speech event — only real audio derives them."""
    ctx = Ctx(duration=3.0, sample_fps=2)
    layers = MockProducer().run(silent_video, ctx)

    assert layers["speakers"] == []  # no zero-turn placeholder speaker
    assert layers["audio_events"] == []
    assert layers["scenes"]  # video still yields scenes

    t = schema.empty_timeline("job-silent", 3.0, 2)
    t.update(layers)
    t["producers_run"] = ["mock"]
    assert schema.validate(t) == []
