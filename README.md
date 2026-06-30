# ClipForge

ClipForge is a local-first viral short-form clip engine. Feed it a YouTube URL and it automatically downloads the video, extracts a word-level transcript, scores candidate clip windows using audio energy and linguistic trigger analysis, slices the top clips, burns karaoke-style captions in a 9:16 frame, and exports a ready-to-post `_final.mp4` — all on your own machine, no cloud APIs required in Slice 1.

---

## Requirements

| Tool | Notes |
|------|-------|
| macOS | Tested on macOS 14+. Linux should work but is untested. |
| Node 24 | Required. Use `nvm use 24` or install from [nodejs.org](https://nodejs.org). |
| ffmpeg + ffprobe | `brew install ffmpeg` |
| yt-dlp | `brew install yt-dlp` |
| whisper-cpp | Optional. Only needed when a video has no auto-generated captions. |

> **Remotion** (Chromium-based renderer) runs from the `remotion/` sub-package — see Install below.

---

## Install

```bash
# 1. Install root dependencies
npm install

# 2. Install Remotion renderer dependencies
cd remotion && npm install && cd ..

# 3. Build TypeScript
npm run build
```

---

## Quick Start

```bash
node dist/cli/index.js all "https://www.youtube.com/watch?v=H14bBuluwB8"
```

ClipForge will preflight-check your tools, download the video, find the top 3 clips, and export them to `workspace/exports/H14bBuluwB8/`.

---

## Commands (Slice 1)

### `all <url>` — full pipeline

```
node dist/cli/index.js all <url> [options]

Options:
  --top <n>          Maximum number of clips to export  (default: 3)
  --min-score <x>    Absolute composite score floor     (default: auto)
  --style <s>        Caption style: minimal | card | bold  (default: bold)
  --accent <hex>     Accent colour for karaoke highlight   (default: #FFD700)
```

### `ingest <url>` — download + transcript only

```
node dist/cli/index.js ingest <url>
```

Runs just the download + transcript stages and exits. Useful for pre-caching or debugging the caption pipeline separately.

---

## Output Files

All outputs land in `workspace/exports/<jobId>/`:

| File | Description |
|------|-------------|
| `clip_NNN_final.mp4` | 9:16 (1080×1920) Remotion-rendered clip with karaoke captions |
| `clip_NNN_raw.mp4` | Raw 16:9 extract before reframe/captions |
| `clip_NNN.srt` | Word-level SRT subtitle file |
| `clip_NNN.json` | Per-clip metadata: scores, timing, transcript excerpt |
| `clips_manifest.json` | Job-level summary: all clips, scores, titles |

---

## Configuration

Create a `.env` file in the project root (all keys optional in Slice 1):

```env
# Gemini API key — unused in Slice 1; reserved for semantic scoring in Slice 2
GEMINI_API_KEY=

# Override workspace root (default: ./workspace)
WORKSPACE_DIR=./workspace

# Log verbosity: error | warn | info | debug  (default: info)
LOG_LEVEL=info
```

---

## FAQ

**Why no Python in Slice 1?**
YouTube's json3 auto-captions plus ffmpeg provide word-level timing with zero Python. whisper-cpp (a native binary) handles the fallback when captions are absent. The full ML stack — librosa, OpenCV, MediaPipe, diarization — lands in later slices inside an isolated Python 3.11 venv so the Node runtime stays fast and dependency-free for the common case.

**Can I run it offline after download?**
Yes. After the initial `yt-dlp` download completes, the transcript, analysis, clip detection, caption, and render stages are entirely local — no network calls, no cloud APIs in Slice 1.

**How long does it take per hour of video?**
Rough benchmarks on an M2 MacBook Pro:
- Download + json3 transcript: ~1–3 min depending on resolution and bandwidth.
- Analysis + clip detection: < 5 s (pure CPU, no ML).
- Remotion render per clip: ~20–60 s (Chromium headless, depends on clip length).
- Total for a 1-hour video with 3 clips: roughly 5–10 min.

---

## Architecture

```
YouTube URL
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Ingest (yt-dlp)                                        │
│  Download video.mp4 + .info.json + .json3 captions      │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Transcript                                             │
│  json3 → word-level timing  (whisper-cpp fallback)      │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Analysis                                               │
│  Audio energy (RMS + silence)  ×  Transcript triggers   │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Clip Detection                                         │
│  Sliding window scoring → boundary snap → merge/rank    │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Extraction                                             │
│  ffmpeg segment cut → clip_NNN_raw.mp4  (loudnorm)      │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Captions                                               │
│  Build caption words → .srt  (karaoke highlight)        │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Export (Remotion)                                      │
│  9:16 reframe + captions → clip_NNN_final.mp4           │
│  clip_NNN.json + clips_manifest.json                    │
└─────────────────────────────────────────────────────────┘
```

---

## Slice Roadmap

| Slice | Scope |
|-------|-------|
| **1 (this)** | Full skeleton: ingest → transcript → analysis → detection → extraction → captions → export. json3 captions, audio energy, linguistic triggers, Remotion 9:16 render. |
| 2 | Gemini semantic scoring, hook-card generation, hook prompt integration. |
| 3 | librosa beat/laughter/music detection, full audio layer. |
| 4 | OpenCV/MediaPipe visual saliency, pacing layer, smart-cut, subject reframing. |
| 5 | Diarization, multi-speaker captions, profanity filter. |
| 6 | Job/resume system, batch mode, progress persistence. |
| 7 | Polish: web UI, thumbnail generation, TikTok/Reels/Shorts direct upload. |

---

## Running Tests

```bash
# Offline unit + integration tests (no network required)
npm test

# Gated end-to-end test (requires network, yt-dlp, Remotion)
RUN_E2E=1 npx vitest run tests/e2e/pipeline.e2e.test.ts
```

---

## License

MIT
