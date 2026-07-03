# Montagem Engine v1 — Design

Date: 2026-07-03
Status: Approved (user-approved design, full-spec v1 scope)
Origin: "Advanced Retention Layer" spec (4 systems). Decomposed; build order chosen by user:
**1) Montagem Engine ← this spec**, 2) Stylized Subtitle Engine, 3) Comedic Amplification,
4) Narrative Fabrication. Montagem absorbs v7 slice 5 (clippies style pack / freeze-frame deferral).

## Goal

A `clipforge montage` command that turns one or more input videos + a music track into a
beat-synced, TikTok/Brazilian-montagem-style short: build-up → hyper cuts → flashes →
bass-drop payoff → slowmo/freeze — with live counters and an exaggerated AI payoff frame.

The music masters the timeline. Native video audio is muted/heavily ducked, so velocity
ramps never desync speech — this dissolves the long-standing time-remap audio-desync
deferral **for montage mode only** (freeze-over-speech elsewhere remains deferred).

## Scope (v1 = full spec, user decision)

IN: beat-synced cuts, flash frames, velocity ramps, hyper zoom + shake, glitch/chromatic
effects, bass-drop detection with #1 moment on the drop, rep/event counters, AI-generated
exaggerated payoff frame, montagem caption preset, GUI tab, SEO pack reuse.
OUT (later systems): full stylized-subtitle grammar (system 2), comedic freezes over speech
(system 3), multi-video narrative stitching (system 4).

## Architecture

New command `clipforge montage <input(s)> --music <file>`; own pipeline in `src/montage/`
mirroring RankRot's shape. No changes to the single-window clip model of the main pipeline.

Flow:
1. **Ingest** — URLs or local paths through the existing download/cache path.
2. **Music analysis** → `MusicMap`.
3. **Moment harvesting** per video (existing signals: motion YDIF, RMS, scene cuts, faces).
4. **Assembly planner** (pure) — segments mapped onto the beat grid.
5. **Counter pass** (signals + 1 Gemini vision call) and **payoff-image pass** (1 image-gen call).
6. Render via new Remotion `MontageVideo` comp.
7. Export `workspace/exports/montage_<slug>/`: final mp4 + `montage_manifest.json` +
   SEO texts (existing pack builder).

## Music analysis (`src/montage/musicMap.ts`)

- ffmpeg decodes the track to f32le PCM **via temp file** (run() stdout corrupts binary —
  established gotcha; never pipe PCM through stdout).
- `music-tempo` (pure JS, new dep) for BPM + beat positions; beats refined by snapping to
  our own energy-flux onsets (small-hop RMS, ~10ms).
- **Drop detection reuses the rankrot bass trick**: bandpass 20–150Hz RMS curve; drop =
  bass surge following a relative dip, scored by surge magnitude.
- Output: `MusicMap { bpm, beats: number[], drops: Drop[], energyCurve, sections }` where
  sections classify time into `build | drop | cool` from the energy curve.
- Alternative on record: essentia.js WASM (better beat quality, ~2MB dep). Start with the
  JS path — montage tracks (phonk/EDM) have strong grids; essentia is a drop-in upgrade if
  live smoke shows misaligned cuts.

Music source: `--music <file>` pins a track; otherwise pick from new `./music/montagem/`
folder (best-fit by duration, random tiebreak). Both empty → hard fail with clear message.
No montage without music.

## Moment harvesting (`src/montage/moments.ts`)

- Motion peaks (YDIF curve — already a main analysis layer), audio peaks (RMS), scene-cut
  boundaries (`sceneCuts.ts`) as preferred cut points, face presence as bonus.
- **Periodic-motion cycle detection**: oscillation cycle-counting on the motion curve
  (peak-picking with period consistency). Signal math, no LLM. Feeds segment selection AND
  the counter engine.
- Each moment: `{ src, start, dur, motionScore, audioScore, cycleEvents: number[] }`.

## Assembly planner (`src/montage/planner.ts`, pure, seeded)

Walks the MusicMap sections and fills them with moments:
- **build**: 1 cut per 2–4 beats, playbackRate 0.75–1x, minimal effects.
- **escalation** (late build): 1 cut per beat, 1.25–2x, zooms ramp in.
- **drop**: half-beat hyper cuts, flashes dense, shake on, strongest moment lands ON the drop.
- **payoff**: 0.5x slowmo of the peak, then freeze + payoff image + final flash hit.
- Flash frames (white/red/black/glitch/blur, 1–4 frames) at cut points; density scales with
  section intensity.
