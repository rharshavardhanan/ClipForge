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


@pytest.fixture(scope="session")
def signal_video(tmp_path_factory) -> str:
    """A 5s clip with REAL signal: audio = sine/silence/sine/silence/sine (two 1s silent gaps),
    video = red then blue (one hard cut at 2.5s). Exercises the multi-turn / multi-scene paths."""
    out = tmp_path_factory.mktemp("media") / "signal.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=c=red:s=320x240:r=10:d=5",
         "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=10:d=5",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1",
         "-f", "lavfi", "-i", "sine=frequency=660:duration=1",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1",
         "-f", "lavfi", "-i", "sine=frequency=880:duration=1",
         "-filter_complex",
         "[0:v]trim=0:2.5,setpts=PTS-STARTPTS[v0];"
         "[1:v]trim=0:2.5,setpts=PTS-STARTPTS[v1];"
         "[v0][v1]concat=n=2:v=1:a=0[v];"
         "[2:a][3:a][4:a][5:a][6:a]concat=n=5:v=0:a=1[a]",
         "-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", str(out)],
        check=True,
    )
    return str(out)


@pytest.fixture(scope="session")
def silent_video(tmp_path_factory) -> str:
    """A 3s VIDEO-ONLY clip (no audio stream at all) — locks the audio-less degradation path."""
    out = tmp_path_factory.mktemp("media") / "silent.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=3",
         "-pix_fmt", "yuv420p", str(out)],
        check=True,
    )
    return str(out)
