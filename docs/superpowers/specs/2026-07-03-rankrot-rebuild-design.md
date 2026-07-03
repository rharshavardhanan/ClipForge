# RankRot Rebuild — Shorts Director for Topic Rankings

**Date:** 2026-07-03
**Status:** Approved design → implementation plan next
**Supersedes:** the "RankRot = Gemini-only, NO Claude" mandate from `2026-07-03-rankrot-design.md` (user now wants a provider-agnostic, Claude-ready vision layer)

## 1. Problem

The current RankRot engine (`src/rankrot/`) is a highlight extractor, not a director:

- **No topic validation.** It searches YouTube by keyword variants, sorts by views, downloads, and ranks — but never *watches* the footage to confirm it contains the requested topic. Input `slime` can surface a Preston clip with zero slime and it survives to a rank. The only filters are an AI-slop **title** regex ([`harvest.ts`](../../../src/rankrot/harvest.ts) `isLikelyAiSlop`) and a Gemini **text** `is_ai` flag — neither looks at pixels.
- **Motion-spike-only cuts.** [`moment.ts`](../../../src/rankrot/moment.ts) `momentWindow` isolates the strongest 4–12s fused motion+audio arc. That is the *peak*, not a *story*: it starts mid-action and can end before the payoff/reaction. The spec wants each rank to be a complete micro-story (setup → execution → result → reaction), 10–20s.

Result: irrelevant picks, and clips that feel like raw fragments rather than edited Shorts.

## 2. Goals

1. **Semantic topic validation (multimodal).** Every candidate that could win a rank is "watched": sampled frames go to a vision LLM that scores `topic_match` 0–10. Reject `< 8` (spec threshold). Off-topic footage never ranks.
2. **Full micro-story segments.** Each rank is a 10–20s complete arc (setup → action → payoff → reaction), each its own length, ~50–90s total across 5 ranks. Never a bare motion spike.
3. **Provider-agnostic, Claude-ready.** The vision call uses Claude when `ANTHROPIC_API_KEY` is present, else Gemini 2.5 Flash (free multimodal vision). Free today, Claude the day the user flips the key — no rewrite.
4. **Bounded, quota-safe call count.** Validation necessarily adds per-clip vision calls, but one call per clip folds in every LLM job that footage needs — topic validation + story segmentation + virality + AI-flag — so there is no duplicate pass, and the removed batched `viralityScores` call means the *only* added cost is the validation the feature requires. Early-stop caps it at ~`top + BUFFER` successes.
5. **Fail loud, not filler.** If fewer than `top` on-topic clips survive, the command errors with a clear message rather than shipping off-topic ranks.

## 3. Non-goals (explicitly unchanged)

Search/harvest/download ([`queries.ts`](../../../src/rankrot/queries.ts), [`harvest.ts`](../../../src/rankrot/harvest.ts)), the countdown renderer + stinger cards ([`RankRotVideo`](../../../remotion/src/RankRotVideo.tsx), [`rankrotLogic.ts`](../../../remotion/src/rankrotLogic.ts)), SFX, thumbnail, SEO/titles ([`titles.ts`](../../../src/rankrot/titles.ts)). Micro-captions stay in the existing single `buildTitles` call. Non-YouTube platforms remain deferred. Whisper transcription of harvested clips is **not** added (most RankRot topics are visual; music-over-action clips have no speech) — validation is frame-based.

## 4. Architecture

### 4.1 Provider-agnostic vision layer — `src/rankrot/vision.ts`

Two new pieces:

**`sampleFrames(videoPath, times: number[]): Promise<VisionImage[]>`**
Extracts one JPEG per timestamp via ffmpeg to temp files, reads them, returns `{ mimeType: 'image/jpeg', dataB64 }[]`. Frames are written to temp files and read back — **never piped through `run()` stdout** (house gotcha: stdout is utf8-corrupting for binary). Scaled to ≤512px wide to keep payloads small. Temp files removed in a `finally`.

**`askVisionJson({ system, prompt, schema, images, label }, env): Promise<unknown | null>`**
Mirrors [`askJson`](../../../src/broll/llmJson.ts) provider selection but multimodal:
- **Claude** (if `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`): `messages.create` with content = `[{type:'text',text:prompt}, {type:'image', source:{type:'base64', media_type, data}}...]` + `output_config.format = json_schema`. Reuses `isAuthError`/`DEFAULT_CLAUDE_MODEL` from `claudeSemantic.ts`.
- **Gemini** (fallback): `getGenerativeModel(...).generateContent([{text:prompt}, {inlineData:{mimeType, data}}...])`, strip fences, `JSON.parse`.
- No key → `null` (caller degrades to local-only). Never throws.

