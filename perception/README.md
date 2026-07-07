# ClipForge Perception Service

Python microservice that turns media into **facts** — a versioned `semantic_timeline.json`. It
never reasons (that's the Node/LLM Understanding layer). Node touches it only via the CLI.

## Setup

```bash
./start.sh perception-setup           # creates perception/.venv, installs the package
perception/.venv/bin/clipforge-perception --help
```

## CLI

```bash
clipforge-perception analyze <video> --out <path> --models mock [--sample-fps 2] [--job-id ID]
```

Exit 0 + valid JSON written = success. A producer that fails logs a warning, omits its layer, and
the run still succeeds with a partial (valid) timeline. Fatal errors (bad args, unreadable video)
exit non-zero.

## Producers

| Producer | Phase | Layers | Notes |
|----------|-------|--------|-------|
| `mock` | 1a | speakers, audio_events, scenes | ffmpeg heuristics; single speaker S0, events kind `speech` |
| `pyannote` | 1b | speakers (real diarization) | needs free `HF_TOKEN` |
| `yamnet` | 1c | audio_events (laughter/applause/…) | |
| `clip` | 1d | scenes (embeddings + labels) | |

## Tests

```bash
perception/.venv/bin/pytest -q
```

The JSON-schema at `clipforge_perception/schema/semantic_timeline.v1.schema.json` is the contract
source of truth; `fixtures/golden_timeline.json` is the shared conformance anchor (Node tests load
it too).
