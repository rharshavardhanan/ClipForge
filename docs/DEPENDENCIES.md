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

- **WhisperX / PyAnnote (diarization)** → deferred; json3/whisper-cpp give word timings today.
  Diarization candidate if pursued: sherpa-onnx / tinydiarize (ONNX, Mac-viable) — Slice F.
- **YOLO11 / ByteTrack / SAM2** → not adopted; face-api covers talking-head framing. General
  object detection / mask segmentation has low marginal value for this content and no
  Mac-fast Node path.
- **sentence-transformers embedder** → not adopted; the LLM semantic pass covers topic/novelty.
- **librosa / Silero VAD / YAMNet** (laughter/applause) → deferred; RMS + trigger phrases are
  the current proxy. ONNX audio classifier is the Slice F candidate.
