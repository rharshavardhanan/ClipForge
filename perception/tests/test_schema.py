import copy
import json
from pathlib import Path

from clipforge_perception import schema

GOLDEN = Path(__file__).resolve().parents[1] / "fixtures" / "golden_timeline.json"


def golden() -> dict:
    return json.loads(GOLDEN.read_text())


def test_golden_fixture_is_valid():
    assert schema.validate(golden()) == []


def test_rejects_wrong_schema_version():
    bad = golden()
    bad["schema_version"] = 2
    errs = schema.validate(bad)
    assert errs and any("schema_version" in e or "const" in e for e in errs)


def test_rejects_out_of_enum_kind():
    bad = golden()
    bad["audio_events"][0]["kind"] = "giggle"
    assert schema.validate(bad)


def test_rejects_negative_time():
    bad = golden()
    bad["scenes"][0]["start"] = -1
    assert schema.validate(bad)


def test_empty_timeline_is_valid():
    t = schema.empty_timeline("job-x", 42.0, 2)
    assert schema.validate(t) == []
    assert t["tracks"] == [] and t["producers_run"] == []
