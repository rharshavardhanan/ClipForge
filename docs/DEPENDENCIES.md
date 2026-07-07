# Dependencies & Licenses

Recorded per v4 Part 6 §1. External model weights and non-permissive licenses are flagged so
downstream users know the constraints. All processing is local; only optional semantic-scoring
calls (Claude / Gemini) leave the machine.

## System tools (not npm)

| Tool | Purpose | License | Notes |
|------|---------|---------|-------|
| ffmpeg + ffprobe | decode/encode, crop/scale, loudnorm, RMS/scene analysis | LGPL/GPL (build-dependent) | user-installed (`brew install ffmpeg`); ClipForge shells out |
| yt-dlp | source + B-roll/RankRot download, metadata, comments, subtitles | Unlicense (public domain) | user-installed |
| whisper-cpp | local transcript fallback for files without captions | MIT | optional |

## Python perception service (`perception/`, optional)

Isolated microservice (own venv `perception/.venv`), run once-per-source and cached. Node shells
out to its `clipforge-perception` CLI; it never imports a Python model. Absent venv → perception
degrades to off, pipeline unchanged.

| Component | Purpose | License | Notes |
|-----------|---------|---------|-------|
| Python 3.10+ | perception runtime | PSF | user-installed (`brew install python@3.12`) |
| jsonschema | validate the semantic timeline against the JSON-schema source of truth | MIT | only runtime dep in Phase 1a |
| ffmpeg/ffprobe | mock producer heuristics (silencedetect, scene cuts) | LGPL/GPL | already required by ClipForge |

Setup: `./start.sh perception-setup`.

### `[real]` extra — perception venv only (never in Node's package.json)

Installed by `./start.sh perception-setup` via `.[dev,real]`; pulled in only for the real
producers (Phases 1b-1d), fully isolated from the Node/npm dependency tree.

| Component | Purpose | License | Notes |
|-----------|---------|---------|-------|
| pyannote.audio | speaker diarization (Phase 1b, `speakers` layer) | MIT (code); models need a free **HF_TOKEN** | see `perception/README.md` for the token steps |
| torch | tensor runtime for pyannote.audio and open-clip-torch | BSD-3-Clause | CPU/MPS on Mac, no CUDA |
| tensorflow | runtime for YAMNet (Phase 1c, `audio_events` layer) | Apache-2.0 | |
| tensorflow-hub | loads the pretrained YAMNet model from TF Hub | Apache-2.0 | |
| numpy | array plumbing shared by the pyannote/yamnet/clip producers | BSD-3-Clause | |
| open-clip-torch | zero-shot scene labels + embeddings (Phase 1d, `scenes` layer) | MIT | |
| pillow | frame decode/resize for the CLIP producer | HPND (PIL license) | |

## Node runtime dependencies (key)

| Package | Purpose | License |
|---------|---------|---------|
| @remotion/* | React-based renderer (captions, framing, cards) | **Remotion License** — free for individuals/small teams; a company license is required above a headcount/revenue threshold. VERIFY before commercial use. |
| next | GUI (local app) | MIT |
| react / react-dom | Remotion + GUI | MIT |
| @vladmandic/face-api | face detection + 68-pt landmarks (framing, active-speaker) | MIT (code) |
| **@vladmandic/face-api model weights** (`node_modules/@vladmandic/face-api/model`) | tinyFaceDetector + faceLandmark68Net | **MIT** (per the @vladmandic/face-api redistribution) — bundled, no runtime fetch |
| pngjs | PNG decode for frame analysis (aHash, face frames) | MIT |
| commander | CLI parsing | MIT |
| ora / chalk / cli-table3 | terminal UX | MIT |
| dotenv | `.env` loading | BSD-2-Clause |
| uuid | job ids | MIT |

## External APIs (optional, network)

| Service | Purpose | Notes |
|---------|---------|-------|
| Anthropic Claude | primary semantic scoring, arc completion, B-roll cues | needs `ANTHROPIC_API_KEY` (billed); degrades to Gemini → trigger+audio |
| Google Gemini Flash | fallback semantic scoring, RankRot queries (Gemini-only) | free-tier key pool; degrades to heuristics |
| YouTube Data API v3 + Analytics API v2 | upload + the AVSS `stats` learning loop | OAuth, user's own Cloud app |

## v4 capability decisions (NOT adopted, with reason)

The v4 spec's integration matrix names GPU-class Python models. ClipForge is Node-native and
Mac-first (no CUDA), so these are **deferred or substituted**, not dependencies:

- **WhisperX** → deferred; json3/whisper-cpp give word timings today. PyAnnote diarization is no
  longer deferred — it's adopted as the optional `perception/` microservice's real producer
  (Phase 1b, see the `[real]` extra table above), isolated in its own venv, never a Node dependency.
- **YOLO11 / ByteTrack / SAM2** → not adopted; face-api covers talking-head framing. General
  object detection / mask segmentation has low marginal value for this content and no
  Mac-fast Node path.
- **sentence-transformers embedder** → not adopted; the LLM semantic pass covers topic/novelty.
- **librosa / Silero VAD** (laughter/applause) → deferred; RMS + trigger phrases remain the
  fallback proxy when the perception service isn't set up. YAMNet is no longer deferred — it's
  adopted as the perception service's real producer (Phase 1c, see the `[real]` extra table above).
