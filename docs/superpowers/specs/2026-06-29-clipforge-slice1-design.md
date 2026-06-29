# ClipForge — Slice 1 Design (End-to-End Skeleton)

**Date:** 2026-06-29
**Status:** Approved for spec review
**Author:** Claude (Opus 4.8) with rharshavardhanan

---

## 1. Purpose

Slice 1 is the **thinnest runnable vertical slice** of ClipForge: one command takes a
YouTube URL and produces **at least one finished, post-ready 9:16 captioned clip**. Its
job is not feature completeness — it is to **prove every hard integration end-to-end**
(yt-dlp → transcript → scoring → ffmpeg crop → Remotion caption render → export) so that
every later slice layers onto a working skeleton instead of integrating against unknowns.

The full ClipForge master spec is the long-term target. This document scopes **only
Slice 1**. Later slices are listed in §3 for context but are explicitly out of scope here.

### Validation target

```
https://www.youtube.com/watch?v=H14bBuluwB8
```

David Goggins, ~15 min, talking-head, high energy, rapid speech with natural pauses and
trigger-friendly language ("nobody", "the truth is", "listen"). Chosen because the best
moments are obvious by ear, so scoring correctness is human-verifiable.

---

## 2. Environment & Platform Constraints

Target machine is the developer's actual environment, **not** the master spec's assumed
Linux/CUDA box. The spec's `apt-get`, `device="cuda"`, and `compute_type="float16"`
assumptions do **not** apply and must not appear in Slice 1.

| Tool | Detected | Notes |
|---|---|---|
| OS / arch | macOS (Darwin), **arm64** (Apple Silicon) | No NVIDIA CUDA available |
| Node | v24.9.0 | ✓ |
| npm | 11.6.0 | ✓ |
| ffmpeg / ffprobe | 8.1.1 | ✓ — primary media engine |
| Python | **3.14.0** | ⚠️ Too new for `faster-whisper`/`mediapipe`/`librosa`/`torch` wheels. **Avoided entirely in Slice 1.** |
| yt-dlp | **not installed** | Hard prerequisite — see §10 preflight |
| Gemini API key | not set | Not needed in Slice 1 |

**Consequence:** Slice 1 uses **zero Python**. Transcription comes from YouTube's own
word-timed captions; audio analysis comes from ffmpeg filters. The Python-ML stack
(faster-whisper, librosa, OpenCV, MediaPipe) is deferred to later slices, where it will
run in a dedicated **Python 3.11/3.12 venv** rather than system Python 3.14.

---

## 3. Slice Roadmap (context only — not built here)

| Slice | Delivers | Key new dependency |
|---|---|---|
| **1 — Skeleton** *(this doc)* | YouTube URL → ≥1 finished 9:16 captioned clip | yt-dlp |
| 2 — Intelligence | Gemini semantic layer (A) + hook generation + burned-in hook card | Gemini key |
| 3 — Analysis depth | librosa audio (laughter/applause/silence), OpenCV visual, pacing, metadata signals | Python 3.11 venv |
| 4 — Reframing | MediaPipe face tracking, smoothed crop, two-speaker handling | mediapipe in venv |
| 5 — Robustness | Job system + resume + cache, batch mode, local-file & audio-only inputs, diarization | — |
| 6 — Polish | smart-cut pacing, profanity filter, meme zoom, category classifier, bonus features | — |

Nothing from Slices 2–6 is stubbed. Those modules are simply **not created yet**. Slice 1
code is structured so they slot in cleanly (stable type contracts, layered scorer).

---

## 4. Scope

### In scope (Slice 1)

