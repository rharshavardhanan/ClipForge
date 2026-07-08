# ClipForge Perception Service

Python microservice that turns media into **facts** — a versioned `semantic_timeline.json`. It
never reasons (that's the Node/LLM Understanding layer). Node touches it only via the CLI.

## Setup

```bash
./start.sh perception-setup           # creates perception/.venv, installs [dev,real], pre-downloads models
perception/.venv/bin/clipforge-perception --help
```

## CLI

```bash
clipforge-perception analyze <video> --out <path> --models mock [--sample-fps 2] [--job-id ID]
clipforge-perception warm [--models pyannote,yamnet,clip]
```

Exit 0 + valid JSON written = success. A producer that fails logs a warning, omits its layer, and
the run still succeeds with a partial (valid) timeline. Fatal errors (bad args, unreadable video)
exit non-zero.

`warm` pre-downloads/caches each model's weights and prints one status line per model to stderr.
It is best-effort per model — a failure (e.g. no `HF_TOKEN`, or an unknown model name) prints a
warning and moves on to the next one; the command itself **always exits 0**, so it never blocks
`./start.sh perception-setup`.

## Producers

| Producer | Phase | Layers | Notes |
|----------|-------|--------|-------|
| `mock` | 1a | speakers, audio_events, scenes | ffmpeg heuristics; single speaker S0, events kind `speech` |
| `pyannote` | 1b | speakers (real diarization) | needs free `HF_TOKEN` |
| `yamnet` | 1c | audio_events (laughter/applause/…) | |
| `clip` | 1d | scenes (embeddings + labels) | |

## Real producers (Phase 1b-1d)

Installed via `.[real]` (torch, tensorflow, pyannote.audio, open-clip-torch, …) — pulled in by
`./start.sh perception-setup`, never by Node's `npm install`.

- **`pyannote`** (1b) — fills the **speakers** layer with real diarization (turn boundaries +
  speaker labels) via `pyannote/speaker-diarization-3.1`.
- **`yamnet`** (1c) — fills the **audio_events** layer (laughter, applause, impact, …) via
  Google's YAMNet.
- **`clip`** (1d) — fills the **scenes** layer with zero-shot labels + embedding sidecars via
  OpenCLIP.

### HF_TOKEN (pyannote only)

pyannote's diarization and segmentation models are gated on Hugging Face — a free token unlocks
them:

1. Create a free token at [hf.co/settings/tokens](https://hf.co/settings/tokens).
2. Accept the terms on both model pages (required, even with a token):
   [hf.co/pyannote/speaker-diarization-3.1](https://hf.co/pyannote/speaker-diarization-3.1) and
   [hf.co/pyannote/segmentation-3.0](https://hf.co/pyannote/segmentation-3.0).
3. Add `HF_TOKEN=<token>` to `.env`, then re-run `./start.sh perception-setup`.

yamnet and clip need no token and warm regardless.

Everything here is **fail-soft**: no `HF_TOKEN` (or any other warm/analyze failure) just means the
`speakers` layer stays mock/empty for that run — it never blocks setup or the pipeline.

### Mac benchmarks (2026-07-08, Apple Silicon, CPU, warm models)

Once-per-source cached pass on a 149s 1080p video: **yamnet 5s**, **clip 11s** (2 scenes),
pyannote fail-fast <1s without a token (untimed with one — expect minutes on CPU for long
videos; it's the slowest producer). Full 4-producer pass on a 19s clip: ~10s. `--models mock`
alone: ~0.3s, imports no torch/tensorflow.

## Tests

```bash
perception/.venv/bin/pytest -q
```

The JSON-schema at `clipforge_perception/schema/semantic_timeline.v1.schema.json` is the contract
source of truth; `fixtures/golden_timeline.json` is the shared conformance anchor (Node tests load
it too).
