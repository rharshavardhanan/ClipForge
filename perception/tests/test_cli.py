import json
import subprocess
import sys
from pathlib import Path

from clipforge_perception import schema


def test_cli_analyze_writes_valid_timeline(tiny_video, tmp_path):
    out = tmp_path / "job42" / "semantic_timeline.json"
    rc = subprocess.run(
        [sys.executable, "-m", "clipforge_perception.cli", "analyze", tiny_video,
         "--out", str(out), "--models", "mock", "--job-id", "job42"],
    ).returncode
    assert rc == 0
    timeline = json.loads(out.read_text())
    assert schema.validate(timeline) == []
    assert timeline["producers_run"] == ["mock"]
    assert timeline["job_id"] == "job42"


def test_cli_missing_video_is_fatal(tmp_path):
    rc = subprocess.run(
        [sys.executable, "-m", "clipforge_perception.cli", "analyze",
         str(tmp_path / "nope.mp4"), "--out", str(tmp_path / "o.json")],
    ).returncode
    assert rc == 2
