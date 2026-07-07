"""clipforge-perception CLI. Exit 0 + valid JSON written = success."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import pipeline


def _warm_pyannote():
    from .producers import pyannote_diar
    return pyannote_diar.warm()


def _warm_yamnet():
    from .producers import yamnet_events
    return yamnet_events.warm()


def _warm_clip():
    from .producers import clip_scenes
    return clip_scenes.warm()


WARMERS = {"pyannote": _warm_pyannote, "yamnet": _warm_yamnet, "clip": _warm_clip}


def main() -> None:
    parser = argparse.ArgumentParser(prog="clipforge-perception")
    sub = parser.add_subparsers(dest="command", required=True)

    analyze = sub.add_parser("analyze", help="analyze a video into a semantic timeline")
    analyze.add_argument("video")
    analyze.add_argument("--out", required=True, help="output semantic_timeline.json path")
    analyze.add_argument("--models", default="mock", help="comma-separated producers (default: mock)")
    analyze.add_argument("--sample-fps", type=float, default=2.0)
    analyze.add_argument("--job-id", default=None, help="defaults to the --out parent dir name")

    warm = sub.add_parser("warm", help="pre-download model weights for the real producers")
    warm.add_argument("--models", default="pyannote,yamnet,clip")

    args = parser.parse_args()
    if args.command == "warm":
        for name in [m.strip() for m in args.models.split(",") if m.strip()]:
            fn = WARMERS.get(name)
            if fn is None:
                print(f"warning: unknown model '{name}' — skipped", file=sys.stderr)
                continue
            try:
                print(fn(), file=sys.stderr)
            except Exception as exc:  # warm is best-effort; setup must not hard-fail
                print(f"warning: warm '{name}' failed ({exc})", file=sys.stderr)
        sys.exit(0)
    if args.command == "analyze":
        job_id = args.job_id or Path(args.out).resolve().parent.name or "job"
        models = [m.strip() for m in args.models.split(",") if m.strip()]
        sys.exit(pipeline.analyze(args.video, args.out, models, args.sample_fps, job_id))


if __name__ == "__main__":
    main()
