# ClipForge v6 delta — Mode System + Contextual B-roll Engine

**Date:** 2026-07-03 · **Branch:** slice-1
**Spec source:** master spec "v6" (re-pasted 2026-07-03). Everything else in v6 is already
built (see memory/plans) or a documented deliberate deferral (split-screen framing,
BullMQ/SQLite, librosa, Faster-Whisper→whisper-cpp pivot, full 10-tab GUI).

The two genuinely new v6 systems:

1. **Mode system** — Clippies (high-energy creator clips) vs MindCuts (podcast/storytelling),
   with auto-detection.
2. **Automatic contextual B-roll** — entity/concept extraction per clip, YouTube search via
   yt-dlp, Claude relevance validation (>8), cached segment download to `./broll_cache/`, and
   **narrative overlay** rendering: A-roll audio continues while the visual switches to B-roll.
   Per user follow-up: search targets B-roll (contextual footage), A-roll of named people
   ("Toto Wolff" → real footage of them), and relatable/reaction clips.

## 1. Mode system

`src/modes.ts` — pure module.

```ts
type ContentMode = 'clippies' | 'mindcuts';
interface ModeProfile {
  name: ContentMode;
  lengths: { min: number; soft: number; max: number };   // merger caps
  captionPreset: string;          // default when user didn't pass --style
  brollDefault: boolean;          // B-roll on by default?
  maxBroll: number;               // overlay cap per clip
  zoomIntensity: number;          // punch-zoom amplitude multiplier
  priorities: (keyof SemanticScores)[]; // ranking emphasis
}
```

| | clippies | mindcuts |
|---|---|---|
| lengths | 15 / 25 / 45 | 20 / 45 / 60 |
| captionPreset | mrbeast | podcast |
| brollDefault | false | true |
| maxBroll | 1 | 4 |
| zoomIntensity | 1.0 (aggressive) | 0.55 (subtle) |
| priorities | humor, surprise, emotional_intensity, argument_peak | wisdom, storytelling_tension, controversy, relatability |

`detectMode(meta, semantic)` (pure): title/channel keywords (podcast, interview, ep/#N,
lecture → mindcuts; stream, gaming, reaction, rage, fails → clippies); else semantic
sentiment/subscore tally (humor+surprise vs wisdom+storytelling); else duration ≥30 min →
mindcuts, else clippies.

Wiring:
- CLI `--mode <auto|clippies|mindcuts>` on all/process/batch (default auto). Auto resolves
  **per video** after the semantic layer; batch runs may mix modes per source.
- `buildClips`/`clampDuration` gain an optional `lengths` param (defaults = current constants).
- `rank()` gains `opts.priorities`: candidates with an attached semantic window get
  `adjusted = composite + 1.5 * mean(scores[priorities])/10` used for sort+dedup order
  (composite itself is unchanged in output).
- Caption preset: mode default applies only when the user didn't pass `--style`.
- `zoomIntensity` flows to Remotion (`punchScaleAt(events, t, intensity)`) — scales
  `(scale-1)*intensity`. Zoom **timing** is unchanged, so the SFX whoosh mirror stays valid.

## 2. B-roll engine (`src/broll/`)

Pipeline per exported clip (MindCuts by default; `--broll` forces on for clippies,
`--no-broll` off everywhere). Every stage is fail-soft: any error → clip renders without
B-roll, never fails.

### 2a. Cue extraction — `cues.ts`
Claude structured outputs (same pattern as claudeSemantic; Gemini JSON fallback via existing
KeyPool; no key → no B-roll). Input: clip-relative transcript sentences with [start–end]s +
sentiment. Output ≤6 cues:
`BrollCue { start, end, entity, kind: person|place|company|object|action|emotion|concept|event, query }`.
Prompt embeds the spec's query-formation examples ("Toto Wolff"→"Toto Wolff Mercedes",
"dopamine"→"dopamine brain animation") and the abstract-metaphor table (discipline→training,
failure→losing footage, stress→dark room, focus→studying, money→stacks/charts, grind→late-night
work) plus relatable/reaction footage for emotion cues.

### 2b. Search — `search.ts`
`yt-dlp "ytsearch5:<query>" --dump-json --flat-playlist --no-download` → candidates
(id, title, channel, duration, url). Filter: 20s ≤ duration ≤ 20 min, exclude the source
video. Pure arg-builder + line parser, tested.

### 2c. Relevance validation — `validate.ts`
One Claude call per clip scoring all (cue sentence, candidate title/channel) pairs 0–10;
keep best candidate per cue with **score > 8** (spec). LLM unavailable/fails → token-overlap
heuristic, keep ≥ 7.

### 2d. Segment download — `cache.ts`
Best candidate → `yt-dlp --download-sections "*S-E" --force-keyframes-at-cuts -f
"bestvideo[height<=720]/best[height<=720]"` (video-only; overlays are muted). Segment: starts
15% into the candidate (skips intros), `min(12s, cueDur + 4s)`. Cached at
`./broll_cache/<sha1(id:S:E)>.mp4` (`--broll-dir`/`BROLL_DIR` override); cache hit = no
network. Download failure → cue dropped.

### 2e. Overlay planning — `planner.ts` (pure)
`planOverlays(cuesWithFiles, clipDur, {maxBroll})`:
- keep first 3s clean (hook card + hook frame = A-roll) and last 2s clean (payoff on camera);
- overlay duration = clamp(cue span, 1.5s, 6s); gap ≥ 2s between overlays;
- total overlay ≤ 40% of clip; cap at mode `maxBroll`; chronological greedy with
  kind priority (person/event/company > concept/action > emotion/object/place).
`filterCallouts(callouts, overlays)` (pure): drop arrow callouts that fire while B-roll covers
the face.

### 2f. Rendering — narrative overlay
`RenderOpts.broll?: BrollSegment[]` → files staged into `remotion/public/input/`, props gain
`broll: { videoPath, from, durationInFrames }[]`. New `remotion/src/Broll.tsx`: `<Sequence>`
per segment — muted OffthreadVideo, cover-fit, slow Ken Burns (1.0→1.06) + 6-frame fade
in/out (`brollLogic.ts`, tested). Layer order: base video → B-roll overlays → callouts →
hook card → captions. **The base A-roll OffthreadVideo stays mounted, so speech continues
seamlessly under the overlay** — the spec's narrative-overlay requirement.

### 2g. Outputs
- `broll_manifest.json` at exports root: per clip_id → [{entity, kind, query, source_url,
  file, at_sec, duration_sec}].
- `broll` block inside each `clip.json` (same entries).

## 3. GUI
Minimal additions to existing tabs: Import tab gains a Mode select (Auto/Clippies/MindCuts)
and a B-roll checkbox → `/api/run` maps to `--mode` / `--broll` / `--no-broll`.

## 4. Testing
Pure functions tested (vitest, existing layout): mode profiles + detectMode; merger with
custom lengths; ranker priorities ordering; punchScaleAt intensity; cue prompt/schema/parse +
clamping; search arg-builder/parser + filters; validation prompt/parse + heuristic; cache key
+ segment math; planOverlays constraints; filterCallouts; brollLogic opacity/scale; props
build with broll; manifest builders. Gates: `npm test`, root+remotion `tsc --noEmit`,
`ui next build`.

## Non-goals (unchanged deferrals)
Freeze frames / speed ramps (audio desync risk in Remotion — needs timeline remapping),
split-screen framing, Google Images/Wikimedia search (YouTube-only per user follow-up),
10-tab GUI restructure, BullMQ/SQLite.
