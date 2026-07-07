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
