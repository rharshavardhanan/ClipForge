# ClipForge

ClipForge is a local-first AI short-form video **editor engine** — not a clip extractor. Feed it YouTube URLs or local video files and it finds the strongest moments (semantic scoring + audio energy + linguistic triggers + viewer-flagged comment timestamps), reframes them to 9:16 with face-tracked pan/zoom, burns preset-styled karaoke captions, lays a mood-matched ducked music bed underneath, adds sparing punch zooms, and exports ready-to-post finals. Point it at several videos and it cross-ranks the best moments into one leaderboard — and can stitch them into a **#N→#1 countdown ranking video** with rank cards and badges. All processing runs on your machine; only the optional semantic-scoring calls (Claude, or Gemini as fallback) leave it.

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
| `rankrot <topic>` | **RankRot**: topic → internet clip harvest → AI ranking → brainrot Top-N countdown Short |
| `stats [dirs...]` | **AVSS RL loop**: pull real YouTube metrics for uploaded clips → update the editing policy → promote ≥70% retention edits to `./elite_templates/` |
| `ui` | Launch the local GUI (Import / Clips / Style / Rank / RankRot / Export tabs) |

### Shared options (`all`, `process`, `batch`)

```
--top <n>              max clips to export             (all/process: 3, batch: 5)
--min-score <x>        absolute composite floor        (default: auto)
--mode <m>             auto | clippies | mindcuts      (default: auto-detect per video)
--broll                force contextual B-roll (narrative overlay) on
--no-broll             disable contextual B-roll       (default: on for mindcuts)
--broll-dir <p>        B-roll cache folder             (default: ./broll_cache)
--max-broll <n>        max overlays per clip           (default: mode-dependent)
--style <preset>       mrbeast | hormozi | gadzhi | gaming | podcast |
                       cinematic | minimal | card | bold   (default: the mode's preset)
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
--no-sfx               disable sound-design SFX (whoosh on zooms, impact under hook)
--sfx-volume <v>       SFX one-shot level 0-1          (default: 0.6)
--sfx-dir <p>          SFX library folder              (default: ./sfx)
```

`batch` adds `--per-video-cap <n>` (stop one video monopolizing the leaderboard) and `--ranking` (render the countdown video after export). `rank` takes `--accent` and `--card-seconds`.

---

## Content modes (v6)

Two editing grammars; `--mode auto` (default) picks one per video from the title/channel, the semantic profile, and duration:

| | **Clippies** — creator energy | **MindCuts** — podcast/story |
|---|---|---|
| Clip length | 15–45s (soft cap 25s) | 20–60s (soft cap 45s) |
| Ranking favors | humor, surprise, intensity, sharp points | wisdom, storytelling, controversy, relatability |
| Punch zooms | full punch | subtle (~half amplitude) |
| Caption default | `mrbeast` | `podcast` |
| Contextual B-roll | off by default | **on by default** (up to 4 overlays/clip) |

---

## AVSS — Autonomous Viral Selection System (v7)

Every clip's edit is **tested before it is rendered**. The pipeline builds an explicit edit plan (hook, caption preset, zoom times/intensity, SFX, B-roll windows), generates three variants, and scores each against a deterministic **audience simulator** — attention curve, dopamine spikes, swipe hazard, retention survival curve, rewatch likelihood. Only the winner is rendered (one render per clip, always).