This retires the hard Gemini-only rule for RankRot. Everything else in the engine still avoids Claude for *text* to conserve Claude budget; only the vision "watch" step is dual-provider.

### 4.2 Pipeline order (rewrite of `runRankRot` in `pipeline.ts`)

```
1. queries → searchAll → downloadAll            (unchanged)
2. LOCAL pre-analysis per clip (cheap, no API):
     motion + audio curves → fused → peak → provisional window
     rawVisual / rawAudio (for pre-rank ordering + final layers)
3. Order clips by a cheap local pre-rank score (fused local impact, popularity tiebreak)
4. VALIDATE + SEGMENT in that order, one vision call/clip, EARLY-STOP:
     sample ~5 frames (4 evenly + fused peak) → askVisionJson
     keep clips with topic_match >= 8 AND not is_ai_or_slop
     stop once (top + BUFFER) clips have passed  (BUFFER = 2)
5. For each passer: build 10–20s micro-story segment from beats → extractMoment
     → reaction + frameHashes on the segment file  (as today)
6. collapseDupes → finalScore (topic_match is a GATE already applied, not a weight)
7. pickCountdown(top) → buildTitles → render + SFX + thumbnail + outputs
```

Early-stop bounds vision calls to roughly `top + BUFFER` successes plus rejects encountered — typically ~8–15 calls/run, comfortably inside a free-tier key pool.

### 4.3 Validation + segmentation call

**Inputs:** ~5 frames + `{ topic, title, channel, viewCount, durationSec }`.

**Output schema (one object):**
```jsonc
{
  "topic_match": 0,          // 0–10: does the FOOTAGE show <topic>? (visual, not the title)
  "is_ai_or_slop": false,    // AI-generated / animation / stock — reject
  "virality": 0,             // 0–10: scroll-stopping potential of this footage
  "beats": {                 // seconds within the clip; the story bounds
    "setup_start": 0.0,      // where the build-up/cause begins
    "action": 0.0,           // the main moment
    "payoff": 0.0,           // the result/impact
    "reaction_end": 0.0      // where the aftermath/reaction resolves
  },
  "reason": ""
}
```

**Gate:** keep iff `topic_match >= 8` and `!is_ai_or_slop`. `virality` and `beats` fold in what were the separate `viralityScores` batch and the local-only window.

**Prompt** (in `src/rankrot/validate.ts`, pure `buildValidatePrompt(topic, meta, frameTimes)`): frames are labelled with their timestamps so the model can place beats on the clip timeline; instruct it to judge topic match from **what is visible**, not the title; if the clip is a compilation, describe only the segment the frames cover.

**Fallback when `askVisionJson` returns null** (no key / quota dead): skip validation for that clip, mark `topic_match = null` (unknown), and fall back to the local curve window for beats. If *every* clip is unknown, the run degrades to today's popularity+curve behavior with a loud warning "topic validation skipped — no vision provider reachable."

### 4.4 Micro-story segment builder — rewrite `moment.ts`

New `MIN_MOMENT_SEC = 10`, `MAX_MOMENT_SEC = 20`.

**`storyWindow(beats, fused, clipDurSec): { start; end }`** (pure):
- If beats present: `start = beats.setup_start − PRE_PAD`, `end = beats.reaction_end + TAIL_PAD`.
- Clamp to `[10, 20]`s: if under 10, grow symmetrically around `beats.action`; if over 20, keep `action` centered and trim the quieter side (favor keeping the payoff/reaction tail).
- Clamp inside the source.

**`curveWindow(fused, clipDurSec)`** = today's `momentWindow` bidirectional growth, retuned to the 10–20s band with a longer reaction tail (`TAIL_PAD` 1.25s) — the **fallback** when beats are unavailable. Short sources (≤ max) are kept whole.

`extractMoment` unchanged (re-encode, not stream-copy). The **fused-curve peak stays authoritative** for the replay `peakSec` and the thumbnail focus (more precise than a frame-sampled beat).

### 4.5 Ranking, structure, replay

- Five local layers stay in [`score.ts`](../../../src/rankrot/score.ts) with the same `WEIGHTS`, but `virality` now comes from the vision call (per-clip) instead of the removed batched text call. `topic_match` is **not** a weight — it already gated the pool, so a spectacular off-topic clip is simply absent.
- Segments are 10–20s, so the render item `durationSec` grows; `RankRotVideo`/`rankrotLogic` need no structural change (they already lay stinger card → clip → optional replay per rank). Total runtime ~50–90s + cards + replays stays a valid Short (< 3 min).
- Slow-mo replay for #1 and #2 is unchanged — it re-shows the fused peak with zoom + impact ([`render.ts`](../../../src/rankrot/render.ts) `buildRankRotProps`).

