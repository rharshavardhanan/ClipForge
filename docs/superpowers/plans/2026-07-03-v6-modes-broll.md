# Plan — v6: Mode System + Contextual B-roll (2026-07-03)

Design: `docs/superpowers/specs/2026-07-03-v6-modes-broll-design.md`

## Task 1 — Mode system
- [ ] `src/modes.ts`: ModeProfile table (clippies/mindcuts), `detectMode(meta, semantic)` (pure)
- [ ] `merger.ts`: optional `lengths {min,soft,max}` param on buildClips/clampDuration/spanAllowed
- [ ] `ranker.ts`: `opts.priorities` → adjusted sort score (composite unchanged in output)
- [ ] `punchZoom.ts`: `punchScaleAt(events, t, intensity=1)`; prop `zoomIntensity` through
      ClipProps/ClipCompositionProps/renderer
- [ ] CLI `--mode` on all/process/batch; per-video auto-resolve after semantic; mode default
      caption preset when `--style` not passed; tests

## Task 2 — B-roll: cues
- [ ] types: BrollCue/BrollCandidate/BrollSegment in src/types
- [ ] `src/broll/cues.ts`: schema + prompt + parse (pure, tested) + `extractCues` (Claude
      primary, Gemini fallback, cached per clip in workspace/analysis)

## Task 3 — B-roll: search / validate / download
- [ ] `src/broll/search.ts`: ytsearch5 arg builder + JSONL parser + duration/self filters
- [ ] `src/broll/validate.ts`: batch relevance scoring, keep >8; heuristic fallback ≥7
- [ ] `src/broll/cache.ts`: segment picker, sha1 cache key, yt-dlp section download

## Task 4 — Narrative overlay render
- [ ] `src/broll/planner.ts`: planOverlays + filterCallouts (pure, tested)
- [ ] `remotion/src/brollLogic.ts` (+test) + `Broll.tsx`; CaptionedClip layer order
- [ ] renderer: stage broll files into public/input, broll prop, cleanup

## Task 5 — Pipeline + outputs + GUI
- [ ] `all.ts`: mode resolve, lengths→buildClips, priorities→rank, broll acquisition per clip
      (fail-soft), zoomIntensity/caption default per source mode
- [ ] exporter: `broll_manifest.json` + `broll` block in clip.json
- [ ] CLI flags `--broll/--no-broll/--broll-dir/--max-broll`; UI mode select + broll checkbox
- [ ] README v6 section

## Gates
- [ ] `npm test` green; root `tsc --noEmit`; remotion `tsc --noEmit`; `ui next build`
- [ ] commit(s) + memory update
