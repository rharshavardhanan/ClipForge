# ClipForge Multi-Video Cross-Ranking

> Ingest N videos, pool their clip candidates, rank the best moments ACROSS all of them, export one combined top-N leaderboard. Each exported clip is extracted/captioned/reframed from its own source. Semantic (Gemini) score is absolute 0–10 → comparable across videos.

## MV1 — pipeline refactor + batch orchestrator (`src/cli/commands/all.ts` or new `batch.ts`)
Refactor the current monolithic `runAll(url)` into composable pieces:
- `analyzeVideo(url, opts): Promise<VideoAnalysis>` — ingest → metadata → transcript → triggers + audio + (Gemini) semantic → scoreWindows → buildClips → **return candidates, do NOT export**. `VideoAnalysis = { jobId, url, videoPath, meta, segments, triggers, audio, semantic, candidates: ClipCandidate[] }`.
- `rankAndExport(analyses: VideoAnalysis[], opts): Promise<string>` — pool ALL candidates across analyses (tag each with its source analysis), rank GLOBALLY by composite (within-video transcript-dedup already applied per analysis; no cross-video dedup needed — different content), take top `--top`. For each top clip, extract + face-track reframe + caption-render + export **from its source video** (reusing meta/segments/triggers/sentiment from that clip's `VideoAnalysis`). Write ONE combined `clips_manifest.json` (each clip records `source_video` = its jobId + url). Exports go to `workspace/exports/batch_<id>/`.
- `runAll(url, opts)` = `rankAndExport([await analyzeVideo(url, opts)], opts)` (single-video path unchanged in behavior/output for one URL — keep the existing single-video exports dir for the 1-URL case, or batch dir; pick the simplest that keeps Slice-1 behavior for single URL).
- `runBatch(urls: string[], opts)` = `rankAndExport(await Promise.all/sequential(urls.map(analyzeVideo)), opts)`. Ingest/transcript/analysis are cached per jobId, so re-runs are cheap. Run videos sequentially (Gemini rate limits + memory).
- Optional `--per-video-cap <n>` to prevent one video monopolizing all slots (default: no cap = pure best-N).

**Tests:** the global pooling+ranking is pure-testable — `rankAcrossAnalyses(candidatesWithSource, top)` sorts by composite across sources, respects top-N (and per-video-cap if set), keeps source attribution. Unit-test that. Heavy extract/render stays integration (live).

## MV2 — CLI `batch` command
- `clipforge batch <urls...>` (commander VARIADIC args) `[--top N] [--style] [--accent] [--per-video-cap N]` → preflight → `runBatch(urls, opts)`.
- Also accept a file: if a single arg ends in `.txt`, read URLs (one per line). 
- Print a combined leaderboard table showing each clip's source video + score.
- Validate live with 2 short URLs (e.g. the Grit talk + one more short talk) → confirm a combined manifest with clips from both, ranked together.

## Notes
- Cross-video score comparability relies on the absolute Gemini semantic score (dominant weight). In Gemini-fallback mode (audio+trigger), ranking still works but is louder-video-biased — acceptable.
- jobId per video stays the YT id (caching); batch id = short hash/timestamp of the url set.