- `clipforge all <url>` end-to-end command + `clipforge ingest <url>` checkpoint command
- **Dependency preflight** that fails fast with actionable install hints (hard requirement)
- yt-dlp download (≤1080p mp4) + json3 auto-subs + `--write-info-json` metadata + ffprobe probe
- Transcript: parse YouTube **json3** captions into word-level timing; **whisper.cpp** (Metal) fallback
- Lite scoring: **transcript triggers (Layer D)** + **ffmpeg-based audio energy** (RMS curve + silence)
- Sliding-window scorer + adjacent-window merge + rank + boundary snapping + cold-open trim
- Extraction: ffmpeg frame-accurate cut + **center-crop to 1080×1920** + loudness normalize (−14 LUFS)
- Captions: word-level karaoke via **Remotion** (`CaptionedClip` composition) + grouped `.srt`
- Export: `clip_NNN_final.mp4`, `clip_NNN_raw.mp4`, `clip_NNN.srt`, `clip_NNN.json`, `clips_manifest.json`
- winston logging + ora progress + `withRetry` exponential backoff on external calls

### Explicitly deferred (built in the named slice, never stubbed)

Gemini semantic/hook layers (2) · burned-in hook card (2) · librosa/OpenCV/pacing/metadata
layers (3) · MediaPipe face reframing (4) · speaker diarization (4) · job/resume/cache
system (5) · local-file & audio-only inputs (5) · batch mode (5) · smart-cut, profanity
filter, meme zoom, category classifier, all §17 bonus features (6).

---

## 5. Architecture & Data Flow

```
clipforge all <url>
        │
        ▼
┌──────────────────┐   workspace/downloads/{jobId}/
│  PREFLIGHT       │   - check yt-dlp + ffmpeg + ffprobe, fail fast
└────────┬─────────┘
         ▼
┌──────────────────┐   video.mp4, video.info.json, video.en.json3
│  INGEST          │   downloader.ts (yt-dlp) → metadataExtractor.ts (ffprobe)
└────────┬─────────┘   → VideoMetadata
         ▼
┌──────────────────┐   workspace/transcripts/{jobId}/transcript.json
│  TRANSCRIPT      │   json3 parse → word timing  (fallback: whisper.cpp)
└────────┬─────────┘   → TranscriptSegment[] (with words[])
         ▼
┌──────────────────┐   workspace/analysis/{jobId}/
│  ANALYSIS (lite) │   triggers (TS)  +  audio energy (ffmpeg ebur128/astats/silencedetect)
└────────┬─────────┘   → layer_triggers.json, layer_audio.json
         ▼
┌──────────────────┐   workspace/analysis/{jobId}/clips_ranked.json
│  CLIP DETECTION  │   window scorer → merge → boundary snap → cold-open trim → rank
└────────┬─────────┘   → RankedClip[]
         ▼
┌──────────────────┐   workspace/clips/{jobId}/clip_NNN_raw.mp4
│  EXTRACTION      │   ffmpeg cut + center-crop 1080×1920 + loudnorm −14 LUFS
└────────┬─────────┘
         ▼
┌──────────────────┐   workspace/exports/{jobId}/clip_NNN_final.mp4 + .srt
│  CAPTIONS        │   srtGenerator.ts + remotionRenderer.ts (CaptionedClip)
└────────┬─────────┘
         ▼
┌──────────────────┐   workspace/exports/{jobId}/clip_NNN.json + clips_manifest.json
│  EXPORT          │   exporter.ts assembles per-clip metadata + manifest
└──────────────────┘
```

**jobId:** the YouTube video id when available (`H14bBuluwB8`), else a uuid. Stable id
gives us free cache reuse (skip re-download/re-transcribe if artifacts exist) and a clean
handoff to the full job system in Slice 5.

---

## 6. Component Breakdown

Each unit has one purpose, a typed interface, and explicit dependencies.

### 6.1 `src/cli/index.ts`
- **Does:** commander entrypoint; runs `checkDependencies()` (§10) before any command; wires `all` and `ingest`.
- **Depends on:** all command modules, utils/logger.