### 4.6 Quality gate ("human editor test") & fail-soft

- A clip is rejected pre-rank if `topic_match < 8`, `is_ai_or_slop`, or its story window can't reach the 10s floor with a real arc.
- If `passers < top`: throw `Only N on-topic clip(s) found for "<topic>" — try a broader topic.` (mirrors the existing "need at least top" guards in `pipeline.ts`).
- All LLM failures are non-fatal: a single clip's vision failure drops that clip; total vision unavailability degrades to local-only with a warning. The command always either produces a coherent on-topic ranking or fails with an actionable message.

## 5. File-by-file changes

| File | Change |
|---|---|
| `src/rankrot/vision.ts` | **NEW** — `sampleFrames`, `askVisionJson`, `VisionImage` type. |
| `src/rankrot/validate.ts` | **NEW** — `buildValidatePrompt` (pure), `validateSchema`, `validateClip(frames, meta)` → `ClipValidation`, `parseValidation` (pure, tolerant). |
| `src/rankrot/moment.ts` | Rewrite: `MIN/MAX_MOMENT_SEC` 10/20; add `storyWindow` (beats-driven, pure) + `curveWindow` (fallback); keep `extractMoment`. |
| `src/rankrot/pipeline.ts` | Reorder to §4.2: local pre-analysis → pre-rank order → validate+segment with early-stop → dedupe → score → render. Remove the `viralityScores` call site; source `virality` from validation. Manifest gains `topic_match`, `beats`, `validated` per pick + a `validation_provider` field. |
| `src/rankrot/score.ts` | `viralityScores` (batched Gemini text call) **removed**; `LayerScores.virality` now populated from validation. `finalScore`/`WEIGHTS`/`collapseDupes`/`reactionScore`/`frameHashes` unchanged. |
| `src/rankrot/harvest.ts` | Unchanged (title AI-slop regex stays as a cheap pre-filter before download). |
| `src/rankrot/titles.ts` | Unchanged (micro-captions + SEO title). |
| `src/broll/llmJson.ts` | Unchanged; `askVisionJson` lives in `rankrot/vision.ts` and reuses the exported `isAuthError`/`stripFences`/`DEFAULT_CLAUDE_MODEL`. |
| tests | New unit tests for `parseValidation`, `buildValidatePrompt`, `storyWindow`, `curveWindow` (all pure). One gated integration test on a real short clip end-to-end (validation → segment) behind the existing gated-test convention. |

## 6. Data shapes

```ts
// vision.ts
export interface VisionImage { mimeType: string; dataB64: string; }

// validate.ts
export interface ClipBeats { setup_start: number; action: number; payoff: number; reaction_end: number; }
export interface ClipValidation {
  topicMatch: number;        // 0–10; NaN/null when the model couldn't be reached
  isAiOrSlop: boolean;
  virality: number;          // 0–10
  beats: ClipBeats | null;
  reason: string;
}
```

`parseValidation` is tolerant: missing/out-of-range numbers clamp to `[0,10]`; missing beats → `null` (segment falls back to `curveWindow`); malformed JSON → `null` validation (clip treated as unknown, not rejected).

## 7. Cost / quota

Per run: 1 queries call + ~`top + BUFFER + rejects` vision calls (≈ 8–15) + 1 titles call. This is more than today's 3 text calls — validation is new work — but it is the *minimum* for the feature: each vision call does validation **and** segmentation **and** virality **and** the AI-flag in one pass, and the batched `viralityScores` call is removed, so nothing is paid for twice. Early-stop and the small BUFFER keep the count well inside a free-tier Gemini key pool; the identical count applies to Claude when that key is set.

## 8. Testing

- **Pure/unit:** `parseValidation` (tolerance, clamping, null beats), `buildValidatePrompt` (frame timestamps present, topic echoed), `storyWindow` (10–20s clamp; grows short arcs around `action`; trims the quiet side, keeps the tail), `curveWindow` fallback (band retune), `mergeCandidates`/`popularityFilter` (unchanged, keep green).
- **Provider selection:** `askVisionJson` picks Claude when the key is set, Gemini otherwise, `null` with neither — asserted with env stubs (no network).
- **Gated integration:** one real short clip → `sampleFrames` produces N jpeg buffers → validate → `storyWindow` yields a 10–20s span. Behind the repo's gated-test flag; sample only a few seconds to stay fast under render load.

## 9. Deferrals

Whisper transcription of harvested clips; non-YouTube platform search; per-rank GUI editing; validating *every* harvested clip (early-stop chosen for quota). These stay out of this slice.
