import json
from pathlib import Path

from clipforge_perception import pipeline, schema


def test_analyze_merges_into_existing_timeline(tiny_video, tmp_path):
    out = tmp_path / "job1" / "semantic_timeline.json"
    out.parent.mkdir(parents=True)
    # Existing cached timeline from an earlier run of a fictional producer.
    import subprocess
    duration = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", tiny_video],
        capture_output=True, text=True, check=True).stdout.strip())
    prior = schema.empty_timeline("job1", duration, 2.0)
    prior["producers_run"] = ["prior"]
    prior["speakers"] = [{"id": "S9", "turns": [{"start": 0.0, "end": 1.0}]}]
    out.write_text(json.dumps(prior))

    rc = pipeline.analyze(tiny_video, str(out), ["mock"], 2.0, "job1")
    assert rc == 0
    merged = json.loads(out.read_text())
    assert set(merged["producers_run"]) == {"prior", "mock"}
    # mock overwrote the speakers layer (it ran later), scenes/audio_events also filled
    assert merged["speakers"] and merged["speakers"][0]["id"] == "S0"


def test_analyze_ignores_existing_with_wrong_duration(tiny_video, tmp_path):
    out = tmp_path / "job2" / "semantic_timeline.json"
    out.parent.mkdir(parents=True)
    stale = schema.empty_timeline("job2", 9999.0, 2.0)
    stale["producers_run"] = ["prior"]
    out.write_text(json.dumps(stale))

    rc = pipeline.analyze(tiny_video, str(out), ["mock"], 2.0, "job2")
    assert rc == 0
    merged = json.loads(out.read_text())
    assert merged["producers_run"] == ["mock"]  # stale cache discarded, fresh start


def test_analyze_ignores_corrupt_existing(tiny_video, tmp_path):
    out = tmp_path / "job3" / "semantic_timeline.json"
    out.parent.mkdir(parents=True)
    out.write_text("{not json")
    rc = pipeline.analyze(tiny_video, str(out), ["mock"], 2.0, "job3")
    assert rc == 0
    assert json.loads(out.read_text())["producers_run"] == ["mock"]


def test_ctx_carries_out_dir(tiny_video, tmp_path, monkeypatch):
    from clipforge_perception.producers.base import Ctx
    seen = {}

    class SpyProducer:
        name = "spy"
        def run(self, video: str, ctx: Ctx) -> dict:
            seen["out_dir"] = ctx.out_dir
            return {}

    monkeypatch.setitem(pipeline.PRODUCERS, "spy", SpyProducer)
    out = tmp_path / "job4" / "semantic_timeline.json"
    rc = pipeline.analyze(tiny_video, str(out), ["spy"], 2.0, "job4")
    assert rc == 0
    assert Path(seen["out_dir"]).resolve() == out.parent.resolve()
