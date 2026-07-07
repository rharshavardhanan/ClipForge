import json
import subprocess
import sys
from pathlib import Path

import pytest

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


def test_warm_reports_per_model_and_survives_failure(monkeypatch, capsys):
    from clipforge_perception import cli

    def ok():
        return "fake: ready"

    def boom():
        raise RuntimeError("no token")

    monkeypatch.setattr(cli, "WARMERS", {"good": ok, "bad": boom})
    monkeypatch.setattr("sys.argv", ["clipforge-perception", "warm", "--models", "good,bad,unknown"])
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 0          # per-model failure must NOT fail the command
    captured = capsys.readouterr()
    combined = captured.err + captured.out
    assert "fake: ready" in combined
    assert "no token" in combined
    assert "unknown" in combined
