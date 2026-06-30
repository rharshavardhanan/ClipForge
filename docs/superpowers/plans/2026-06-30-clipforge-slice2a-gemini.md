# ClipForge Slice 2a — Gemini Semantic Brain (core)

> Makes clip selection meaning/emotion-driven instead of loudness-driven. Builds on Slice 1 + reframe. GEMINI_API_KEY is set; validate live.

**Goal:** A Gemini semantic layer that scores transcript windows for virality/emotion, drives the composite score + clip boundaries (hook-opener, standalone, recommended duration), and shows a hook card. Graceful fallback to Slice-1 (trigger+audio) scoring if Gemini is unavailable.

**Stack:** `@google/generative-ai` SDK; model from `GEMINI_MODEL` env (default a current flash-class model, e.g. `gemini-2.0-flash` — configurable; the implementer should use a current valid id and not hardcode a deprecated one). Concurrency-limited (5), retried.

## Global Constraints
- ESM `.js` imports. New runtime dep: `@google/generative-ai` (allowed — Slice 2 feature).
- **Graceful degradation is mandatory:** no API key, or all chunks fail → return empty semantic layer and the pipeline falls back to Slice-1 composite (`trigger*0.6 + audio*0.4`). Never crash the pipeline on Gemini errors.
- Cache semantic results to `workspace/analysis/{jobId}/layer_semantic.json` (don't re-call Gemini on re-runs).
- All Gemini JSON parsing must be defensive (strip markdown fences, try/catch, skip bad chunks).

---

### Task S2-1: Semantic layer (`src/analysis/semantic.ts`)
**Produces:**
- `chunkTranscript(segments, windowSec=30, overlapSec=15): {start:number; end:number; text:string}[]` — PURE. Sliding 30s/15s windows; text = joined segment text within the window (cap ~800 tokens/~3000 chars).
- `semanticScore(scores): number` — PURE weighted avg: `emotional_intensity*0.20 + controversy*0.15 + humor*0.15 + surprise*0.15 + wisdom*0.10 + storytelling_tension*0.10 + argument_peak*0.10 + relatability*0.05`.
- `parseGeminiJson(raw: string): SemanticChunkResult | null` — PURE. Strips ```json fences, JSON.parse, returns null on failure.
- `analyzeSemantic(segments, opts:{apiKey?, model?, outPath?}): Promise<SemanticWindow[]>` — chunks, calls Gemini per chunk (concurrency 5, `withRetry` 3x), parses, computes semanticScore; writes `layer_semantic.json`; returns `[]` if no apiKey or all fail (caller falls back). Reuses cached outPath if present.

**Types (add to `src/types/index.ts`):**
```typescript
export interface SemanticScores { emotional_intensity:number; controversy:number; humor:number; surprise:number; wisdom:number; storytelling_tension:number; argument_peak:number; relatability:number; }
export interface SemanticWindow { start:number; end:number; semantic_score:number; scores:SemanticScores; hook_moment:string; clip_titles:string[]; is_standalone:boolean; recommended_duration:number; sentiment:'serious'|'funny'|'intense'|'neutral'; reason:string; }
```

**Gemini prompt (system + per-chunk user):** Use the master-spec viral-analyst prompt. System: "You are a viral content analyst… Return ONLY valid JSON…" scoring each dimension 0–10, plus `hook_moment` (sharpest scroll-stopping sentence verbatim from the chunk), `clip_titles` (3, <8 words), `is_standalone` (bool), `recommended_duration` (30/45/60/90), and **`sentiment`** (one of serious|funny|intense|neutral — added for caption coloring), and `reason` (one sentence). Return JSON:
```json
{ "scores": { "emotional_intensity":0,"controversy":0,"humor":0,"surprise":0,"wisdom":0,"storytelling_tension":0,"argument_peak":0,"relatability":0 },
  "hook_moment":"", "clip_titles":["","",""], "is_standalone":true, "recommended_duration":60, "sentiment":"neutral", "reason":"" }
```
(Compute `semantic_score` locally via `semanticScore()` — don't trust the model to weight.)

**Tests** (`tests/analysis/semantic.test.ts`): TDD the PURE fns — `chunkTranscript` (30s/15s windows, text join, cap); `semanticScore` (known weights → known value); `parseGeminiJson` (strips fences; bad input → null). `analyzeSemantic` Gemini call: gate an integration test behind `GEMINI_API_KEY` presence (skip if absent) — assert it returns windows with numeric scores for a tiny 2-segment transcript.

### Task S2-2: Composite + boundary integration
- `windowScorer.ts`: accept optional semantic windows; composite becomes `semantic*0.35 + audio*0.20 + trigger*0.15 + pacing*0(0) + visual*0(0) + metadata*0(0)` when semantic present, else Slice-1 `trigger*0.6+audio*0.4`. Map a window's semantic_score by nearest-overlapping SemanticWindow.
- `merger.ts`/`ranker.ts`: prefer starting a clip at the overlapping window's `hook_moment` sentence boundary; drop clips with `is_standalone=false` AND composite<7; carry `semantic_score`, `hook_moment`, `clip_titles`, `is_standalone`, `recommended_duration`, `sentiment`, semantic `reason` onto `RankedClip`.
- Keep all pure + TDD'd; existing tests stay green (semantic optional).

### Task S2-3: Hook card + pipeline wiring + live validation
- `remotionRenderer.ts`/`CaptionedClip.tsx`: pass `showHookCard:true` + `hookText:clip.hook_moment` (truncate ≤8 words + "…") when present.
- `cli/commands/all.ts`: after transcript → `analyzeSemantic` (key from env) → pass semantic windows to scoring; render with hook card.
- Live: `all <url> --top 1`; confirm clips are chosen on meaning (semantic_score populated, hook_moment shown), hook card visible first ~1.5s, fallback works if key removed.

## Self-Review
2a delivers: semantic scoring (S2-1), meaning-driven composite + standalone/hook boundaries (S2-2), hook card + live proof (S2-3). Fallback preserves Slice-1 behavior. 2b (clickbait package, sentiment-colored captions, comment mining) follows.
