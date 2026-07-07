"""Thin ffprobe/ffmpeg helpers. We shell out and parse stderr — no python media deps."""

from __future__ import annotations

import re
import subprocess


def probe_duration(video: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", video],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def has_audio_stream(video: str) -> bool:
    """True iff the container has at least one audio stream (ffprobe lists an index)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=index", "-of", "csv=p=0", video],
        capture_output=True, text=True,
    ).stdout.strip()
    return bool(out)


def silence_spans(video: str, noise_db: int = -30, min_silence: float = 0.5) -> list[tuple[float, float]]:
    """Return (start, end) silence regions from ffmpeg silencedetect."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", video,
         "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:  # a genuine ffmpeg error must surface, not masquerade as "no silence"
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {proc.stderr[-500:]}")
    spans: list[tuple[float, float]] = []
    start: float | None = None
    for line in proc.stderr.splitlines():
        m = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m:
            start = float(m.group(1))
            continue
        m = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m and start is not None:
            spans.append((start, float(m.group(1))))
            start = None
    return spans


def scene_cut_times(video: str, threshold: float = 0.3) -> list[float]:
    """Return timestamps (s) of detected scene cuts via ffmpeg select+showinfo."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", video,
         "-filter:v", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:  # a genuine ffmpeg error must surface, not masquerade as "no cuts"
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {proc.stderr[-500:]}")
    times: list[float] = []
    for line in proc.stderr.splitlines():
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            times.append(float(m.group(1)))
    return times


def speech_spans_from_silence(duration: float, silences: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Complement of silence within [0, duration]."""
    spans: list[tuple[float, float]] = []
    cursor = 0.0
    for s, e in sorted(silences):
        if s > cursor:
            spans.append((cursor, min(s, duration)))
        cursor = max(cursor, e)
    if cursor < duration:
        spans.append((cursor, duration))
    return [(round(s, 3), round(e, 3)) for s, e in spans if e - s > 0.05]