- **Variants** explore only hook text, caption preset (within the mode's family), zoom timing/intensity, and SFX — never framing, B-roll, or music. Explicit flags pin their dimension (`--style` freezes the preset, `--no-zooms` freezes zooms off).
- **Consistency regulator** clamps every variant: ≤2 zooms per 10s (min 2.5s apart), ≤40% B-roll coverage, ≤8-word hooks, intensity within [0.3, 1.3] — exploration can never produce a chaotic edit.
- **Editing policy** (`workspace/policy/policy.json`) is a per-mode epsilon-greedy bandit (90% exploit / 10% explore) over those dimensions, updated only by **real** performance.
- **The learning loop:** upload clips → wait for views → `clipforge stats`. It pulls views/likes/comments (Data API) and retention/completion/shares (Analytics API — re-run `auth youtube` once to grant the `yt-analytics.readonly` scope on older tokens), computes the reward (0.35 retention + 0.20 completion + 0.20 rewatch + 0.10 likes + 0.10 comments + 0.05 shares — Shorts looping past 100% avg-view counts as rewatch), updates the policy, and saves the **edit DNA** of any short with ≥70% real retention to `./elite_templates/elite_template_vN.json`. Future runs seed variant A from the best matching template.
- Snapshots are append-only history in `workspace/performance/<videoId>.json`; predicted retention shows as a badge on each clip in the GUI.

## Contextual B-roll (narrative overlay)

For each exported clip, ClipForge asks Claude where B-roll would heighten the story — named
people get their real footage (*"Toto Wolff" → Toto Wolff Mercedes F1*), abstractions get
visual metaphors (*discipline → training montage*), emotions get relatable reaction shots.
Each cue becomes a YouTube search (`yt-dlp`), candidates are relevance-scored by Claude
(**only matches >8/10 are used**), and a short ≤720p segment is cached in `./broll_cache/`.

At render time the overlay is a **narrative overlay**: the A-roll keeps playing underneath —
the speaker's voice continues seamlessly — while the visual switches to the B-roll for 1.5–6s.
The hook (first 3s) and the payoff (last 2s) always stay on the speaker; overlays never cover
more than 40% of a clip; arrow callouts are suppressed while B-roll covers the face.
Placements are recorded in `broll_manifest.json` and each clip's `clip.json`. Requires an
LLM key (Claude primary, Gemini fallback) — without one, clips render without B-roll.

---

## RankRot — ranking editor (brainrot countdowns)

```bash
clipforge rankrot "best basketball dunks"          # Top 5 by default
clipforge rankrot "craziest fails" --top 7 --harvest 40
```

Give it a **topic**, get a ready-to-post countdown Short. The engine:

1. expands the topic into ~5 search variations targeting **popular REAL footage** —
   viral TikTok reposts, caught-on-camera clips (Gemini Flash; template fallback) — and
   searches YouTube via yt-dlp (only platform with a search extractor — TikTok/IG deferred)
2. harvests the **most-viewed** candidates into `./rankrot_cache/` (view-count sorted;
   AI-generated/animated/stock slop filtered by title/channel; mega-view compilations
   allowed — only their first 4 minutes are fetched). Cached across runs.
3. isolates each clip's strongest arc **adaptively (4–12s — each rank gets its own
   length)** by fusing a motion curve (ffmpeg `signalstats`) with a 0.5s loudness curve:
   the window grows in BOTH directions from the peak while the signal stays hot —
   backward keeps the context/build-up, forward keeps the payoff — plus a tail pad so
   clips never stop mid-action
4. ranks through five layers → `0.35·visual + 0.20·audio + 0.20·reaction + 0.15·virality
   + 0.10·novelty` (reaction = face presence/growth; virality = one Gemini Flash batch
   that also **flags AI-generated content for exclusion**, view-count fallback; novelty =
   frame aHash + title overlap, duplicates collapsed). **No Claude in this engine** (by spec).
