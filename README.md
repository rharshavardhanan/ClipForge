# ClipForge

ClipForge is a local-first AI short-form video **editor engine** — not a clip extractor. Feed it YouTube URLs or local video files and it finds the strongest moments (semantic scoring + audio energy + linguistic triggers + viewer-flagged comment timestamps), reframes them to 9:16 with face-tracked pan/zoom, burns preset-styled karaoke captions, lays a mood-matched ducked music bed underneath, adds sparing punch zooms, and exports ready-to-post finals. Point it at several videos and it cross-ranks the best moments into one leaderboard — and can stitch them into a **#N→#1 countdown ranking video** with rank cards and badges. All processing runs on your machine; only the optional Gemini semantic-scoring calls leave it.

---

## Requirements

| Tool | Notes |
|------|-------|
| macOS | Tested on macOS 14+. Linux should work but is untested. |
| Node 24 | Required. Use `nvm use 24` or install from [nodejs.org](https://nodejs.org). |
| ffmpeg + ffprobe | `brew install ffmpeg` |
| yt-dlp | `brew install yt-dlp` — not needed for local-file input |
| whisper-cpp | Optional. Needed for local files and videos without auto-captions. |

> **Remotion** (Chromium-based renderer) runs from the `remotion/` sub-package; the **GUI** runs from the `ui/` sub-package — see Install.

---

## Install

```bash
# 1. Root dependencies
npm install

# 2. Remotion renderer dependencies
cd remotion && npm install && cd ..

# 3. GUI dependencies (optional — only for `clipforge ui`)
cd ui && npm install && cd ..

# 4. Build TypeScript
npm run build
```

---

## Quick Start

```bash
# One video → top clips
node dist/cli/index.js all "https://www.youtube.com/watch?v=H14bBuluwB8"

# A local recording (transcript via whisper-cpp)
node dist/cli/index.js process ~/Videos/podcast_ep12.mp4

# Several videos → one cross-ranked leaderboard + countdown ranking video
node dist/cli/index.js batch URL1 URL2 URL3 --top 5 --ranking

# The GUI
node dist/cli/index.js ui        # → http://localhost:3210
```

---

## Commands

| Command | What it does |
|---------|--------------|
| `all <input>` | Full pipeline for one YouTube URL **or local file** |
| `process <file>` | Same pipeline, local video file only |
| `ingest <url>` | Download + transcript only (pre-cache / debugging) |
| `batch <inputs...>` | Analyze N videos, rank the best moments **across all of them**, export the global top-N. Accepts URLs, file paths, or one `.txt` with one input per line |
| `rank <exportsDir>` | Render `ranking_final.mp4` (#N→#1 countdown) from an existing export dir |
| `ui` | Launch the local GUI (Import / Clips / Style / Rank / Export tabs) |

### Shared options (`all`, `process`, `batch`)

```
--top <n>              max clips to export             (all/process: 3, batch: 5)
--min-score <x>        absolute composite floor        (default: auto)
--style <preset>       mrbeast | hormozi | gadzhi | gaming | podcast |
                       cinematic | minimal | card | bold        (default: bold)
--accent <hex>         accent / active-word color      (default: #FFD700)
--font <name>          anton|bangers|archivo|montserrat|poppins|inter
--font-size <px>       caption size override
--caption-color <hex>  caption base color override
--stroke <px>          caption stroke width override
--position <p>         bottom | center
--no-music             disable the background music bed
--music-volume <v>     music level 0-1 before ducking  (default: 0.25)
--music-dir <p>        music library folder            (default: ./music)
--no-zooms             disable punch zooms on emphasized moments
```

`batch` adds `--per-video-cap <n>` (stop one video monopolizing the leaderboard) and `--ranking` (render the countdown video after export). `rank` takes `--accent` and `--card-seconds`.

---

## Music library

Drop royalty-free tracks into `./music`, tagged by mood either as subfolders or filename prefixes:

```
music/
  intense/drums.mp3          # subfolder convention
  funny_kazoo.mp3            # prefix convention
  motivational/rise.mp3
  chill/lofi.mp3             # fallback mood
```

Moods: `intense · funny · motivational · suspense · emotional · chill`. Each clip's Gemini sentiment picks the mood (funny→funny, intense→intense, serious→motivational, neutral→chill); the bed is looped/trimmed, faded, and **sidechain-ducked under speech**. No matching track → the clip ships without music.

---

## GUI

`node dist/cli/index.js ui` starts a local Next.js app (default port 3210):

- **Import** — paste URLs / file paths (multi-line = batch), pick top-N, run; live log stream.
- **Clips** — preview every exported final (with captions/music), score & sentiment badges, `.srt`/`.json`/raw downloads.
- **Style** — preset gallery + accent color, music and punch-zoom toggles; applies to Import runs.
- **Rank** — render/re-render the #N→#1 countdown video for any multi-clip export.
- **Export** — every export's path, one click to copy.

The GUI shells out to the same CLI (`dist/cli/index.js`), so behavior is identical to the terminal.

---

## Output Files

All outputs land in `workspace/exports/<jobId>/` (batches: `workspace/exports/batch_<hash>/`):

| File | Description |
|------|-------------|
| `clip_NNN_final.mp4` | 9:16 (1080×1920) final — reframed, captioned, music bed, punch zooms |
| `clip_NNN_raw.mp4` | Raw extract before reframe/captions |
| `clip_NNN.srt` | Word-level SRT subtitle file |
| `clip_NNN.json` | Per-clip metadata: layer scores, timing, transcript excerpt |
| `clips_manifest.json` | Job-level summary (batches record each clip's source video) |
| `ranking_final.mp4` | #N→#1 countdown video (`--ranking` or `rank` command) |

---

## Configuration

Create a `.env` in the project root (everything optional — without Gemini keys the scorer falls back to audio+trigger analysis):

```env
# Gemini semantic scoring — one key, or several to multiply free-tier quota
GEMINI_API_KEY=
GEMINI_API_KEYS=key1,key2,key3
GEMINI_MODEL=gemini-2.5-flash

# Paths
WORKSPACE_DIR=./workspace
MUSIC_DIR=./music

# Log verbosity: error | warn | info | debug
LOG_LEVEL=info
```

---

## Architecture

```
inputs (YouTube URLs / local files)
    │
    ▼
Ingest ──── yt-dlp download + info.json + json3 captions + top-100 comments
    │        (local files: copy into workspace, whisper transcript)
    ▼
Transcript ─ json3 word timing → whisper-cpp fallback
    │
    ▼
Analysis ── audio energy (RMS/silence) × linguistic triggers
    │        × Gemini semantic windows × comment-timestamp boosts
    ▼
Clip detection ─ sliding-window composite → boundary snap → merge/rank
    │             (batch: pool candidates, rank globally across videos)
    ▼
Extraction ── full-frame cut → multi-face detection → active-speaker
    │           crop-track → zero-lag smoothing
    ▼
Render (Remotion) ── 9:16 reframe + preset captions + hook card
    │                 + punch zooms  → clip_NNN_final.mp4
    ▼
Music ── mood-matched bed, looped/faded, sidechain-ducked under speech
    │
    ▼
Exports ── clips + srt + json + manifest   (+ ranking_final.mp4 countdown)
```

---

## Running Tests

```bash
# Offline unit + integration tests (no network required)
npm test

# Gated end-to-end test (requires network, yt-dlp, Remotion)
RUN_E2E=1 npx vitest run tests/e2e/pipeline.e2e.test.ts
```

---

## Known deferrals

Speaker diarization / split-speaker framing, librosa-grade audio features (laughter/beat detection), replay-graph signals, and a queue/DB job system (stage-level workspace caching already gives resumability) are intentionally not in this build.

## License

MIT