### 6.2 `src/ingest/downloader.ts`
- **Does:** spawn yt-dlp to download best ≤1080p mp4, write `--write-info-json`, fetch `en/en-US/en-GB` auto+manual subs in **json3** format. Streams `--newline --progress-template` output to an ora bar. Wrapped in `withRetry`.
- **Interface:** `download(url, outDir): Promise<{ videoPath, infoJsonPath, subtitlePath | null }>`
- **yt-dlp args (canonical):**
  ```
  <url>
  -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
  --merge-output-format mp4
  --write-auto-subs --write-subs --sub-langs "en.*" --sub-format json3
  --write-info-json --no-playlist
  --retries 5 --fragment-retries 5
  --newline -o "<outDir>/video.%(ext)s"
  ```

### 6.3 `src/ingest/metadataExtractor.ts`
- **Does:** ffprobe the downloaded file for duration/width/height/fps/codec; merge with `info.json` (title, description, chapters, view/like counts, channel, uploadDate, tags). Persists `metadata.json`.
- **Interface:** `extractMetadata(videoPath, infoJsonPath, jobId): Promise<VideoMetadata>`

### 6.4 `src/transcript/transcriptManager.ts`
- **Does:** orchestrate the waterfall — (1) parse YouTube json3 if present, (2) else whisper.cpp. Persists `transcript.json`. Caches by source video id.
- **Interface:** `getTranscript(jobId, videoPath, subtitlePath | null): Promise<TranscriptSegment[]>`

### 6.5 `src/transcript/youtubeTranscript.ts`
- **Does:** parse json3 events into word-level timing. Each event has `tStartMs` + `segs[]` where each seg has `utf8` text and optional `tOffsetMs`; word start = `tStartMs + tOffsetMs`, word end = next word's start (or event end). **Dedup rolling cues** (YouTube auto-captions repeat words across overlapping events for the scroll effect — keep first occurrence's timing, drop repeats). Group words into sentence-ish segments on punctuation / gaps > 0.8s.
- **Interface:** `parseJson3(path): TranscriptSegment[]`

### 6.6 `src/transcript/whisperRunner.ts`
- **Does:** fallback only. Extract 16kHz mono wav via ffmpeg, run `whisper-cli` (Homebrew `whisper-cpp`) with json output + token timestamps, map tokens → words. Auto-download `ggml-base.en.bin` to `workspace/models/` on first use. Metal is on by default in the Homebrew build.
- **Interface:** `transcribe(videoPath): Promise<TranscriptSegment[]>`
- **Note:** checked lazily — only required if json3 subs are unavailable.

### 6.7 `src/analysis/transcriptTriggers.ts`
- **Does:** Layer D. Tiered keyword/phrase + structural matching over transcript words. Tier-1 +2.5, Tier-2 +1.5, Tier-3 +0.5, structural markers (question→answer, number statements, contrast "but/however") +1.0. Emits per-match `{ time, weight, phrase, tier }`.
- **Interface:** `detectTriggers(segments): TriggerHit[]`  → persisted as `layer_triggers.json`

### 6.8 `src/analysis/audioEnergy.ts`
- **Does:** Layer B (ffmpeg-only subset). Computes a **per-second RMS curve** and **silence regions** without librosa:
  - RMS curve: `ffmpeg -i <v> -af "aresample=16000,astats=metadata=1:reset=16000,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level" -f null -` → parse `RMS_level=` lines (dBFS per ~1s) → normalize to 0–10 (`-50 dB → 0`, `-10 dB → 10`, clamp).
  - Silence: `ffmpeg -i <v> -af "silencedetect=noise=-40dB:d=0.5" -f null -` → parse `silence_start` / `silence_end`.
- **Interface:** `analyzeAudio(videoPath): Promise<AudioEnergyLayer>`  → persisted as `layer_audio.json`
- **Deferred to Slice 3:** laughter/applause/music/speech-rate detection (need librosa).

