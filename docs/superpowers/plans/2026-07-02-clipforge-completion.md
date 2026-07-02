# ClipForge Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining master-spec gaps: ranking-video render mode, subtitle style presets, music engine, punch-zoom editing grammar, local-file input, and the GUI.

**Architecture:** Each slice follows the house pattern — pure, unit-tested core + thin I/O orchestrator, wired into the existing `analyzeVideo`/`rankAndExport` pipeline and the `remotion/` renderer. Remotion gains a second composition (`RankingVideo`) and a style-config-driven caption track. Music mixing is a post-render ffmpeg pass. The GUI is a separate `ui/` Next.js package that shells out to the compiled CLI and reads workspace JSON.

**Tech Stack:** TypeScript/Node 24, Remotion, ffmpeg, vitest, commander; Next.js + Tailwind + shadcn-style components for `ui/`.

## Global Constraints

- Fully local processing; only Gemini API calls leave the machine (established pivot from spec's Claude).
- No placeholder code, no TODOs; every task ends green (`npm test`, `npm run build`).
- TDD per task; pure logic gets unit tests, ffmpeg/Remotion invocations get arg-builder tests (house pattern).
- Vitest includes `remotion/src/**/*.test.ts`; Remotion pure logic is testable from the root suite.
- Caption fonts load via `@remotion/google-fonts/*` static imports (already a dependency).
- Commit per task, message style `feat: … (TASKID)`.

---

### Task RV1: Ranking timeline logic + `RankingVideo` composition

**Files:**
- Create: `remotion/src/rankingLogic.ts`, `remotion/src/rankingLogic.test.ts`, `remotion/src/RankingVideo.tsx`
- Modify: `remotion/src/Root.tsx` (register composition)

**Interfaces:**
- Produces:
  - `interface RankingItem { videoPath: string; rank: number; durationInFrames: number; title?: string }`
  - `interface TimelineSegment { kind: 'card' | 'clip'; itemIndex: number; from: number; durationInFrames: number }`
  - `buildTimeline(items: RankingItem[], cardFrames: number): TimelineSegment[]` — one card then one clip per item, in given order; `from` accumulates.
  - `totalFrames(items: RankingItem[], cardFrames: number): number`
  - `interface RankingProps { items: RankingItem[]; fps: number; cardFrames: number; accentColor: string }`
  - Composition id `RankingVideo`, 1080×1920, `calculateMetadata` → `totalFrames(props.items, props.cardFrames)`.

- [ ] Failing tests for `buildTimeline`/`totalFrames` (ordering, offsets, empty input) → RED
- [ ] Implement `rankingLogic.ts` → GREEN
- [ ] `RankingVideo.tsx`: `<Sequence>` per segment. Card = black bg + radial accent glow, `#N` springs in (Anton, ~280px), `title` below (64px); rank 1 card label “THE #1 MOMENT”. Clip = full-bleed `OffthreadVideo` (already 9:16 finals) + persistent top-left rank pill (`#N`, accent on rgba(0,0,0,.55)).
- [ ] Register in `Root.tsx`; `npm test && npm run build`; commit `feat: RankingVideo composition + timeline logic (RV1)`

### Task RV2: Node ranking renderer

**Files:**
- Create: `src/export/rankingRenderer.ts`, `tests/export/rankingRenderer.test.ts`

**Interfaces:**
- Consumes: `RankingProps`/`RankingItem` shape from RV1 (JSON across the props file), `probe` from `src/utils/ffmpeg.js`, `run`/`withRetry` pattern from `remotionRenderer.ts`.
- Produces:
  - `interface RankingEntry { clipPath: string; rank: number; title?: string }`
  - `buildRankingProps(entries: RankingEntry[], durationsSec: number[], fps: number, cardSec: number, accent: string): RankingProps` — PURE; plays highest rank number first (#N→#1); `videoPath` = `input/rank_<rank>.mp4`.
  - `buildRankingRenderArgs(propsPath: string, outPath: string): string[]` — `remotion render src/index.ts RankingVideo …` mirroring `buildRenderArgs`.
  - `renderRanking(entries: RankingEntry[], outPath: string, opts: { fps?: number; cardSec?: number; accent?: string }): Promise<void>` — probe each clip, copy to `remotion/public/input/rank_<rank>.mp4`, write props, render, cleanup in `finally`.

- [ ] Failing tests: props ordering (#N first), durations→frames, render args → RED
- [ ] Implement → GREEN; commit `feat: node-side ranking renderer (RV2)`

### Task RV3: CLI `rank` command + `--ranking` on batch

**Files:**
- Create: `src/cli/commands/rank.ts`, `tests/cli/rank.test.ts`
- Modify: `src/cli/index.ts`, `src/cli/commands/all.ts` (batch wiring)

**Interfaces:**
- Consumes: `clips_manifest.json` shape from `src/export/exporter.ts` (`clips[].clip_id`, `rank`, `clip_titles`), `renderRanking` from RV2.
- Produces:
  - `manifestToEntries(manifest: { clips: { clip_id: string; rank: number; clip_titles: string[] }[] }, dir: string): RankingEntry[]` — PURE; `clipPath` = `<dir>/<clip_id>_final.mp4`, `title` = `clip_titles[0]`.
  - `runRankingRender(exportsDir: string, opts: { accent: string; cardSec: number }): Promise<string>` — reads manifest, renders `<exportsDir>/ranking_final.mp4`.
  - CLI: `clipforge rank <exportsDir> [--accent] [--card-seconds]`; `clipforge batch … --ranking` runs it after export.

- [ ] Failing test for `manifestToEntries` → RED → implement → GREEN
- [ ] Wire CLI + batch flag; build; commit `feat: rank CLI command + batch --ranking (RV3)`
- [ ] Validate live on an existing batch export dir → confirm `ranking_final.mp4` plays #N→#1 with cards.

### Task SP1: Caption style presets (Node core)

**Files:**
- Create: `src/captions/presets.ts`, `tests/captions/presets.test.ts`

**Interfaces:**
- Produces:
  - `interface CaptionStyle { font: 'anton'|'bangers'|'archivo'|'montserrat'|'poppins'|'inter'; fontSize: number; emphasisSize: number; baseColor: string; activeColor?: string; strokeWidth: number; strokeColor: string; animation: 'karaoke'|'pop'|'bounce'|'glow'; position: 'bottom'|'center'; uppercase: boolean; wordsPerLine: number; background: 'none'|'card' }`
  - `type PresetName = 'mrbeast'|'hormozi'|'gadzhi'|'gaming'|'podcast'|'cinematic'|'minimal'|'card'|'bold'`
  - `CAPTION_PRESETS: Record<PresetName, CaptionStyle>` — mrbeast: bangers 78/94 pop, yellow active, stroke 10; hormozi: montserrat 70/84 pop, `#00FF47` active, stroke 8, card bg; gadzhi: montserrat 60/72 glow, gold active, no stroke, lowercase; gaming: bangers 74/90 bounce, `#00E5FF` active, stroke 8; podcast: inter 54/62 karaoke, stroke 3, 5 wpl, lowercase; cinematic: montserrat 46/52 karaoke, no stroke, center-low, wide tracking via uppercase+small size; legacy bold/minimal/card map to current look (anton 70/84 karaoke; card = bold + card bg).
  - `resolveCaptionStyle(preset: string, overrides: { font?: string; fontSize?: number; color?: string; strokeWidth?: number; position?: string }): CaptionStyle` — unknown preset → `bold`; overrides win; `fontSize` override scales `emphasisSize` proportionally.

- [ ] Failing tests: preset lookup, unknown→bold, override merge/scaling → RED → implement → GREEN
- [ ] Commit `feat: caption style presets core (SP1)`

### Task SP2: Remotion caption track consumes CaptionStyle

**Files:**
- Create: `remotion/src/captionStyle.ts` (mirror type + font map + defaults)
- Modify: `remotion/src/Caption.tsx`, `remotion/src/CaptionedClip.tsx`, `remotion/src/Root.tsx`, `src/types/index.ts` (`ClipCompositionProps.caption?: CaptionStyle`), `src/captions/remotionRenderer.ts` (pass through)

**Interfaces:**
- Consumes: `CaptionStyle` JSON shape from SP1 (structural mirror, no cross-package import).
- Produces: `fontFamilyFor(font: CaptionStyle['font']): string` (static `loadFont()` imports for Anton, Bangers, Archivo Black, Montserrat, Poppins, Inter); `DEFAULT_STYLE` = legacy bold. `CaptionTrack` renders: animation `pop` (spring scale 1→1.25 on active), `bounce` (spring translateY −14px), `glow` (accent textShadow halo), `karaoke` (current opacity ramp); stroke via `WebkitTextStroke`; `position: 'center'` = centered block at 55% height; `background: 'card'` = rounded rgba(0,0,0,.6) pill behind line; `activeColor` falls back to `accentColor` prop.
- `RenderOpts.caption?: CaptionStyle`; `buildProps` forwards it.

- [ ] Extend `buildProps` test (caption passthrough) → RED → implement → GREEN
- [ ] Commit `feat: style-driven caption track — presets in Remotion (SP2)`

### Task SP3: CLI style flags

**Files:**
- Modify: `src/cli/index.ts`, `src/cli/commands/all.ts` (`AllOpts.caption: CaptionStyle`), rankAndExport render call
- Test: `tests/captions/presets.test.ts` (resolve is already covered; CLI wiring is thin)

**Interfaces:**
- `--style <preset>` now accepts all `PresetName`s; new `--font <name>`, `--font-size <px>`, `--caption-color <hex>`, `--stroke <px>`, `--position <bottom|center>` overrides; `AllOpts` gains `caption: CaptionStyle` resolved once in the action via `resolveCaptionStyle`. `opts.style` stays for legacy hook-card branching.

- [ ] Wire flags on `all` + `batch`; build; commit `feat: caption preset + override CLI flags (SP3)`

### Task MU1: Music library + mood mapping

**Files:**
- Create: `src/music/library.ts`, `tests/music/library.test.ts`

**Interfaces:**
- Produces:
  - `type Mood = 'intense'|'funny'|'motivational'|'suspense'|'emotional'|'chill'`
  - `sentimentToMood(sentiment?: string): Mood` — funny→funny, intense→intense, serious→motivational, neutral/undefined→chill.
  - `scanLibrary(root: string): Promise<Partial<Record<Mood, string[]>>>` — `<root>/<mood>/*.{mp3,m4a,wav}` subfolders plus `<mood>_*.mp3` prefixed files at root; missing root → `{}`.
  - `pickTrack(lib: Partial<Record<Mood, string[]>>, mood: Mood, seed: string): string | null` — deterministic (sha1(seed) mod n); falls back to `chill`, then null.

- [ ] Failing tests (mapping, prefix+folder scan via temp dir, deterministic pick, fallback) → RED → implement → GREEN
- [ ] Commit `feat: music library scan + mood mapping (MU1)`

### Task MU2: Duck-under-speech ffmpeg mixer

**Files:**
- Create: `src/music/mixer.ts`, `tests/music/mixer.test.ts`

**Interfaces:**
- Produces:
  - `buildMusicMixArgs(videoPath: string, musicPath: string, outPath: string, opts: { durationSec: number; musicVolume: number; fadeSec: number }): string[]` — PURE. Filtergraph: `[1:a]aloop=loop=-1:size=2147483647,atrim=0:<D>,afade=t=in:st=0:d=<F>,afade=t=out:st=<D-F>:d=<F>,volume=<V>[mus];[0:a]asplit=2[voice][sc];[mus][sc]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=400[duck];[voice][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]` with `-map 0:v -map [aout] -c:v copy -c:a aac -b:a 192k -y`.
  - `mixMusic(videoPath, musicPath, outPath, opts): Promise<void>` — probe for duration, run ffmpeg.

- [ ] Failing tests on arg builder (filtergraph parts, stream copy, fades) → RED → implement → GREEN
- [ ] Commit `feat: sidechain-ducked music mixer (MU2)`

### Task MU3: Wire music into export

**Files:**
- Modify: `src/cli/commands/all.ts` (rankAndExport post-render step), `src/cli/index.ts` (flags)

**Interfaces:**
- `AllOpts` gains `music: boolean` (default true = auto), `musicVolume: number` (default 0.25), `musicDir: string` (default `./music`, env `MUSIC_DIR`). After each clip render: `mood = sentimentToMood(clip.sentiment)`, `track = pickTrack(lib, mood, clip.clip_id + source.jobId)`; if track → render final to `<clip>_nomusic.mp4` temp? No — mix `finalPath` → `finalPath.tmp.mp4`, then rename over `finalPath`. Log chosen track/mood; silent skip when library empty. `--no-music`, `--music-volume <v>`, `--music-dir <p>` flags on `all`+`batch`.

- [ ] Wire + build + full suite green; commit `feat: mood-matched ducked background music in exports (MU3)`

### Task EG1: Punch-zoom grammar (pure)

**Files:**
- Create: `remotion/src/punchZoom.ts`, `remotion/src/punchZoom.test.ts`

**Interfaces:**
- Consumes: `CaptionWord` from `remotion/src/captionLogic.ts` (`{ text, start, end, emphasized }`).
- Produces:
  - `buildZoomEvents(words: CaptionWord[], opts?: { minGapSec?: number; maxEvents?: number }): number[]` — emphasized word starts, ≥2.5s apart, max 4, never in the first 1s.
  - `punchScaleAt(events: number[], t: number): number` — 1 outside; at event `e`: ramp 1→1.08 over 0.12s, hold to 0.5s, ease back to 1 by 0.9s (piecewise linear, deterministic).

- [ ] Failing tests (spacing/cap/first-second rule; scale envelope at sample points) → RED → implement → GREEN
- [ ] Commit `feat: punch-zoom event + scale envelope logic (EG1)`

### Task EG2: Apply punch zooms in composition

**Files:**
- Modify: `remotion/src/CaptionedClip.tsx` (wrap video layer in scaled container), `src/types/index.ts` + `src/captions/remotionRenderer.ts` (`zooms?: boolean` prop, default true), `src/cli/index.ts` (`--no-zooms`)

- [ ] Compute `events = buildZoomEvents(words)` in component; `transform: scale(punchScaleAt(events, t))` with `transformOrigin: 'center 40%'` on the video wrapper when `zooms !== false`.
- [ ] buildProps test for `zooms` passthrough → GREEN; commit `feat: punch zooms on emphasized moments (EG2)`

### Task LF: Local-file input

**Files:**
- Create: `src/ingest/localFile.ts`, `tests/ingest/localFile.test.ts`
- Modify: `src/cli/commands/all.ts` (analyzeVideo branch), `src/cli/commands/ingest.ts`? (no — keep URL-only), `src/cli/index.ts` (`process <file>` command; `all`/`batch` accept paths)

**Interfaces:**
- Produces:
  - `isLocalInput(input: string): boolean` — existing file with `.mp4|.mkv|.mov|.webm|.m4v` extension.
  - `localJobId(absPath: string): string` — `local_` + sha1(absPath).slice(0,10).
  - `ingestLocal(absPath: string, outDir: string): Promise<{ videoPath: string; infoJsonPath: string; subtitlePath: null }>` — copy into `<outDir>/video.mp4` if missing (reuse-cached log otherwise); `infoJsonPath` points at non-existent path (metadataExtractor tolerates).
- `analyzeVideo`: `isLocalInput(url)` → `ingestLocal` instead of `download`, jobId from `localJobId`; transcript falls through to whisper (subtitlePath null), comments/semantic unaffected. `resolveJobId` handles local path.
- CLI `process <file>` = `runAll(file, opts)` with same options as `all`.

- [ ] Failing tests (`isLocalInput`, `localJobId` stability, `ingestLocal` copy+reuse via temp dir) → RED → implement → GREEN
- [ ] Commit `feat: local video file input — process command (LF)`

### Task UI1: `ui/` Next.js scaffold + workspace API

**Files:**
- Create: `ui/package.json`, `ui/next.config.mjs`, `ui/tsconfig.json`, `ui/postcss.config.mjs`, `ui/tailwind.config.ts`, `ui/app/globals.css`, `ui/app/layout.tsx`, `ui/app/page.tsx`, `ui/components/*` (shadcn-style `button.tsx`, `card.tsx`, `tabs.tsx` on `@radix-ui/react-tabs`), `ui/lib/workspace.ts`, `ui/app/api/jobs/route.ts`, `ui/app/api/video/route.ts`

**Interfaces:**
- `lib/workspace.ts`: `listExports(wsRoot): Promise<ExportJob[]>` reading `workspace/exports/*/clips_manifest.json` → `{ id, title, processedAt, clips: [{ clipId, rank, score, title, files }] }`; `WORKSPACE_DIR` env, default `../workspace` relative to ui/.
- `GET /api/jobs` → `ExportJob[]`; `GET /api/video?job=<id>&file=<name>` → range-aware stream of `<ws>/exports/<id>/<file>` (path-traversal guarded: basename only).
- Dark single-page shell, header “ClipForge”, radix tabs: Import / Clips / Style / Rank / Export.

- [ ] Scaffold, `npm install` in ui/, `next build` green; commit `feat: GUI scaffold + workspace API (UI1)`

### Task UI2: Import + Clips tabs

**Files:**
- Create: `ui/app/api/run/route.ts`, `ui/app/api/run/[id]/stream/route.ts`, `ui/components/import-tab.tsx`, `ui/components/clips-tab.tsx`

**Interfaces:**
- `POST /api/run` `{ input: string; top: number; style: string; accent: string; music: boolean; ranking: boolean }` → spawns `node dist/cli/index.js all|batch|process …` (cwd repo root), returns `{ id }`; in-memory run registry `{ id → { proc, logs: string[], done, code } }`.
- `GET /api/run/<id>/stream` → SSE of log lines.
- Import tab: input field (URL or path), top/style/accent/music/ranking controls, Run button, live log pane.
- Clips tab: job cards → clip grid; each clip: `<video controls src=/api/video…>`, rank/score badges, hook + excerpt, links to `.srt`/`.json`.

- [ ] `next build` green; commit `feat: GUI import + clips tabs — run pipeline, preview exports (UI2)`

### Task UI3: Style + Rank + Export tabs, `clipforge ui`

**Files:**
- Create: `ui/components/style-tab.tsx`, `ui/components/rank-tab.tsx`, `ui/components/export-tab.tsx`, `ui/app/api/rank/route.ts`
- Modify: `src/cli/index.ts` (`ui` command spawning `npm run dev` in ui/ with PORT), `README.md` (GUI + all new commands/flags)

**Interfaces:**
- Style tab: preset gallery (live CSS mock of each preset on sample words), font-size/color/stroke/position controls → emits equivalent CLI flags; “Re-run with style” posts to `/api/run` with chosen input.
- Rank tab: pick a batch export → ordered clip list → “Render ranking video” → `POST /api/rank { job }` spawns `node dist/cli/index.js rank <dir>`; progress via same SSE registry.
- Export tab: table of all exports with absolute paths + copy buttons.
- `clipforge ui [--port 3210]`: preflight node_modules in ui/, spawn `next dev`, print URL.

- [ ] `next build` + root suite green; README updated for every new command/flag; commit `feat: GUI style/rank/export tabs + clipforge ui command (UI3)`

---

## Self-review notes

- Spec coverage vs master spec: ranking mode (RV*), subtitle presets + controls (SP*), music engine w/ ducking+fades+mood (MU*), editing grammar punch zooms — sparing by design (EG*), local file input (LF), GUI tabs subset (UI*). Known intentional deferrals: librosa/OpenCV Python services, diarization/split-speaker, replay-graph signals, BullMQ/SQLite queue (stage-level caching already provides resume), timeline trim editor in GUI.
- Types consistent: `RankingEntry/RankingItem/RankingProps` (RV1↔RV2↔RV3), `CaptionStyle` mirrored Node↔Remotion (SP1↔SP2↔SP3), `Mood` (MU1↔MU3), `zooms` prop (EG2), `ExportJob` (UI1↔UI2↔UI3).
- Execution order = doc order; each task independently shippable.