- Deterministic given seed. `--duration <sec>` sets the target length (default 25, clamped
  15–45); the planner trims/extends section fills to land within ±2 beats of the target.

Output `MontagePlan`: segments (src, srcStart, srcDur, playbackRate, effects[]), flashEvents,
zoomShakeEvents, counterTimeline, payoffAt.

## Remotion `MontageVideo` (remotion/src/)

- Props are **type aliases, not interfaces** (Record constraint gotcha).
- Per-segment `<OffthreadVideo>` with `playbackRate`, muted (music is master; optional
  low-level native-audio bed under `--native-audio <vol>`, default 0).
- Effects in CSS/transform land: chromatic aberration = RGB-offset layers; glitch =
  clip-path jitter; shake = seeded transform noise; "motion blur" honestly approximated
  with short cross-dissolves. No time-remap of audio anywhere.
- Flash overlays as 1–4 frame full-screen solids/blur layers.
- Counter overlay component: big animated number + label, increments on counterTimeline
  events (already remapped through ramped segment time by the planner — Remotion just plays).
- Montagem caption preset (red glow, blur shadow, heavy stroke, pulse) added to
  `src/captions/presets.ts` **and the GUI PRESET_STYLES mirror (must stay in sync)**.

## Counter engine (`src/montage/counter.ts`)

- Counts = cycleEvents from harvesting (free, deterministic).
- **One Gemini vision call** on keyframes from the top segments returns
  `{ countable: boolean, label: string }` (e.g. "PULLUP COUNTER"). Not countable or low
  confidence → counter OFF. Never show a wrong label; silence beats error.
- `--no-counters` escape. No Claude dependency (Gemini-first mandate; Claude drop-in via
  existing router if present).

## AI payoff frame (`src/montage/payoff.ts`)

- Peak frame (JPEG extract, temp-file pattern) → Gemini image generation (free-tier image
  model through the existing key-pool rotation) with an image-to-image
  "exaggerated / hyper-stylized / clearly-not-real" prompt.
- **Mandatory fallback chain**: quota / refusal / any failure → stylized real freeze
  (punch-in + glow + flash). The montage NEVER fails over the image.
- Cached like broll (`./workspace/cache` keyed by frame hash + prompt version).
- `--no-payoff-image` escape.
- Caveat on record: YouTube requires disclosure for realistic synthetic media of real
  people; the prompt deliberately targets exaggerated/cartoon-grade stylization (the safe
  zone), not photorealism.

## LLM budget (Gemini-first mandate)

Worst case per montage: 1 vision call (counter label) + 1 image-gen call. Everything else
is pure signals. Fully functional on free Gemini; fully functional with NO LLM
(counters off, real-frame payoff). Claude never required.

## CLI / GUI / outputs

- `clipforge montage <inputs...> --music <file> --duration <sec> --seed <n>
  --no-counters --no-payoff-image --native-audio <0..1>`
- GUI: 7th tab "Montage" mirroring the RankRot tab pattern (inputs, music pick from
  ./music/montagem/, flags → run API → result player). Slug mirror in the API route MUST
  match the pipeline's slug (rankrot lesson).
- Exports: `workspace/exports/montage_<slug>/{montage_final.mp4, montage_manifest.json,
  title/description/hashtags.txt, thumbnail.png}`.

## Testing

- Unit (pure): beat-grid snapping, drop detector, section classifier, planner (cut density
  per section, drop alignment, flash placement, ramp rules), cycle counter, counter-time
  remap through ramps.
- Gates: root tsc + vitest, remotion tsc --noEmit, ui next build.
- **Live smoke before done**: real fitness/sports video + a real track in
  ./music/montagem/, inspect frames for beat alignment, drop hit, counter correctness,
  payoff frame. (Free-tier Gemini shape tolerance + key rotation already exist in llmJson.)

## Deviations from the pasted spec (deliberate)

- No librosa (no-Python standing decision) — §Music analysis is the equivalent.
- "Motion blur" is approximated (cross-dissolve), not true frame-accumulation blur.
- Counters only render when cycle detection + vision label agree; the spec's
  kills/scores/wins counting for arbitrary game content is v1.1 (needs per-event vision,
  quota-hungry).
