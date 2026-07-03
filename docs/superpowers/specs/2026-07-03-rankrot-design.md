# RankRot Engine — topic → harvested clips → AI ranking → brainrot countdown Short

**Date:** 2026-07-03 · **Branch:** slice-1 · **Spec:** "ClipForge RankRot Engine" (user, 2026-07-03)

One command: `clipforge rankrot "best basketball dunks"` → searches the internet, harvests
30–50 clips, trims each to its strongest 3–8s, ranks them through 5 scoring layers
(NO Claude — Gemini Flash + local signal analysis only, per spec), and renders a
5→4→3→2→1 countdown Short with rank rail, brainrot titles, micro-captions, replays,
SFX, SEO pack, and thumbnail.

## Deliberate pivots (documented, consistent with house pivots)

- **Search = YouTube (incl. Shorts) via yt-dlp.** TikTok/IG/Reddit/X have no yt-dlp search
  extractors; Playwright scraping is brittle, ToS-hostile, and not installed. Deferred.
  Breadth comes from LLM query variations (5 queries × 10 results).
- **OpenCV → ffmpeg `signalstats` YDIF** (inter-frame luma difference at 8fps, 160px) as the
  motion/impact signal — pure local, no Python (house rule: no Python microservices).
- **Librosa → ffmpeg `astats`** (existing house pivot): 0.5s RMS windows + a lowpass(150Hz)
  bass-energy pass for "bass hits".
- **Local embeddings → average-hash (aHash)** on 3 sampled frames (pngjs, already a dep) +
  title token overlap for duplicate collapse and novelty distance.
- **GUI = one RankRot tab** (topic → run → live log → result player), not 7 tabs; per-clip
  replace/reorder/trim editing deferred like the main GUI's fine-grained editing.

## Pipeline (`src/rankrot/`)

1. **`queries.ts`** — 5 search variations: Gemini Flash (JSON array) with a pure template
   fallback (`crazy X`, `insane X`, `viral X`, `best X ever`, `X gone wrong`…). No Claude.
2. **`harvest.ts`** — reuse `broll/search.ts` (`searchBroll` gains `{minSec,maxSec,n}` opts):
   5–240s sources, merge/dedupe by id, cap 40. Download full clips WITH audio to
   `./rankrot_cache/<id>.mp4` (`bv*[height<=1080]+ba`, `--max-filesize 250M`, skip cached,
   sequential-ish concurrency 3, failures dropped).
3. **`signals.ts`** — per source: `motionCurve` (fps=8, scale=160, signalstats YDIF →
   {time,v}[]) and `audioCurve` (0.5s RMS + 0.5s bass RMS). Pure parsers, tested.
4. **`moment.ts`** — fuse normalized motion+audio into one curve; slide a 3–8s window:
   pick the window holding the global fused peak with ~35% pre-roll (build-up) and
   post-roll (reaction); extend toward 8s only while fused stays ≥60% of peak.
   Trim via re-encode into `workspace/rankrot/<slug>/m_<id>.mp4`. Pure math, tested.
5. **`score.ts`** — layers on the trimmed moment, each 0–10, pool-normalized (min-max):
   - visual 0.35: YDIF p95 + spike ratio (p95/median)
   - audio 0.20: RMS p95 lift over median + bass p95
   - reaction 0.20: `detectFrameObs` @2fps on the trimmed clip → face presence + max
     face-area growth (shock/celebration proxy); detector failure → 0 (fail-soft)
   - virality 0.15: ONE Gemini Flash batch call scoring all clips 1–10 from
     title/channel/duration/measured-metrics; fallback: log-scaled view_count
   - novelty 0.10: min aHash hamming distance to other clips; near-dupes
     (dist < 10/64 or title overlap > 0.7) collapsed keeping the higher provisional score
   `final = 0.35v + 0.20a + 0.20r + 0.15vir + 0.10n` → top 5 → ordered **5→1**.
6. **`titles.ts`** — topTitle `RANKING <TOPIC>` + subtext `(last one is insane)`;
   per-clip micro-captions via the same Gemini batch (meme register: "BRO GOT COOKED",
   "HE FELL HARD") with a seeded fallback pool; SEO pack (title + hashtags + description)
   templated from topic, Gemini-polished when available. Pure fallbacks, tested.
7. **Render** — new Remotion comp **`RankRotVideo`** + pure `rankrotLogic.ts`:
   - timeline: per rank → stinger card (0.7s, huge "#N") → clip → **replay** (top-2 fused
     score: first ~60% again at 0.5× slow-mo with zoom-in) → next; #1 card holds 1.0s
   - persistent UI: multi-color bold top title + subtext; left rank rail 5..1 that fills
     as the countdown progresses (done/active/pending states); micro-title lower-third
     with pop-in; camera-shake jitter on each clip's first ~8 frames; punch-in ease
   - framing: vertical sources full-bleed; horizontal → contain over blurred cover
     backdrop (Broll pattern — never crop badly)
   - SFX mirror (`rankrotSfx` in logic, same contract as punchZoom↔sfx/events): whoosh at
     every card, impact at clip start, riser at #1 card, bass at #1 clip start → `mixSfx`
8. **Outputs** → `workspace/exports/rankrot_<slug>/`: `ranking_final.mp4`, `title.txt`,
   `description.txt`, `hashtags.txt`, `thumbnail.png` (reuse `generateThumbnail` on the
   #1 moment's peak frame), `rankrot_manifest.json` (queries, candidates, layer scores,
   picks, timeline).

## CLI / GUI

- `clipforge rankrot <topic>` — `--top 5 --harvest 40 --accent --no-sfx --sfx-dir
  --cache-dir --no-replays --min-score-clips` (fail with a clear message when <top
  harvestable clips survive).
- GUI: 6th tab **RankRot**: topic input, Run (POST `/api/rankrot` → `startRun(['rankrot',…])`,
  existing SSE RunLog), then plays `ranking_final.mp4` via `/api/video`.

## Testing

Pure units: template queries, search bound opts, YDIF/astats parsers, moment fusion window,
min-max pool normalization, aHash + hamming + dupe collapse, weighted final + 5→1 ordering,
timeline builder (phases/replays/frame math), SFX mirror times, micro-title seeded fallback,
SEO pack, props builder. Gates: vitest, root+remotion tsc, ui build, live smoke on a real
topic end-to-end.

## Non-goals now

TikTok/IG/Reddit/X harvesting (no search extractors; scraping deferred), per-clip GUI
editing (replace/reorder/trim — CLI re-run covers it), freeze-frame time-remap (audio
desync house rule), music bed (clip audio + SFX carry brainrot energy).