5. renders the countdown **#5→#1, never reversed**: rank stinger cards, persistent left
   rank rail that fills as ranks play, multi-color brainrot top title +
   *"(last one is insane)"*, per-clip meme micro-captions ("BRO GOT COOKED"), camera-shake
   + punch-in on every clip, **slow-mo replay of the PEAK** on the 2 strongest (≤3.5s of
   source, starting ~1s before the fused peak), blur-backdrop framing for horizontal
   sources, native clip audio preserved (replays muted), and SFX (whoosh/impact/riser on
   #1 card/bass on #1 reveal)
6. writes `ranking_final.mp4`, `title.txt`, `description.txt`, `hashtags.txt`,
   `thumbnail.png` (#1's peak frame), and `rankrot_manifest.json` (full audit: queries,
   layer scores, picked moments) to `workspace/exports/rankrot_<topic>/`

GUI: the **RankRot** tab takes the topic, streams the run log, and plays the result.

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

## SFX library

Same convention for sound-design one-shots in `./sfx` — kinds: `whoosh · impact · pop · riser · bass`:

```
sfx/
  whoosh/swish.mp3           # played on each punch-zoom moment
  impact_boom.wav            # played under the hook card
```

A **whoosh** fires on every punch-zoom event (same timing as the visual zoom) and an **impact** lands under the hook card. Picks are deterministic per clip; an empty `./sfx` folder skips SFX silently.

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

## Publish to YouTube

One-time setup (~5 min, free):

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project → **APIs & Services → Library** → enable **YouTube Data API v3**.
2. **APIs & Services → OAuth consent screen** → External → add your Gmail under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Application type **Desktop app** → copy the client ID + secret into `.env` (`YT_CLIENT_ID`, `YT_CLIENT_SECRET`).
4. `./start.sh auth youtube` — your browser opens, log into the Gmail that owns the channel, click Allow. **Run it again with another account/brand channel to connect more channels** — every upload then asks which channel (GUI dropdown, or `--channel <name>` in the CLI).

Then upload any export — title, description, tags, and thumbnail come from the clip's SEO pack; "not made for kids" is declared; privacy defaults to public:

```bash
node dist/cli/index.js upload workspace/exports/<id>                     # all clips
node dist/cli/index.js upload workspace/exports/<id> --clips clip_001    # one clip
node dist/cli/index.js upload workspace/exports/<id> --dry-run           # preview metadata only
node dist/cli/index.js upload workspace/exports/<id> --privacy unlisted
```

Or in the GUI: **Clips tab → ▶ YouTube** on any clip → review the prefilled title/description → Upload.

Already-uploaded clips are skipped on re-runs (`--force` to re-upload); each clip's watch URL is recorded in its `.json`.

**Caveats:** until your Google Cloud app is published + verified (one-time audit), YouTube locks API uploads to **private** — ClipForge detects this and prints the Studio link to publish manually. The default API quota allows **~6 uploads/day** (resets midnight Pacific).

**Instagram Reels:** Meta's API requires a business account and a publicly hosted video URL, so ClipForge keeps it manual-but-instant: click **IG caption** on a clip (copies description + hashtags), drag `clip_NNN_final.mp4` into Instagram, paste.

---

## Output Files

All outputs land in `workspace/exports/<jobId>/` (batches: `workspace/exports/batch_<hash>/`):

| File | Description |
|------|-------------|
| `clip_NNN_final.mp4` | 9:16 (1080×1920) final — reframed, captioned, SFX, music bed, punch zooms |
| `clip_NNN_raw.mp4` | Raw extract before reframe/captions |
| `clip_NNN.srt` | Word-level SRT subtitle file |
| `clip_NNN.json` | Per-clip metadata: layer scores, timing, transcript excerpt, SEO pack |
| `clip_NNN_thumbnail.png` | MrBeast-style thumbnail (Remotion-rendered): loudest frame, face-punched zoom, vignette, huge stroked title |
| `clip_NNN_title.txt` | Click-optimized title + creator/#shorts tags |
| `clip_NNN_description.txt` | SEO description: hook line, source credit, hashtag block |
| `clip_NNN_hashtags.txt` | Full hashtag set (creator + viral + sentiment + niche), one per line |
| `clip_NNN_hook.txt` | Uppercase hook text (matches the burned-in hook card) |
| `clip_NNN_attention_graph.json` | AVSS: predicted attention curve (0.5s ticks) + dopamine spike events |
| `clip_NNN_retention_prediction.json` | AVSS: predicted retention survival curve, average, completion, drop-off points |
| `clip_NNN_swipe_risk.json` | AVSS: per-tick swipe hazard + top risk moments |
| `clip_NNN_rewatch_score.json` | AVSS: rewatch likelihood + factor breakdown |
| `clip_NNN_edit_variant_scores.json` | AVSS: all 3 edit variants (changed dims, regulator violations, predicted metrics, winner) |
| `clips_manifest.json` | Job-level summary (batches record each clip's source video) |
| `broll_manifest.json` | Per-clip narrative-overlay placements: entity, query, source URL, cached file, timing |
| `ranking_final.mp4` | #N→#1 countdown video (`--ranking` or `rank` command) |
| `ranking_titles.txt` | Countdown title options + per-rank lines |
| `ranking_description.txt` | Ranking video SEO description + hashtags |

Clip length is adaptive and mode-aware: sentence-snapped under the mode's soft cap (clippies 25s, mindcuts 45s), extending toward the mode max (45s / 60s) only while the surrounding moments hold peak-level heat (setup/payoff never cut mid-arc). Clips **always end on a sentence boundary** — a closing sentence may run up to ~3s past the cap rather than being cut mid-word.

**Fresh clips on re-runs:** every exported clip's time-range is recorded per source video; running the same video again automatically skips that material and surfaces new moments (`--allow-repeats` to reuse). **Arrow callouts:** on a clip's 1–2 strongest moments an animated arrow points at the speaker's face (only when face tracking found one — arrows never point at nothing; disabled together with `--no-zooms`).

---

## Configuration

Create a `.env` in the project root. Semantic scoring uses **Claude as the primary (highest-accuracy) brain** and **Gemini Flash as the redundant fallback**. Everything is optional — with no LLM key the scorer falls back to audio + linguistic-trigger analysis.

```env
# Claude — primary semantic scoring (title generation, viral scoring, hooks).
# Get a key at https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5     # default; any Claude model id
ANTHROPIC_EFFORT=medium             # low | medium | high | xhigh | max

# Gemini — redundant fallback (used when no Anthropic key, or Claude returns nothing).
# One key, or several to multiply free-tier quota.
GEMINI_API_KEY=
GEMINI_API_KEYS=key1,key2,key3
GEMINI_MODEL=gemini-2.5-flash

# Paths
WORKSPACE_DIR=./workspace
MUSIC_DIR=./music

# Log verbosity: error | warn | info | debug
LOG_LEVEL=info
```

**Provider selection:** if `ANTHROPIC_API_KEY` (or an `ant auth login` token) is present, ClipForge scores with Claude and prints `semantic: N windows (claude)`. If only Gemini keys exist, it uses Gemini. Semantic results are cached per provider (`layer_semantic_claude.json` / `layer_semantic_gemini.json`) so switching keys re-scores rather than reusing the other provider's output.

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
    │        × semantic windows (Claude → Gemini fallback) × comment boosts
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
Exports ── clips + srt + json + thumbnail + SEO texts + manifest   (+ ranking_final.mp4 countdown + ranking texts)
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