### 6.9 `src/clipDetection/windowScorer.ts`
- **Does:** slide a 30s window with 15s step. Per window compute `triggerScore` (sum of in-window trigger weights, normalized/capped to 0–10) and `audioScore` (mean normalized RMS in window). **Slice-1 composite** (only two real signals, renormalized; structured to accept all six later):
  ```
  composite = triggerScore * 0.6 + audioScore * 0.4
  ```
  The full master-spec 6-weight formula (semantic .35 / audio .20 / visual .15 / triggers .15 / pacing .10 / metadata .05) is the **Slice 3 target**; the `RankedClip` type already carries all six fields (others = 0 in Slice 1).
- **Interface:** `scoreWindows(duration, triggers, audio): WindowScore[]`

### 6.10 `src/clipDetection/merger.ts`
- **Does:** select peak windows above threshold, expand each backward/forward in 5s steps while composite stays above a relative floor, merge overlapping candidates (IOU > 0.5), then snap boundaries:
  - **Start snap:** nearest sentence boundary or pause > 0.3s; never mid-word. **Cold-open rule:** trim leading silence > 0.5s so the clip opens on speech.
  - **End snap:** after a sentence end / pause; never mid-sentence unless duration > 85s.
  - Target 30–90s, **hard cap 90s**.
- **Interface:** `buildClips(windows, segments, audio): ClipCandidate[]`

### 6.11 `src/clipDetection/ranker.ts`
- **Does:** sort candidates by composite desc, dedup by transcript overlap > 40% (keep higher score), assign `clip_001…`, take top `--top` (default 3). Persists `clips_ranked.json`.
- **Interface:** `rank(candidates, opts): RankedClip[]`

### 6.12 `src/extraction/clipExtractor.ts`
- **Does:** frame-accurate cut + center-crop to vertical + audio normalize in one encode → `clip_NNN_raw.mp4`. If source is already ~9:16 (portrait), skip the crop (cheap guard; full portrait handling is Slice 6).
  ```
  ffmpeg -ss <start> -i <video> -t <dur> \
    -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1" \
    -af "loudnorm=I=-14:TP=-1.5:LRA=11" \
    -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k \
    <out_raw.mp4>
  ```
- **Interface:** `extractRaw(video, clip, outPath): Promise<void>`  (wrapped in `withRetry`)

### 6.13 `src/extraction/audioProcessor.ts`
- **Does:** Slice 1 = the loudnorm filter string + leading/trailing silence-trim offsets (derived from §6.8 silence regions, folded into clip start/end). De-essing / music fade deferred to later slices.
- **Interface:** `buildAudioFilter(clip, silenceRegions): string`

### 6.14 `src/captions/srtGenerator.ts`
- **Does:** group word timings into upload-friendly cues (≤ 4 words/line, ≤ 2 lines), emit standard `clip_NNN.srt` (HH:MM:SS,mmm). (Remotion does the true word-by-word animation; the `.srt` is for platform upload, so grouped cues are intentional.)
- **Interface:** `writeSrt(words, outPath): void`

### 6.15 `src/captions/remotionRenderer.ts`
- **Does:** write props to a temp JSON, spawn `npx remotion render` against the `remotion/` subproject, stream progress to ora, output `clip_NNN_final.mp4`. Wrapped in `withRetry`.
  ```
  npx remotion render CaptionedClip \
    --props=<temp.json> --output=<final.mp4> \
    --codec=h264 --crf=18 --pixel-format=yuv420p
  ```
- **Interface:** `render(props, outPath): Promise<void>`

### 6.16 `src/export/exporter.ts`
- **Does:** assemble `clip_NNN.json` per clip and the top-level `clips_manifest.json` (§9).
- **Interface:** `writeManifest(jobId, metadata, clips): void`

### 6.17 `src/utils/`
- `logger.ts` (winston, level from `LOG_LEVEL`), `progress.ts` (ora helpers), `retry.ts`
  (`withRetry`, 3 attempts @ 1s/4s/16s), `ffmpeg.ts` (spawn helpers, stderr parsing,
  ffprobe JSON), `cmd.ts` (promisified child_process spawn with streamed output).

