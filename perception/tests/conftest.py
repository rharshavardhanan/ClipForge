import subprocess
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def tiny_video(tmp_path_factory) -> str:
    """A 5s test clip (testsrc video + sine audio with a gap) synthesized via ffmpeg."""
    out = tmp_path_factory.mktemp("media") / "tiny.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=5",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
         "-shortest", "-pix_fmt", "yuv420p", str(out)],
        check=True,
    )
    return str(out)
