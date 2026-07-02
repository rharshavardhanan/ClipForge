# v4 Polish Batch Implementation Plan (2026-07-03)

> Executed inline in the authoring session (user directive: "complete the whole thing in one go").
> User-approved revisions to the 2026-07-02 variants design: NO dual renders — auto framing stays.

**Goal:** Five features: (A) no-repeat regeneration, (B) arrow callouts at speaker faces on peak moments, (C) Remotion-rendered thumbnails, (D) live caption preview in the Style tab, (E) multi-channel YouTube upload with channel picker.

## Task A — No-repeat regeneration
- Create `src/clipDetection/usedRanges.ts`: `UsedRange {start,end,clip_id,exportedAt}`; `usedRangesPath(jobId)` = `<WS>/analysis/<jobId>/used_ranges.json`; `loadUsedRanges` ([] on missing); `appendUsedRanges`; PURE `filterUsedCandidates(cands, used, maxOverlap=0.3)` — drop candidate when overlap with any used range > 30% of the candidate's duration.
- Wire `rankAndExport` (all.ts): filter each analysis's candidates via its jobId's used ranges unless `opts.allowRepeats`; log excluded count; after export, `appendUsedRanges` per source with the succeeded clips' ranges.
- CLI: `--allow-repeats` in `addRenderOptions` → `AllOpts.allowRepeats`.
- Tests: `tests/clipDetection/usedRanges.test.ts` (pure filter edge cases + load/append roundtrip via tmp WORKSPACE_DIR).

## Task E — Multi-channel YouTube
- `youtubeAuth.ts`: scope becomes `youtube.upload youtube.readonly`. New file shape `{channels:[{channel_id,title,refresh_token}]}` with silent migration from the old single-token shape (title 'default'). After the code exchange, `GET /youtube/v3/channels?part=snippet&mine=true` with the fresh access token → upsert channel by id. `getAccessToken(channel?, fetchFn)` resolves via PURE `pickChannel(channels, query?)` (exact id, else case-insensitive title; single channel auto-selected; multiple + no query → throw listing titles). Token cache per channel_id.
- `publish.ts`/CLI: `upload --channel <name-or-id>`; GUI: new GET `/api/channels` reads the auth file; upload dialog gains a required channel select (auto-selected when only one).
- Tests: pickChannel, migration, per-channel token exchange with fake fetch.

## Task C — Remotion thumbnails
- `remotion/src/ThumbCard.tsx` + `<Still id="ThumbCard" 1280x720>` in Root: frame image cover-filled, scaled 1.25 toward the face point (normalized faceX/faceY, default center), saturation/contrast pop, radial vignette + bottom gradient, huge Anton uppercase 2-line max text with black stroke + shadow, last word in accent.
- `src/export/thumbnail.ts`: `generateThumbnail` now: (1) ffmpeg plain-frame grab → `remotion/public/thumb_input/<uid>.png`, (2) `npx remotion still src/index.ts ThumbCard <out> --props=…` (cwd remotion, like rankingRenderer), (3) fallback = plain frame copy on any failure; cleanup public input. New optional `face?: {x,y}` param (normalized).
- all.ts passes the face point nearest the thumbnail time (from Task B's `faces`).

## Task B — Arrow callouts
- `planFraming` also returns `faces: FaceSample[]` — the dominant track's samples in BOTH modes.
- Create `src/extraction/callouts.ts` (PURE): `planCallouts(zoomTimes, faces, {mode, track, srcW, srcH})` → up to 2 `{time,x,y}` output-px callouts (skip <1.5s, min 4s gap, face sample within 0.5s required). Coord mapping: blur = contained-rect math; crop = nearest crop keyframe window math.
- Remotion `Callout.tsx`: spring pop-in arrow (accent fill, white outline, sine bob) pointing down at (x,y), visible ~1.4s. `ClipProps.callouts?` + render in CaptionedClip; `ClipCompositionProps.callouts?` in src types; passed through remotionRenderer + all.ts (only when zooms enabled — arrows ride the same peak moments).
- Tests: `tests/extraction/callouts.test.ts` (mapping both modes, gap/cap rules).

## Task D — Live caption preview
- `ui/app/layout.tsx`: Google Fonts stylesheet link (Anton, Bangers, Archivo Black, Montserrat 800, Poppins 700, Inter 600) — same faces Remotion burns.
- `style-tab.tsx`: full preset-style mirror data + override resolution (same rules as resolveCaptionStyle); new 9:16 preview pane (270×480, 0.25 scale) rendering a 3-word sample line with active-word accent, stroke, position, uppercase, card background — updates live with every control.

## Gates
`npx vitest run` · root `tsc --noEmit` · `remotion tsc --noEmit` · `ui next build` · live verify: remotion still thumbnail on a test frame; README + .env docs; memory update.
