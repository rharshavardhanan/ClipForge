import subprocess

from clipforge_perception import ffmpeg


def _probe(path: str, entries: str) -> str:
    return subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", entries, "-of", "default=nokey=1:noprint_wrappers=1", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_extract_wav_16k_mono(tiny_video, tmp_path):
    wav = ffmpeg.extract_wav_16k(tiny_video, str(tmp_path / "a.wav"))
    assert _probe(wav, "stream=sample_rate") == "16000"
    assert _probe(wav, "stream=channels") == "1"


def test_extract_wav_16k_raises_on_bad_input(tmp_path):
    import pytest
    with pytest.raises(RuntimeError):
        ffmpeg.extract_wav_16k(str(tmp_path / "missing.mp4"), str(tmp_path / "a.wav"))


def test_extract_frame_writes_jpeg(tiny_video, tmp_path):
    from pathlib import Path
    jpg = ffmpeg.extract_frame(tiny_video, 2.0, str(tmp_path / "f.jpg"))
    data = Path(jpg).read_bytes()
    assert data[:2] == b"\xff\xd8"  # JPEG SOI marker