### 6.18 `src/types/index.ts`
- All shared types (§8). Single source of truth; later slices extend, never fork.

### 6.19 `remotion/` subproject
- `src/Root.tsx` (registers `CaptionedClip`, 1080×1920, fps from props, durationInFrames from props)
- `src/CaptionedClip.tsx` (base `<Video>` cover-fit + `<CaptionTrack>`; `<HookCard>` mounted but gated `showHookCard=false` in Slice 1 → lands in Slice 2)
- `src/Caption.tsx` (word-by-word karaoke; active word scale 120% + accent color; appears 50ms before its audio; ≤4 words/line, 2 lines; line scroll/fade)
- `src/HookCard.tsx` (present, inert in Slice 1)
- Font `Anton` via `@remotion/google-fonts/Anton` (bundled, offline-safe)

---

## 7. CLI Surface (Slice 1)

```bash
clipforge all <url> [--top <n>=3] [--min-score <x>] [--style minimal|card|bold]
                    [--accent <#hex>=#FFD700]
clipforge ingest <url>        # download + metadata + transcript only (debug checkpoint)
```

**`--min-score` default:** omitted → derived from the window-score distribution as
`mean + 0.5·stddev` (the Slice-1 composite uses a 2-signal scale, so the master spec's
fixed 6.5 does not apply). When passed, it is an absolute floor on `composite_score`. This
same threshold is the "above threshold" peak-selection floor in §6.9–6.10. `--top` then
caps how many of the surviving ranked clips are exported.

The master spec's `process` / `rank` / `export` sub-commands and flags (`--diarize`,
`--profanity`, `--smart-cut`, `--comments`, `clipforge jobs|inspect|resume`) arrive with
the job system in Slice 5. Caption default style: **`bold`**.

---

## 8. Data Contracts (types)

Stable across all slices. Slice 1 populates a subset; deferred fields take documented zero/empty defaults.

```typescript
interface TranscriptWord { start: number; end: number; word: string; probability: number; }
interface TranscriptSegment {
  id: number; start: number; end: number; text: string;
  words: TranscriptWord[]; speaker?: string;   // speaker = Slice 4
}

interface VideoMetadata {
  jobId: string; title: string; duration: number;
  width: number; height: number; fps: number; codec: string;
  chapters: { title: string; start: number; end: number }[];
  description: string;
  viewCount?: number; likeCount?: number; commentCount?: number;
  tags?: string[]; uploadDate?: string; channelName?: string;
  topComments?: { text: string; likes: number }[];   // Slice 2+
}

interface TriggerHit { time: number; weight: number; phrase: string; tier: 1|2|3|'structural'; }
interface AudioEnergyLayer {
  rms_curve: { time: number; rms: number }[];          // rms normalized 0–10
  silence_regions: { start: number; end: number }[];
  // laughter/speech_rate/volume_spikes/music = Slice 3
}

interface RankedClip {
  rank: number; clip_id: string; start: number; end: number; duration: number;
  composite_score: number;
  semantic_score: number;  // 0 in Slice 1
  audio_score: number;
  visual_score: number;    // 0 in Slice 1
  trigger_score: number;
  pacing_score: number;    // 0 in Slice 1
  metadata_score: number;  // 0 in Slice 1
  hook_moment: string;     // "" in Slice 1 (Gemini = Slice 2)
  clip_titles: string[];   // [] in Slice 1
  is_standalone: boolean;  // true default in Slice 1
  recommended_duration: number;
  reason: string;          // trigger/audio-derived in Slice 1
  transcript_excerpt: string;
}
```

---

## 9. Output File Specification

```
workspace/exports/{jobId}/
├── clip_001_final.mp4   # Remotion render: cropped video + karaoke captions
├── clip_001_raw.mp4     # cropped 1080×1920 + −14 LUFS audio, no captions
├── clip_001.srt         # grouped cues (≤4 words/line) for platform upload
├── clip_001.json        # per-clip metadata (RankedClip + files block)
└── clips_manifest.json  # job-level summary
```

`clips_manifest.json`:
```json
{
  "job_id": "H14bBuluwB8",
  "source": "https://www.youtube.com/watch?v=H14bBuluwB8",
  "title": "...", "processed_at": "<ISO>",
  "total_duration": 0, "clips_generated": 3,
  "top_score": 0.0, "avg_score": 0.0,
  "clips": [ /* RankedClip + files */ ]
}
```

---

## 10. Dependency Preflight (hard requirement)

Runs in `cli/index.ts` **before any command body executes**. Not a README note — an actual
runtime gate, so a fresh machine fails in <1s with a fix, not 30s into a download.

```typescript
async function checkDependencies() {
  const checks = [
    { cmd: 'yt-dlp --version',  name: 'yt-dlp',  hint: 'brew install yt-dlp' },
    { cmd: 'ffmpeg -version',   name: 'ffmpeg',  hint: 'brew install ffmpeg' },
    { cmd: 'ffprobe -version',  name: 'ffprobe', hint: 'brew install ffmpeg' },
  ];
  const missing = [];
  for (const c of checks) {
    try { await exec(c.cmd); } catch { missing.push(c); }
  }
  if (missing.length) {
    logger.error('Missing required tools:\n' +
      missing.map(m => `  ✗ ${m.name} — install with: ${m.hint}`).join('\n'));
    process.exit(1);
  }
}
```

- `whisper-cpp` is **not** in this gate — it is checked lazily inside `whisperRunner.ts`
  only when json3 subs are unavailable, with hint `brew install whisper-cpp`.
- Node deps (`remotion`, etc.) are assumed installed via `npm install`; a missing
  `remotion/node_modules` produces a clear "run `npm install` in remotion/" error.

---

## 11. Error Handling

- Every external call (yt-dlp, ffmpeg, whisper-cli, remotion) wrapped in `withRetry`
  (3 attempts, 1s/4s/16s backoff) with a labelled logger warning per retry.
- **Fallback paths:** json3 subs missing → whisper.cpp; whisper.cpp missing → actionable error.
- Partial artifacts in `workspace/` are preserved on failure (re-run reuses them via jobId).
- Failures log a stack trace and exit non-zero with a one-line human cause.

---

## 12. Validation Plan (how we know Slice 1 works)

Run: `clipforge all https://www.youtube.com/watch?v=H14bBuluwB8`

**Automated/observable success criteria:**
1. Preflight passes (after `brew install yt-dlp`); missing-tool case exits in <1s with hint.
2. Download yields an ≤1080p `video.mp4` + `video.info.json` + `video.en.json3`.
3. `transcript.json` has word-level timings; spot-check 3 words land within ~150ms by ear.
4. `layer_audio.json` RMS curve + silence regions present; `layer_triggers.json` fires on
   "nobody" / "the truth is" / "listen".
5. `clips_ranked.json` has ≥1 clip, each 30–90s, none mid-word at start.
6. `clip_001_raw.mp4` is exactly 1080×1920; `ffprobe` confirms; loudness near −14 LUFS.
7. `clip_001_final.mp4` plays with karaoke captions synced to speech, ≤4 words/line, active
   word in accent `#FFD700`, and **opens on speech within 1s** (cold-open rule).
8. `clips_manifest.json` + per-clip `.json` + `.srt` written and internally consistent.

**Human judgment:** the rank-1 clip should be a recognizably strong Goggins moment.

---

## 13. Assumptions

- The target video has English auto-captions in json3 (true for this video). Manual subs preferred if present.
- Source is 16:9; a cheap portrait guard skips crop if already ~9:16 (full handling = Slice 6).
- Remotion renders one clip at a time in Slice 1 (parallelism cap = Slice 5 concern).
- First commit of the repo is this spec doc on `main`; code lands on a feature branch after plan approval.
```
