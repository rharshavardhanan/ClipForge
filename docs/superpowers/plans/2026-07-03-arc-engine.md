# Micro-Story Arc Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clips are constructed around complete micro-stories (setup→trigger→escalation→peak→payoff→reaction) found by LLM arc mining + completion, and a strict 6/6 gate rejects incomplete stories before export.

**Architecture:** Hybrid two-pass: a text-only mining pass over transcript chunks adds complete-story candidates to the existing scorer's pool; a vision-capable completion pass on the top-K ranked candidates fixes clip boundaries (expand to cause/reaction) and labels all six components; a hard gate exports only 6/6 clips (`--lenient` overrides). arcScore joins the ranker composite at weight 0.25 (renormalized).

**Tech Stack:** TypeScript ESM (`.js` import suffixes), vitest, ffmpeg via `src/utils/ffmpeg.ts`/`cmd.ts`, `@google/generative-ai` + `@anthropic-ai/sdk` through `src/broll/llmJson.ts`.

**Spec:** `docs/superpowers/specs/2026-07-03-arc-engine-design.md` — read it first.

## Global Constraints

- **Gemini-first:** every feature must work fully with only `GEMINI_API_KEYS` set (Gemini 2.5 Flash, vision included). Claude is an upgrade, never a dependency. Provider resolution = `pickSemanticProvider(process.env)` from `src/analysis/semanticEngine.ts` (honors `SEMANTIC_PROVIDER=auto|claude|gemini|none`).
- **No LLM → arc engine off** with one logged warning; pipeline behaves exactly as today (no gate).
- **Strict 6/6 gate** (user mandate): all six components identified or the clip is rejected; components may be brief (≥0.5s) or overlapping/nested. `--lenient` exports rejected clips labeled `arc.complete=false`.
- **GOTCHA (house rule):** never capture binary output from a spawned process' stdout — it is UTF-8-corrupted. Frames go to temp files, then `readFile` (same pattern as RankRot's aHash).
- Existing invariants hold: sentence-aware clamps (`clampToSentences`, `src/clipDetection/merger.ts:63`), mode envelopes (clippies 15–45s, mindcuts 20–60s via `MODE_PROFILES[mode].lengths`), `used_ranges` no-repeat, one framing per clip.
- House style: pure functions exported for tests, `/** PURE: ... */` doc comments, fail-soft with `logger.warn`, test seams as optional function params (see `fetchFn` in `src/avss/performance.ts`).
- Run all tests with `npx vitest run <path>`; full gates at the end: `npx vitest run`, `npx tsc --noEmit`, `cd remotion && npx tsc --noEmit`, `cd ui && npm run build`.

---

### Task 1: Arc types + pure helpers

**Files:**
- Modify: `src/types/index.ts` (add arc types; add `arc?: ArcLabel` to `ClipCandidate` and `RankedClip`)
- Create: `src/analysis/arcTypes.ts`
- Test: `tests/analysis/arcTypes.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - types: `ArcComponentName`, `ArcSpan { start; end }`, `ArcComponents = Partial<Record<ArcComponentName, ArcSpan>>`, `ArcLabel { synopsis: string; confidence: number; components: ArcComponents; reactionAfterPeak?: boolean; provider?: string }`
  - `ARC_COMPONENT_NAMES: ArcComponentName[]` (ordered setup→reaction), `MIN_COMPONENT_SEC = 0.5`
  - `missingComponents(c: ArcComponents): ArcComponentName[]`
  - `arcOuterSpan(c: ArcComponents): ArcSpan | null` (min start / max end over present spans; null when empty)
  - `validateArc(raw: unknown, durationSec: number): ArcLabel | null`
  - `arcScore(label: Pick<ArcLabel, 'confidence' | 'components' | 'reactionAfterPeak'>): number`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/analysis/arcTypes.test.ts
import { describe, expect, it } from 'vitest';
import {
  ARC_COMPONENT_NAMES, arcOuterSpan, arcScore, missingComponents, validateArc,
} from '../../src/analysis/arcTypes.js';

const full = {
  setup: { start: 10, end: 14 }, trigger: { start: 13, end: 14 },
  escalation: { start: 14, end: 18 }, peak: { start: 18, end: 20 },
  payoff: { start: 20, end: 23 }, reaction: { start: 22, end: 26 },
};

describe('missingComponents', () => {
  it('empty for a full arc, names absentees in canonical order', () => {
    expect(missingComponents(full)).toEqual([]);
    const { trigger, payoff, ...rest } = full;
    expect(missingComponents(rest)).toEqual(['trigger', 'payoff']);
  });
});

describe('arcOuterSpan', () => {
  it('min start to max end; null when empty', () => {
    expect(arcOuterSpan(full)).toEqual({ start: 10, end: 26 });
    expect(arcOuterSpan({})).toBeNull();
  });
});

describe('validateArc', () => {
  const raw = { synopsis: 's', confidence: 0.8, components: full };
  it('accepts a well-formed label', () => {
    expect(validateArc(raw, 100)?.confidence).toBe(0.8);
  });
  it('rejects non-objects, missing synopsis, spans outside the source, and sub-0.5s spans', () => {
    expect(validateArc(null, 100)).toBeNull();
    expect(validateArc({ ...raw, synopsis: '' }, 100)).toBeNull();
    expect(validateArc({ ...raw, components: { ...full, peak: { start: 90, end: 120 } } }, 100)).toBeNull();
    expect(validateArc({ ...raw, components: { ...full, trigger: { start: 13, end: 13.2 } } }, 100)).toBeNull();
  });
  it('drops malformed component entries but keeps valid ones (partial arcs allowed)', () => {
    const v = validateArc({ ...raw, components: { setup: full.setup, peak: 'nope' } }, 100);
    expect(v?.components).toEqual({ setup: full.setup });
  });
  it('clamps confidence to [0,1]', () => {
    expect(validateArc({ ...raw, confidence: 7 }, 100)?.confidence).toBe(1);
  });
});

describe('arcScore', () => {
  it('confidence × completeness × reaction bonus, clamped to [0,1]', () => {
    expect(arcScore({ confidence: 0.8, components: full })).toBeCloseTo(0.8);
    expect(arcScore({ confidence: 0.8, components: full, reactionAfterPeak: true })).toBeCloseTo(Math.min(1, 0.8 * 1.15));
    const { trigger, escalation, ...four } = full;
    expect(arcScore({ confidence: 0.9, components: four })).toBeCloseTo(0.9 * (4 / 6));
    expect(arcScore({ confidence: 1, components: full, reactionAfterPeak: true })).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analysis/arcTypes.test.ts`
Expected: FAIL — module `src/analysis/arcTypes.ts` not found.

- [ ] **Step 3: Implement**

In `src/types/index.ts`, next to `SemanticWindow`:

```ts
// Micro-story arc (v7): six-component story label over source-absolute times.
export type ArcComponentName = 'setup' | 'trigger' | 'escalation' | 'peak' | 'payoff' | 'reaction';
export interface ArcSpan { start: number; end: number; }
export type ArcComponents = Partial<Record<ArcComponentName, ArcSpan>>;
export interface ArcLabel {
  synopsis: string;
  confidence: number;                 // 0-1
  components: ArcComponents;
  reactionAfterPeak?: boolean;
  provider?: string;
}
```

Add `arc?: ArcLabel;` to both `ClipCandidate` and `RankedClip`.

```ts
// src/analysis/arcTypes.ts
/**
 * Micro-story arc helpers (v7) — pure validation and scoring over ArcLabel.
 * Components may be brief (>=0.5s) or overlap/nest; strictness lives in the
 * gate (arcCompleter), not here.
 */
import type { ArcComponentName, ArcComponents, ArcLabel, ArcSpan } from '../types/index.js';
import { clamp01 } from '../avss/editPlan.js';

export const ARC_COMPONENT_NAMES: ArcComponentName[] =
  ['setup', 'trigger', 'escalation', 'peak', 'payoff', 'reaction'];
export const MIN_COMPONENT_SEC = 0.5;
const REACTION_AFTER_PEAK_BONUS = 1.15;

/** PURE: absent component names in canonical order. */
export function missingComponents(c: ArcComponents): ArcComponentName[] {
  return ARC_COMPONENT_NAMES.filter((k) => !c[k]);
}

/** PURE: min start → max end over present spans; null when none. */
export function arcOuterSpan(c: ArcComponents): ArcSpan | null {
  const spans = ARC_COMPONENT_NAMES.flatMap((k) => (c[k] ? [c[k] as ArcSpan] : []));
  if (spans.length === 0) return null;
  return {
    start: Math.min(...spans.map((s) => s.start)),
    end: Math.max(...spans.map((s) => s.end)),
  };
}

function validSpan(s: unknown, durationSec: number): s is ArcSpan {
  const sp = s as ArcSpan;
  return typeof sp?.start === 'number' && typeof sp?.end === 'number'
    && sp.start >= 0 && sp.end <= durationSec
    && sp.end - sp.start >= MIN_COMPONENT_SEC;
}

/** PURE: shape-check one LLM-returned arc. Malformed components are dropped
 *  (partial arcs are legal — the GATE enforces 6/6, not the parser); a label
 *  with zero valid components, no synopsis, or non-numeric confidence → null. */
export function validateArc(raw: unknown, durationSec: number): ArcLabel | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.synopsis !== 'string' || r.synopsis.trim() === '') return null;
  if (typeof r.confidence !== 'number' || Number.isNaN(r.confidence)) return null;
  const rawComponents = (r.components ?? {}) as Record<string, unknown>;
  const components: ArcComponents = {};
  for (const k of ARC_COMPONENT_NAMES) {
    if (validSpan(rawComponents[k], durationSec)) components[k] = rawComponents[k] as ArcSpan;
  }
  if (Object.keys(components).length === 0) return null;
  return {
    synopsis: r.synopsis.trim(),
    confidence: clamp01(r.confidence),
    components,
    ...(typeof r.reactionAfterPeak === 'boolean' ? { reactionAfterPeak: r.reactionAfterPeak } : {}),
  };
}

/** PURE: spec §5 — confidence × completenessFraction × reaction bonus, clamped. */
export function arcScore(label: Pick<ArcLabel, 'confidence' | 'components' | 'reactionAfterPeak'>): number {
  const completeness = (6 - missingComponents(label.components).length) / 6;
  return clamp01(label.confidence * completeness * (label.reactionAfterPeak ? REACTION_AFTER_PEAK_BONUS : 1));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analysis/arcTypes.test.ts` — Expected: PASS.
Also run: `npx tsc --noEmit` — Expected: clean (the `arc?` additions are optional, nothing breaks).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/analysis/arcTypes.ts tests/analysis/arcTypes.test.ts
git commit -m "feat(arc): arc types + pure validation/scoring helpers"
```

---

### Task 2: Transcript chunker

**Files:**
- Create: `src/analysis/arcChunker.ts`
- Test: `tests/analysis/arcChunker.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment { start; end; text }` from `src/types/index.js`.
- Produces: `TranscriptChunk { start: number; end: number; segments: TranscriptSegment[] }`, `chunkTranscript(segments, chunkSec = 540, overlapSec = 60): TranscriptChunk[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/analysis/arcChunker.test.ts
import { describe, expect, it } from 'vitest';
import { chunkTranscript } from '../../src/analysis/arcChunker.js';
import type { TranscriptSegment } from '../../src/types/index.js';

const seg = (start: number, end: number): TranscriptSegment => ({ start, end, text: `t${start}` });

describe('chunkTranscript', () => {
  it('single chunk when the transcript fits', () => {
    const chunks = chunkTranscript([seg(0, 30), seg(30, 400)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].segments).toHaveLength(2);
  });
  it('steps by chunkSec-overlapSec; segments overlapping a window are included in it', () => {
    const segs = Array.from({ length: 130 }, (_, i) => seg(i * 10, i * 10 + 10)); // 0..1300s
    const chunks = chunkTranscript(segs, 540, 60);
    expect(chunks[0].start).toBe(0);
    expect(chunks[1].start).toBe(480);              // 540 - 60
    expect(chunks[2].start).toBe(960);
    // the segment spanning 500-510 lives in both chunk 0 (ends 540) and chunk 1 (starts 480)
    expect(chunks[0].segments.some((s) => s.start === 500)).toBe(true);
    expect(chunks[1].segments.some((s) => s.start === 500)).toBe(true);
  });
  it('drops empty chunks and returns [] for no segments', () => {
    expect(chunkTranscript([])).toEqual([]);
    // one early segment, long silence, one late segment: middle windows are empty
    const chunks = chunkTranscript([seg(0, 10), seg(2000, 2010)], 540, 60);
    expect(chunks.every((c) => c.segments.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analysis/arcChunker.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/analysis/arcChunker.ts
/** PURE: split a transcript into ~chunkSec windows with overlapSec overlap for arc mining. */
import type { TranscriptSegment } from '../types/index.js';

export interface TranscriptChunk { start: number; end: number; segments: TranscriptSegment[]; }

export function chunkTranscript(
  segments: TranscriptSegment[], chunkSec = 540, overlapSec = 60,
): TranscriptChunk[] {
  if (segments.length === 0) return [];
  const last = Math.max(...segments.map((s) => s.end));
  const step = Math.max(1, chunkSec - overlapSec);
  const out: TranscriptChunk[] = [];
  for (let start = 0; start < last; start += step) {
    const end = start + chunkSec;
    const inWindow = segments.filter((s) => s.end > start && s.start < end);
    if (inWindow.length > 0) out.push({ start, end, segments: inWindow });
    if (end >= last) break;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analysis/arcChunker.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/arcChunker.ts tests/analysis/arcChunker.test.ts
git commit -m "feat(arc): transcript chunker for arc mining"
```

---

### Task 3: Motion analysis layer (promote RankRot YDIF, cached)

**Files:**
- Create: `src/analysis/motion.ts`
- Test: `tests/analysis/motion.test.ts`

**Interfaces:**
- Consumes: `motionCurve(videoPath): Promise<CurvePoint[]>` and `CurvePoint { time; v }` from `src/rankrot/signals.js` (already pure-ffmpeg, no LLM).
- Produces: `motionLayer(videoPath: string, outPath: string, curveFn?): Promise<CurvePoint[]>` — cached JSON at `outPath` (the analysis dir's `layer_motion.json`), compute-once semantics.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/analysis/motion.test.ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { motionLayer } from '../../src/analysis/motion.js';

const CURVE = [{ time: 0, v: 1.5 }, { time: 0.125, v: 3.2 }];

describe('motionLayer', () => {
  it('computes once and writes the cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-'));
    const out = join(dir, 'layer_motion.json');
    const fn = vi.fn().mockResolvedValue(CURVE);
    expect(await motionLayer('/v.mp4', out, fn)).toEqual(CURVE);
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(CURVE);
    expect(fn).toHaveBeenCalledOnce();
  });
  it('cache hit skips computation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-'));
    const out = join(dir, 'layer_motion.json');
    await writeFile(out, JSON.stringify(CURVE));
    const fn = vi.fn();
    expect(await motionLayer('/v.mp4', out, fn)).toEqual(CURVE);
    expect(fn).not.toHaveBeenCalled();
  });
  it('corrupt cache → recompute', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motion-'));
    const out = join(dir, 'layer_motion.json');
    await writeFile(out, 'not json');
    const fn = vi.fn().mockResolvedValue(CURVE);
    expect(await motionLayer('/v.mp4', out, fn)).toEqual(CURVE);
    expect(fn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analysis/motion.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/analysis/motion.ts
/**
 * Motion analysis layer (v7) — RankRot's ffmpeg signalstats YDIF curve promoted
 * to the main pipeline, cached like other analysis layers (layer_motion.json).
 * No LLM involved.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { motionCurve, type CurvePoint } from '../rankrot/signals.js';

export async function motionLayer(
  videoPath: string, outPath: string, curveFn: typeof motionCurve = motionCurve,
): Promise<CurvePoint[]> {
  try {
    const cached = JSON.parse(await readFile(outPath, 'utf8'));
    if (Array.isArray(cached)) return cached as CurvePoint[];
  } catch { /* cold or corrupt cache */ }
  const curve = await curveFn(videoPath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(curve));
  return curve;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analysis/motion.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/motion.ts tests/analysis/motion.test.ts
git commit -m "feat(arc): motion analysis layer — cached YDIF curve on the main pipeline"
```

---

### Task 4: Evidence block builder

**Files:**
- Create: `src/analysis/arcEvidence.ts`
- Test: `tests/analysis/arcEvidence.test.ts`

**Interfaces:**
- Consumes: `CurvePoint` from `src/rankrot/signals.js`, `ArcSpan` from types, `SilenceRegion { start; end }` from `src/analysis/audioEnergy.js`.
- Produces:
  - `EvidenceInput { window: ArcSpan; rms: CurvePoint[]; motion: CurvePoint[]; silences?: SilenceRegion[]; facesPerSec?: CurvePoint[] }` (all curves source-absolute)
  - `downsampleCurve(points: CurvePoint[], span: ArcSpan, stepSec = 2): CurvePoint[]` (mean of points per step bucket)
  - `buildEvidenceBlock(e: EvidenceInput): string` — ≤ `MAX_EVIDENCE_LINES = 40` lines, values rounded to 1 decimal.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/analysis/arcEvidence.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_LINES, buildEvidenceBlock, downsampleCurve } from '../../src/analysis/arcEvidence.js';

const ramp = (n: number, dt: number) => Array.from({ length: n }, (_, i) => ({ time: i * dt, v: i }));

describe('downsampleCurve', () => {
  it('buckets to stepSec means within the span only', () => {
    const out = downsampleCurve(ramp(100, 0.5), { start: 10, end: 20 }, 2); // times 10..20
    expect(out).toHaveLength(5);
    expect(out[0].time).toBe(10);
    expect(out[0].v).toBeCloseTo((20 + 21 + 22 + 23) / 4); // points at 10,10.5,11,11.5 → v=20..23
  });
  it('empty span or no points → []', () => {
    expect(downsampleCurve([], { start: 0, end: 10 })).toEqual([]);
  });
});

describe('buildEvidenceBlock', () => {
  it('mentions rms, motion, silences, faces and stays under the line cap', () => {
    const block = buildEvidenceBlock({
      window: { start: 0, end: 600 },
      rms: ramp(1200, 0.5), motion: ramp(4800, 0.125),
      silences: [{ start: 5, end: 8 }],
      facesPerSec: ramp(600, 1),
    });
    expect(block).toMatch(/audio rms/i);
    expect(block).toMatch(/motion/i);
    expect(block).toMatch(/silence 5\.0-8\.0/i);
    expect(block).toMatch(/faces/i);
    expect(block.split('\n').length).toBeLessThanOrEqual(MAX_EVIDENCE_LINES);
    expect(block).not.toMatch(/\d\.\d{2,}/); // 1-decimal rounding everywhere
  });
  it('omits sections that have no data', () => {
    const block = buildEvidenceBlock({ window: { start: 0, end: 30 }, rms: [], motion: [] });
    expect(block).not.toMatch(/silence/i);
    expect(block).not.toMatch(/faces/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analysis/arcEvidence.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/analysis/arcEvidence.ts
/**
 * PURE: compact numeric evidence block for arc prompts — RMS/motion curves
 * (downsampled), silence gaps, face counts. Capped at MAX_EVIDENCE_LINES so
 * long windows can't blow up the prompt.
 */
import type { CurvePoint } from '../rankrot/signals.js';
import type { SilenceRegion } from './audioEnergy.js';
import type { ArcSpan } from '../types/index.js';

export const MAX_EVIDENCE_LINES = 40;

export function downsampleCurve(points: CurvePoint[], span: ArcSpan, stepSec = 2): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let t = span.start; t < span.end; t += stepSec) {
    const bucket = points.filter((p) => p.time >= t && p.time < t + stepSec);
    if (bucket.length > 0) out.push({ time: t, v: bucket.reduce((a, p) => a + p.v, 0) / bucket.length });
  }
  return out;
}

const fmtCurve = (label: string, pts: CurvePoint[]): string[] => (pts.length === 0 ? [] : [
  `${label} (time:value):`,
  pts.map((p) => `${p.time.toFixed(1)}:${p.v.toFixed(1)}`).join(' '),
]);

export interface EvidenceInput {
  window: ArcSpan;
  rms: CurvePoint[];
  motion: CurvePoint[];
  silences?: SilenceRegion[];
  facesPerSec?: CurvePoint[];
}

export function buildEvidenceBlock(e: EvidenceInput): string {
  // Widen the step until each curve fits in one long line and the block stays capped.
  const span = e.window;
  const step = Math.max(2, Math.ceil((span.end - span.start) / 30 / 2) * 2);
  const lines: string[] = [
    `window ${span.start.toFixed(1)}-${span.end.toFixed(1)}s`,
    ...fmtCurve('audio rms', downsampleCurve(e.rms, span, step)),
    ...fmtCurve('motion', downsampleCurve(e.motion, span, step)),
  ];
  const sil = (e.silences ?? []).filter((s) => s.end > span.start && s.start < span.end);
  if (sil.length > 0) lines.push(`silences: ${sil.map((s) => `silence ${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', ')}`);
  const faces = downsampleCurve(e.facesPerSec ?? [], span, step);
  if (faces.length > 0) lines.push(...fmtCurve('faces on screen', faces));
  return lines.slice(0, MAX_EVIDENCE_LINES).join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analysis/arcEvidence.test.ts` — Expected: PASS. If the bucket-mean assertion disagrees with your rounding, fix the test's arithmetic comment, not the rounding.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/arcEvidence.ts tests/analysis/arcEvidence.test.ts
git commit -m "feat(arc): evidence block builder — rms/motion/silence/face summary for arc prompts"
```

---

### Task 5: Vision-capable JSON helper (`askVisionJson`)

**Files:**
- Modify: `src/broll/llmJson.ts`
- Test: `tests/broll/llmJson.test.ts` (extend the existing file if present, else create)

**Interfaces:**
- Consumes: existing `AskJsonOpts`, `stripFences`, `askJson` internals; `pickSemanticProvider` from `src/analysis/semanticEngine.js`.
- Produces:
  - `VisionImage { data: Buffer; mimeType: 'image/jpeg' }`
  - `AskVisionOpts extends AskJsonOpts { images?: VisionImage[] }`
  - `AskVisionFn = (opts: AskVisionOpts, env?: NodeJS.ProcessEnv) => Promise<unknown | null>`
  - `toGeminiParts(opts: AskVisionOpts): unknown[]` (PURE) — `[{ inlineData: { data: base64, mimeType } }..., promptText]`
  - `toClaudeContent(opts: AskVisionOpts): unknown[]` (PURE) — `[{ type: 'image', source: { type: 'base64', media_type, data } }..., { type: 'text', text }]`
  - `askVisionJson(opts, env = process.env): Promise<unknown | null>` — routes by `pickSemanticProvider(env)`: `'claude'` → Claude (Gemini fallback on failure, mirroring `askJson`), `'gemini'` → Gemini only, `'none'` → warn + null. Never throws.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/broll/llmJson.test.ts (add to existing describe blocks if the file exists)
import { describe, expect, it } from 'vitest';
import { toClaudeContent, toGeminiParts, askVisionJson } from '../../src/broll/llmJson.js';

const img = { data: Buffer.from('jpegbytes'), mimeType: 'image/jpeg' as const };
const opts = { system: 'sys', prompt: 'find arcs', schema: {}, label: 'test', images: [img] };

describe('toGeminiParts', () => {
  it('images as inlineData base64 first, prompt text last', () => {
    const parts = toGeminiParts(opts) as any[];
    expect(parts[0].inlineData.data).toBe(img.data.toString('base64'));
    expect(parts[0].inlineData.mimeType).toBe('image/jpeg');
    expect(parts[parts.length - 1]).toContain('find arcs');
  });
  it('no images → just the prompt', () => {
    expect(toGeminiParts({ ...opts, images: [] })).toHaveLength(1);
  });
});

describe('toClaudeContent', () => {
  it('image blocks then one text block', () => {
    const blocks = toClaudeContent(opts) as any[];
    expect(blocks[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(blocks[1]).toMatchObject({ type: 'text' });
  });
});

describe('askVisionJson', () => {
  it('returns null with a warning when no provider is configured', async () => {
    expect(await askVisionJson(opts, { SEMANTIC_PROVIDER: 'none' } as any)).toBeNull();
    expect(await askVisionJson(opts, {} as any)).toBeNull(); // no keys at all
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/broll/llmJson.test.ts` — Expected: FAIL (`toGeminiParts` not exported).

- [ ] **Step 3: Implement**

Add to `src/broll/llmJson.ts` (import `pickSemanticProvider` from `../analysis/semanticEngine.js` — check its exact export there first):

```ts
export interface VisionImage { data: Buffer; mimeType: 'image/jpeg'; }
export interface AskVisionOpts extends AskJsonOpts { images?: VisionImage[]; }
export type AskVisionFn = (opts: AskVisionOpts, env?: NodeJS.ProcessEnv) => Promise<unknown | null>;

/** PURE: Gemini generateContent parts — inline base64 images then the prompt. */
export function toGeminiParts(opts: AskVisionOpts): unknown[] {
  const images = (opts.images ?? []).map((i) => ({
    inlineData: { data: i.data.toString('base64'), mimeType: i.mimeType },
  }));
  return [...images, `${opts.prompt}\n\nReturn ONLY valid JSON, no markdown.`];
}

/** PURE: Claude message content — image blocks then one text block. */
export function toClaudeContent(opts: AskVisionOpts): unknown[] {
  const images = (opts.images ?? []).map((i) => ({
    type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data.toString('base64') },
  }));
  return [...images, { type: 'text', text: opts.prompt }];
}

/**
 * Vision-capable JSON ask. Provider = the semantic layer's routing
 * (SEMANTIC_PROVIDER honored): claude → Claude w/ Gemini fallback, gemini →
 * Gemini only, none → null. Gemini-first mandate: everything here must work
 * with only GEMINI_API_KEYS set.
 */
export async function askVisionJson(opts: AskVisionOpts, env: NodeJS.ProcessEnv = process.env): Promise<unknown | null> {
  const provider = pickSemanticProvider(env);
  if (provider === 'none') {
    logger.warn(`[${opts.label}] no LLM provider — skipping`);
    return null;
  }
  if (provider === 'claude') {
    const viaClaude = await askClaudeVision(opts, env);
    if (viaClaude !== null) return viaClaude;
  }
  const keys = loadGeminiKeys(env);
  if (keys.length > 0) return askGeminiVision(opts, keys[0], env);
  logger.warn(`[${opts.label}] provider ${provider} unavailable and no Gemini fallback`);
  return null;
}
```

`askClaudeVision` / `askGeminiVision`: copy the bodies of the existing `askClaude` / `askGemini` and swap the message content for `toClaudeContent(opts)` / `toGeminiParts(opts)` (Claude: `messages: [{ role: 'user', content: toClaudeContent(opts) as Anthropic.ContentBlockParam[] }]`; Gemini: `model.generateContent(toGeminiParts(opts) as Part[])` — cast to the SDK's `Part[]`). Keep the same `withRetry` / fence-strip / catch-and-warn behavior. If `pickSemanticProvider`'s return type differs from `'claude'|'gemini'|'none'`, adapt to its actual union — read `src/analysis/semanticEngine.ts` first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/broll/llmJson.test.ts` and `npx tsc --noEmit` — Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/broll/llmJson.ts tests/broll/llmJson.test.ts
git commit -m "feat(arc): askVisionJson — dual-provider vision JSON with Gemini-first routing"
```

---

### Task 6: Arc miner (per-chunk mining, cache, candidate merge)

**Files:**
- Create: `src/analysis/arcMiner.ts`
- Test: `tests/analysis/arcMiner.test.ts`

**Interfaces:**
- Consumes: `TranscriptChunk`/`chunkTranscript` (Task 2), `validateArc`/`arcScore`/`arcOuterSpan` (Task 1), `AskVisionFn`/`askVisionJson` (Task 5), `ClipCandidate`, `ContentMode`.
- Produces:
  - `mineArcs(chunks: TranscriptChunk[], evidenceFor: (c: TranscriptChunk) => string, opts: { cachePath: string; durationSec: number; mode: ContentMode; ask?: AskVisionFn }): Promise<ArcLabel[]>` — one call per chunk, per-chunk incremental cache `{ chunks: Record<'start-end', ArcLabel[]> }`, failed chunk → `[]` for that chunk (logged, not cached, so a re-run retries it).
  - `miningPrompt(chunk: TranscriptChunk, evidence: string, mode: ContentMode): string`
  - `overlapFraction(a: ArcSpan, b: ArcSpan): number` — overlap / min(len a, len b)
  - `mergeMinedCandidates(existing: ClipCandidate[], arcs: ArcLabel[]): ClipCandidate[]` — arc with ≥0.5 overlapFraction against an existing candidate → that candidate gains `arc` (keeps its scores; higher-arcScore label wins if it already has one); otherwise a new candidate `{ start, end (outer span), composite: 10 * arcScore(arc), triggerScore: 0, audioScore: 0, arc }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/analysis/arcMiner.test.ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mergeMinedCandidates, mineArcs, miningPrompt, overlapFraction } from '../../src/analysis/arcMiner.js';
import type { ArcLabel, ClipCandidate, TranscriptSegment } from '../../src/types/index.js';
import type { TranscriptChunk } from '../../src/analysis/arcChunker.js';

const seg = (start: number, end: number): TranscriptSegment => ({ start, end, text: `t${start}` });
const chunk: TranscriptChunk = { start: 0, end: 540, segments: [seg(0, 10), seg(10, 20)] };
const fullComponents = {
  setup: { start: 10, end: 13 }, trigger: { start: 12, end: 13 }, escalation: { start: 13, end: 16 },
  peak: { start: 16, end: 18 }, payoff: { start: 18, end: 21 }, reaction: { start: 21, end: 25 },
};
const goodArcRaw = { synopsis: 'fail then scream', confidence: 0.9, components: fullComponents, reactionAfterPeak: true };

describe('miningPrompt', () => {
  it('carries transcript, evidence, mode vocabulary, and the brief/overlapping rule', () => {
    const p = miningPrompt(chunk, 'EVIDENCE', 'clippies');
    expect(p).toContain('t0');
    expect(p).toContain('EVIDENCE');
    expect(p).toMatch(/fail/i);            // clippies vocabulary
    expect(p).toMatch(/overlap/i);         // brief-or-overlapping rule stated
    const p2 = miningPrompt(chunk, 'E', 'mindcuts');
    expect(p2).toMatch(/insight/i);        // mindcuts vocabulary
  });
});

describe('mineArcs', () => {
  it('asks once per chunk, validates, caches incrementally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arcs-'));
    const cachePath = join(dir, 'layer_arcs_gemini.json');
    const ask = vi.fn().mockResolvedValue({ arcs: [goodArcRaw, { junk: true }] });
    const arcs = await mineArcs([chunk], () => 'E', { cachePath, durationSec: 600, mode: 'clippies', ask });
    expect(arcs).toHaveLength(1);
    expect(arcs[0].confidence).toBe(0.9);
    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    expect(cached.chunks['0-540']).toHaveLength(1);
    // second run: cache hit, no ask
    const ask2 = vi.fn();
    const again = await mineArcs([chunk], () => 'E', { cachePath, durationSec: 600, mode: 'clippies', ask: ask2 });
    expect(again).toHaveLength(1);
    expect(ask2).not.toHaveBeenCalled();
  });
  it('failed chunk yields no arcs and is NOT cached (retryable)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arcs-'));
    const cachePath = join(dir, 'layer_arcs_gemini.json');
    const ask = vi.fn().mockResolvedValue(null);
    expect(await mineArcs([chunk], () => 'E', { cachePath, durationSec: 600, mode: 'clippies', ask })).toEqual([]);
    const cached = JSON.parse(await readFile(cachePath, 'utf8').catch(() => '{"chunks":{}}'));
    expect(cached.chunks['0-540']).toBeUndefined();
  });
});

describe('overlapFraction / mergeMinedCandidates', () => {
  const cand: ClipCandidate = { start: 10, end: 25, composite: 6, triggerScore: 3, audioScore: 3 };
  const arc: ArcLabel = { synopsis: 's', confidence: 0.9, components: fullComponents, reactionAfterPeak: true };
  it('overlapFraction uses the smaller span as denominator', () => {
    expect(overlapFraction({ start: 0, end: 10 }, { start: 5, end: 25 })).toBe(0.5);
  });
  it('≥50% overlap → existing candidate gains the label and keeps its composite', () => {
    const out = mergeMinedCandidates([cand], [arc]);
    expect(out).toHaveLength(1);
    expect(out[0].composite).toBe(6);
    expect(out[0].arc?.synopsis).toBe('s');
  });
  it('disjoint arc becomes a new candidate with composite = 10×arcScore', () => {
    const far: ArcLabel = { ...arc, components: { ...fullComponents, setup: { start: 100, end: 103 }, reaction: { start: 110, end: 115 }, trigger: { start: 101, end: 102 }, escalation: { start: 103, end: 105 }, peak: { start: 105, end: 107 }, payoff: { start: 107, end: 110 } } };
    const out = mergeMinedCandidates([cand], [far]);
    expect(out).toHaveLength(2);
    const mined = out.find((c) => c.start === 100)!;
    expect(mined.composite).toBeCloseTo(10 * Math.min(1, 0.9 * 1.15));
    expect(mined.end).toBe(115);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analysis/arcMiner.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/analysis/arcMiner.ts
/**
 * Arc mining (recall pass) — one LLM call per transcript chunk returns complete
 * micro-stories; validated labels merge into the scorer's candidate pool.
 * Cache: layer_arcs_<provider>.json, per-chunk incremental (failed chunks are
 * NOT cached so a re-run retries them).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { askVisionJson, type AskVisionFn } from '../broll/llmJson.js';
import { arcOuterSpan, arcScore, validateArc } from './arcTypes.js';
import type { TranscriptChunk } from './arcChunker.js';
import type { ArcLabel, ArcSpan, ClipCandidate, ContentMode } from '../types/index.js';
import { logger } from '../utils/logger.js';

const MODE_VOCAB: Record<ContentMode, string> = {
  clippies: 'challenge setup, joke setup, fail setup, rage escalation, scream/reaction payoff. Never isolate a scream — the story is: sees challenge → tries → fails → reacts.',
  mindcuts: 'hook, explanation, escalation, insight/payoff. Never a quote without its story: the arc is struggle → turn → insight.',
};

const ARC_SCHEMA = {
  type: 'object',
  properties: {
    arcs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          synopsis: { type: 'string' },
          confidence: { type: 'number' },
          reactionAfterPeak: { type: 'boolean' },
          components: {
            type: 'object',
            properties: Object.fromEntries(['setup', 'trigger', 'escalation', 'peak', 'payoff', 'reaction'].map((k) => [
              k, { type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' } }, required: ['start', 'end'] },
            ])),
            required: ['setup', 'trigger', 'escalation', 'peak', 'payoff', 'reaction'],
          },
        },
        required: ['synopsis', 'confidence', 'components'],
      },
    },
  },
  required: ['arcs'],
} as const;

/** PURE: the mining prompt for one chunk. */
export function miningPrompt(chunk: TranscriptChunk, evidence: string, mode: ContentMode): string {
  const transcript = chunk.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  return [
    `Find 0-4 COMPLETE micro-stories in this ${mode} source segment.`,
    'A micro-story has ALL SIX components: setup, trigger, escalation, peak, payoff, reaction.',
    'Components may be brief (>=0.5s) or overlap/nest (a trigger inside setup, escalation coinciding with peak) — identify all six or omit the story.',
    `Mode vocabulary: ${MODE_VOCAB[mode]}`,
    'Times are source-absolute seconds. Set reactionAfterPeak true when a clear reaction FOLLOWS the peak (weight those stories higher).',
    '', 'TRANSCRIPT:', transcript, '', 'SIGNAL EVIDENCE:', evidence,
  ].join('\n');
}

/** PURE: overlap seconds / the smaller span's length. */
export function overlapFraction(a: ArcSpan, b: ArcSpan): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const minLen = Math.min(a.end - a.start, b.end - b.start);
  return minLen > 0 ? overlap / minLen : 0;
}

interface ArcCache { chunks: Record<string, ArcLabel[]>; }

async function loadCache(path: string): Promise<ArcCache> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    if (j && typeof j.chunks === 'object') return j as ArcCache;
  } catch { /* cold */ }
  return { chunks: {} };
}

export interface MineOpts {
  cachePath: string;
  durationSec: number;
  mode: ContentMode;
  ask?: AskVisionFn;                 // test seam; default askVisionJson (text-only here)
}

export async function mineArcs(
  chunks: TranscriptChunk[], evidenceFor: (c: TranscriptChunk) => string, opts: MineOpts,
): Promise<ArcLabel[]> {
  const ask = opts.ask ?? askVisionJson;
  const cache = await loadCache(opts.cachePath);
  const out: ArcLabel[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.start}-${chunk.end}`;
    let labels = cache.chunks[key];
    if (!labels) {
      const raw = await ask({
        system: 'You are a top YouTube Shorts story editor. You find complete micro-stories, never isolated moments.',
        prompt: miningPrompt(chunk, evidenceFor(chunk), opts.mode),
        schema: ARC_SCHEMA as unknown as Record<string, unknown>,
        label: `arc-mine ${key}`,
      });
      const arr = Array.isArray((raw as { arcs?: unknown[] })?.arcs) ? (raw as { arcs: unknown[] }).arcs : null;
      if (arr === null) {
        logger.warn(`[arc-mine ${key}] chunk failed — no arcs from this chunk (will retry next run)`);
        continue;                                    // NOT cached → retryable
      }
      labels = arr.map((a) => validateArc(a, opts.durationSec)).filter((a): a is ArcLabel => a !== null);
      cache.chunks[key] = labels;
      await mkdir(dirname(opts.cachePath), { recursive: true });
      await writeFile(opts.cachePath, JSON.stringify(cache, null, 2));  // incremental
    }
    out.push(...labels);
  }
  return out;
}

/** PURE: fold mined arcs into the candidate pool (spec §3 dedupe rule). */
export function mergeMinedCandidates(existing: ClipCandidate[], arcs: ArcLabel[]): ClipCandidate[] {
  const out = existing.map((c) => ({ ...c }));
  for (const arc of arcs) {
    const span = arcOuterSpan(arc.components);
    if (!span) continue;
    const host = out.find((c) => overlapFraction({ start: c.start, end: c.end }, span) >= 0.5);
    if (host) {
      if (!host.arc || arcScore(arc) > arcScore(host.arc)) host.arc = arc;
    } else {
      out.push({ start: span.start, end: span.end, composite: 10 * arcScore(arc), triggerScore: 0, audioScore: 0, arc });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analysis/arcMiner.test.ts` — Expected: PASS. (`ContentMode` union: if it lives elsewhere than `types/index.ts`, import from `src/modes.ts` — check.)

- [ ] **Step 5: Commit**

```bash
git add src/analysis/arcMiner.ts tests/analysis/arcMiner.test.ts
git commit -m "feat(arc): mining pass — per-chunk micro-story extraction with incremental cache + candidate merge"
```

---

### Task 7: Ranker arc weight (stage 1)

**Files:**
- Modify: `src/clipDetection/ranker.ts`
- Test: `tests/clipDetection/ranker.test.ts` (extend existing)

**Interfaces:**
- Consumes: `arcScore` (Task 1), `ClipCandidate.arc` (Task 1).
- Produces: `arcWeightedComposite(composite: number, arc?: ArcLabel): number` = `arc ? 0.75*composite + 0.25*(10*arcScore(arc)) : 0.75*composite` (PURE, exported). Inside `rank()`: the **min-score filter stays on raw composite** (so `defaultMinScore` semantics don't shift), sorting and the reported `composite_score` use the arc-weighted value plus the existing `priorityBoost`. `RankedClip.arc` is carried through from the candidate.

**Why this exact formula:** renormalized 0.75/0.25 weights per spec §5. Multiplying all non-arc candidates by 0.75 is order-preserving among themselves, so existing behavior only changes when arcs exist. A mined-only candidate (raw composite = 10×arcScore) gets effective 10×arcScore — consistent scale.

- [ ] **Step 1: Write the failing tests** (append to `tests/clipDetection/ranker.test.ts`; reuse its existing fixture helpers — read the file first and follow its candidate/segment builders; remember ranker dedup needs disjoint segment text across candidates)

```ts
// append to tests/clipDetection/ranker.test.ts
import { arcWeightedComposite } from '../../src/clipDetection/ranker.js';
// build fullComponents fixture as in arcMiner tests (all six spans present)

describe('arcWeightedComposite', () => {
  it('no arc → 0.75×composite; full-confidence arc dominates', () => {
    expect(arcWeightedComposite(8)).toBeCloseTo(6);
    const arc = { synopsis: 's', confidence: 1, components: fullComponents };
    expect(arcWeightedComposite(8, arc)).toBeCloseTo(0.75 * 8 + 0.25 * 10);
  });
});

describe('rank with arcs', () => {
  it('an arc-labeled candidate outranks an equal-composite bare candidate and carries arc onto RankedClip', () => {
    // two candidates, same composite, DISJOINT transcript text; one has a full arc
    // expect ranked[0] to be the arc one, and ranked[0].arc to be defined
  });
  it('min-score filter still uses the RAW composite', () => {
    // candidate with raw composite above min but arc-weighted value below it must SURVIVE
  });
});
```

Write those two `rank` tests fully using the file's existing fixture style — the assertions above are the contract; the fixtures must be real code in the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/clipDetection/ranker.test.ts` — Expected: FAIL (`arcWeightedComposite` not exported).

- [ ] **Step 3: Implement**

In `src/clipDetection/ranker.ts`:

```ts
import { arcScore } from '../analysis/arcTypes.js';
import type { ArcLabel } from '../types/index.js';

/** PURE: spec §5 — arcScore joins the composite at weight 0.25, renormalized.
 *  Min-score filtering stays on the RAW composite; this shapes ordering + the
 *  reported score only. */
export function arcWeightedComposite(composite: number, arc?: ArcLabel): number {
  return 0.75 * composite + 0.25 * (arc ? 10 * arcScore(arc) : 0);
}
```

In `rank()`: keep `.filter((c) => c.composite >= min)` as-is; change the map to
`adjusted: arcWeightedComposite(cand.composite, cand.arc) + priorityBoost(sw, opts.priorities)`;
in the final `RankedClip` build, set `composite_score: +(arcWeightedComposite(cand.composite, cand.arc)).toFixed(2)` (find where `composite_score` is currently assigned — keep its rounding style) and add `...(cand.arc ? { arc: cand.arc } : {})`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/clipDetection/` — Expected: PASS, including all pre-existing ranker tests. If a pre-existing test asserts an exact `composite_score` value, update the expected number to the ×0.75 value and note it in the commit body — the ordering assertions must NOT need changes.

- [ ] **Step 5: Commit**

```bash
git add src/clipDetection/ranker.ts tests/clipDetection/ranker.test.ts
git commit -m "feat(arc): arcScore joins ranker composite at 0.25 (renormalized, raw-composite threshold preserved)"
```

---

### Task 8: Keyframe extraction

**Files:**
- Create: `src/analysis/keyframes.ts`
- Test: `tests/analysis/keyframes.test.ts`

**Interfaces:**
- Consumes: the ffmpeg runner used by `src/export/thumbnail.ts` (read it; reuse the same util from `src/utils/ffmpeg.ts`/`cmd.ts`), `VisionImage` (Task 5), `CurvePoint`.
- Produces:
  - `keyframeTimes(span: ArcSpan, rmsPeakT: number | null, motionPeakT: number | null): number[]` (PURE) — candidates: `start+0.3`, `midpoint`, `end−0.3`, plus the two peaks when inside the span; clamp into span, dedupe within 0.75s, sort ascending, 4–6 results (pad with quartile points when fewer than 4 distinct).
  - `peakTime(points: CurvePoint[], span: ArcSpan): number | null` (PURE) — time of max v within span.
  - `extractKeyframes(videoPath: string, times: number[], tmpDir: string): Promise<VisionImage[]>` — **one temp JPEG file per time** (`kf_<i>.jpg`, `-ss <t> -i <video> -frames:v 1 -vf scale=512:-2 -q:v 5`), then `readFile` each. NEVER capture image bytes from stdout (house gotcha). A failed frame is skipped with a warn; returns the frames that worked.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/analysis/keyframes.test.ts
import { describe, expect, it } from 'vitest';
import { keyframeTimes, peakTime } from '../../src/analysis/keyframes.js';

describe('peakTime', () => {
  it('max within span; null when empty', () => {
    const pts = [{ time: 1, v: 1 }, { time: 5, v: 9 }, { time: 9, v: 2 }];
    expect(peakTime(pts, { start: 0, end: 10 })).toBe(5);
    expect(peakTime(pts, { start: 6, end: 10 })).toBe(9);
    expect(peakTime([], { start: 0, end: 10 })).toBeNull();
  });
});

describe('keyframeTimes', () => {
  it('4-6 sorted unique times inside the span', () => {
    const times = keyframeTimes({ start: 10, end: 30 }, 18, 26);
    expect(times.length).toBeGreaterThanOrEqual(4);
    expect(times.length).toBeLessThanOrEqual(6);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const t of times) { expect(t).toBeGreaterThanOrEqual(10); expect(t).toBeLessThanOrEqual(30); }
  });
  it('dedupes near-identical times (peak == midpoint) and still returns >=4', () => {
    const times = keyframeTimes({ start: 0, end: 20 }, 10, 10.2);
    expect(new Set(times.map((t) => Math.round(t / 0.75))).size).toBe(times.length);
    expect(times.length).toBeGreaterThanOrEqual(4);
  });
  it('null peaks → still 4 structural frames', () => {
    expect(keyframeTimes({ start: 0, end: 12 }, null, null).length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analysis/keyframes.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/analysis/keyframes.ts
/**
 * Keyframes for the arc-completion vision call — a handful of ≤512px JPEGs at
 * structurally interesting times. Frames ALWAYS go through temp files
 * (house gotcha: spawned-process stdout corrupts binary).
 */
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CurvePoint } from '../rankrot/signals.js';
import type { ArcSpan } from '../types/index.js';
import type { VisionImage } from '../broll/llmJson.js';
import { logger } from '../utils/logger.js';
// import the same ffmpeg runner src/export/thumbnail.ts uses — read that file and mirror it.

export function peakTime(points: CurvePoint[], span: ArcSpan): number | null {
  let best: CurvePoint | null = null;
  for (const p of points) {
    if (p.time < span.start || p.time > span.end) continue;
    if (!best || p.v > best.v) best = p;
  }
  return best ? best.time : null;
}

const DEDUPE_SEC = 0.75;

/** PURE: 4-6 sorted unique frame times inside the span. */
export function keyframeTimes(span: ArcSpan, rmsPeakT: number | null, motionPeakT: number | null): number[] {
  const len = span.end - span.start;
  const clamp = (t: number) => Math.min(span.end - 0.1, Math.max(span.start + 0.1, t));
  const raw = [
    span.start + 0.3, span.start + len / 2, span.end - 0.3,
    ...(rmsPeakT !== null ? [rmsPeakT] : []),
    ...(motionPeakT !== null ? [motionPeakT] : []),
    span.start + len / 4, span.start + (3 * len) / 4,          // quartile padding pool
  ].map(clamp).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of raw) {
    if (out.length >= 6) break;
    if (out.every((u) => Math.abs(u - t) >= DEDUPE_SEC)) out.push(t);
  }
  return out.slice(0, 6);
}

export async function extractKeyframes(videoPath: string, times: number[], tmpDir: string): Promise<VisionImage[]> {
  await mkdir(tmpDir, { recursive: true });
  const out: VisionImage[] = [];
  for (const [i, t] of times.entries()) {
    const path = join(tmpDir, `kf_${i}.jpg`);
    try {
      // runFfmpeg(['-ss', String(t), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '5', '-y', path])
      // — use the exact runner thumbnail.ts uses.
      out.push({ data: await readFile(path), mimeType: 'image/jpeg' });
    } catch (e) {
      logger.warn(`keyframe @${t.toFixed(1)}s failed (${e instanceof Error ? e.message : String(e)}) — skipping`);
    }
  }
  return out;
}
```

Replace the runner comment with the real call after reading `src/export/thumbnail.ts:20-30` — same util, same arg style.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analysis/keyframes.test.ts` — Expected: PASS (pure functions only; `extractKeyframes` is exercised by the live smoke in Task 12).

- [ ] **Step 5: Commit**

```bash
git add src/analysis/keyframes.ts tests/analysis/keyframes.test.ts
git commit -m "feat(arc): keyframe times + temp-file JPEG extraction for the vision pass"
```

---

### Task 9: Arc completer (prompt, parse, bounds, gate)

**Files:**
- Create: `src/analysis/arcCompleter.ts`
- Test: `tests/analysis/arcCompleter.test.ts`

**Interfaces:**
- Consumes: `validateArc`/`missingComponents`/`arcOuterSpan`/`arcScore` (Task 1), `AskVisionFn`/`VisionImage` (Task 5), `clampToSentences` + `ClipLengths` from `src/clipDetection/merger.js` (read `merger.ts:63` for the exact signature and mirror `buildClips`' call), `UsedRange` from `src/clipDetection/usedRanges.js`.
- Produces:
  - `ArcCompletion { components: ArcComponents; missing: ArcComponentName[]; bounds: ArcSpan; confidence: number; synopsis: string; reactionAfterPeak: boolean }`
  - `completionPrompt(opts: { window: ArcSpan; contextSegments: TranscriptSegment[]; evidence: string; priorArc?: ArcLabel; mode: ContentMode }): string` — states: identify all six (brief/overlap allowed), propose bounds expanding ≥3s backward to the cause and ≥3s forward to the reaction when context is incomplete ("context > shortness"), times source-absolute; mentions attached frames when present.
  - `parseCompletion(raw: unknown, durationSec: number): ArcCompletion | null` — reuses `validateArc` for the label part; requires numeric `bounds.start/end`; `missing` computed via `missingComponents`, not trusted from the model.
  - `resolveBounds(c: ArcCompletion, ctx: { envelope: ClipLengths; segments: TranscriptSegment[]; used: UsedRange[]; durationSec: number }): { start: number; end: number } | { reject: 'overlap' }` — start = min(bounds.start, outerSpan.start), end = max(bounds.end, outerSpan.end); clamp into [0, durationSec]; used-range collision pulls the colliding edge to the range boundary, and if that cuts into ANY component span → `{ reject: 'overlap' }`; then sentence clamp with the mode envelope.
  - `gateArc(c: ArcCompletion | null): { pass: boolean; missing: string[] }` — null → `{ pass: false, missing: ['arc-label-failed'] }`; else pass ⇔ `c.missing.length === 0` (STRICT 6/6).
  - `completeArc(opts: { window: ArcSpan; segments: TranscriptSegment[]; evidence: string; images: VisionImage[]; priorArc?: ArcLabel; mode: ContentMode; durationSec: number; ask?: AskVisionFn }): Promise<ArcCompletion | null>` — one ask (schema like mining but a single arc + bounds), `parseCompletion` on the result; null on failure (the caller's ladder handles it).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/analysis/arcCompleter.test.ts
import { describe, expect, it, vi } from 'vitest';
import { completeArc, completionPrompt, gateArc, parseCompletion, resolveBounds } from '../../src/analysis/arcCompleter.js';
import type { TranscriptSegment } from '../../src/types/index.js';
import { DEFAULT_LENGTHS } from '../../src/clipDetection/merger.js';

const seg = (start: number, end: number, text = ''): TranscriptSegment => ({ start, end, text: text || `t${start}.` });
const fullComponents = {
  setup: { start: 20, end: 24 }, trigger: { start: 23, end: 24 }, escalation: { start: 24, end: 28 },
  peak: { start: 28, end: 30 }, payoff: { start: 30, end: 33 }, reaction: { start: 33, end: 38 },
};
const rawCompletion = {
  synopsis: 's', confidence: 0.85, components: fullComponents,
  reactionAfterPeak: true, bounds: { start: 18, end: 40 },
};

describe('completionPrompt', () => {
  it('carries context, evidence, expansion rule, and frame note when images exist', () => {
    const p = completionPrompt({ window: { start: 22, end: 34 }, contextSegments: [seg(20, 25)], evidence: 'EV', mode: 'clippies' });
    expect(p).toContain('EV');
    expect(p).toMatch(/3 ?s/);           // ≥3s expansion rule stated
    expect(p).toMatch(/context/i);
  });
});

describe('parseCompletion', () => {
  it('valid completion parses; missing computed from components not trusted', () => {
    const c = parseCompletion(rawCompletion, 100)!;
    expect(c.missing).toEqual([]);
    expect(c.bounds).toEqual({ start: 18, end: 40 });
    const { payoff, ...five } = fullComponents;
    expect(parseCompletion({ ...rawCompletion, components: five, missing: [] }, 100)!.missing).toEqual(['payoff']);
  });
  it('no bounds or garbage → null', () => {
    expect(parseCompletion({ ...rawCompletion, bounds: null }, 100)).toBeNull();
    expect(parseCompletion('x', 100)).toBeNull();
  });
});

describe('resolveBounds', () => {
  const segments = Array.from({ length: 30 }, (_, i) => seg(i * 4, i * 4 + 4, `sentence ${i}.`));
  const ctx = { envelope: DEFAULT_LENGTHS, segments, used: [], durationSec: 200 };
  it('covers the outer span and both proposed expansions', () => {
    const r = resolveBounds(parseCompletion(rawCompletion, 200)!, ctx);
    expect('reject' in r).toBe(false);
    const b = r as { start: number; end: number };
    expect(b.start).toBeLessThanOrEqual(18);
    expect(b.end).toBeGreaterThanOrEqual(38);      // sentence clamp may extend past 40
  });
  it('used-range collision pulls the edge back; cutting a component → reject overlap', () => {
    const pulled = resolveBounds(parseCompletion(rawCompletion, 200)!, { ...ctx, used: [{ start: 10, end: 19, clip_id: 'x', exportedAt: '' }] });
    expect('reject' in pulled).toBe(false);
    expect((pulled as { start: number }).start).toBeGreaterThanOrEqual(19);
    const rejected = resolveBounds(parseCompletion(rawCompletion, 200)!, { ...ctx, used: [{ start: 10, end: 26, clip_id: 'x', exportedAt: '' }] });
    expect(rejected).toEqual({ reject: 'overlap' });   // 26 cuts into setup/escalation
  });
});

describe('gateArc', () => {
  it('strict 6/6: pass only with zero missing; null → arc-label-failed', () => {
    expect(gateArc(parseCompletion(rawCompletion, 100)).pass).toBe(true);
    const { trigger, ...five } = fullComponents;
    expect(gateArc(parseCompletion({ ...rawCompletion, components: five }, 100))).toEqual({ pass: false, missing: ['trigger'] });
    expect(gateArc(null)).toEqual({ pass: false, missing: ['arc-label-failed'] });
  });
});

describe('completeArc', () => {
  it('asks once and parses; ask failure → null', async () => {
    const ask = vi.fn().mockResolvedValue(rawCompletion);
    const c = await completeArc({ window: { start: 22, end: 34 }, segments: [seg(20, 25)], evidence: 'E', images: [], mode: 'clippies', durationSec: 100, ask });
    expect(c?.synopsis).toBe('s');
    expect(ask).toHaveBeenCalledOnce();
    const askFail = vi.fn().mockResolvedValue(null);
    expect(await completeArc({ window: { start: 22, end: 34 }, segments: [], evidence: 'E', images: [], mode: 'clippies', durationSec: 100, ask: askFail })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analysis/arcCompleter.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Write `src/analysis/arcCompleter.ts` to the interfaces above. Implementation notes (all decisions, no freedom needed):

- `completionPrompt`: same structure as `miningPrompt` (transcript lines `[start-end] text` from `contextSegments`, which the caller slices to window ±60s) + the six-component instruction + `Propose bounds: expand backward at least 3s to include the cause/setup and forward at least 3s to include the result/reaction when the story is incomplete. Context beats shortness.` + when `priorArc` exists include `A previous pass suggested: <JSON of priorArc.components>` + when the ask will attach images note `Frames from the clip are attached in time order — use them to see silent/visual action.`
- `parseCompletion`: `validateArc(raw, durationSec)` for the label part; additionally require `bounds` with numeric start/end, `bounds.end > bounds.start`; return `{ ...label fields, bounds, missing: missingComponents(label.components), reactionAfterPeak: label.reactionAfterPeak ?? false }`.
- `resolveBounds` order of operations: (1) outer = `arcOuterSpan(c.components)` (parse guarantees ≥1 component; treat null as reject-worthy by returning `{ reject: 'overlap' }` defensively), (2) `start = clamp(min(c.bounds.start, outer.start), 0)`, `end = clamp(max(c.bounds.end, outer.end), durationSec)`, (3) for each used range overlapping `[start,end)`: if `u.end <= outer.start` → `start = max(start, u.end)`; else if `u.start >= outer.end` → `end = min(end, u.start)`; else return `{ reject: 'overlap' }`; after pulling, if `start > outer.start` or `end < outer.end` (a component got cut) → reject, (4) sentence clamp: call `clampToSentences` exactly as `buildClips` does with `ctx.envelope` (read `merger.ts` first; if it isn't exported, export it — it's already a top-level pure function).
- `gateArc` and `completeArc`: exactly as the tests demand; `completeArc` builds the ask opts with a single-arc schema (`{ synopsis, confidence, reactionAfterPeak, components{...6 required}, bounds{start,end} }`, all of `synopsis/confidence/components/bounds` required) and passes `opts.images` through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analysis/arcCompleter.test.ts` — Expected: PASS. Also `npx vitest run tests/clipDetection/` (merger untouched or export-only change) — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/arcCompleter.ts tests/analysis/arcCompleter.test.ts src/clipDetection/merger.ts
git commit -m "feat(arc): completion pass — six-component labeling, bounds resolution, strict 6/6 gate"
```

---

### Task 10: Pipeline wiring (`all.ts` + CLI flags)

**Files:**
- Modify: `src/cli/commands/all.ts` (both `analyzeVideo` — the function containing `buildClips` at ~line 202 — and `rankAndExport` at ~line 249)
- Modify: `src/cli/index.ts` (flags on `all`, `process`, `batch` — wherever `AllOpts` is populated)
- Test: `tests/cli/arcPipeline.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces:
  - `AllOpts` gains `arcTopk?: number` and `lenient?: boolean`.
  - `VideoAnalysis` gains `motion?: CurvePoint[]` (add to the type where it's declared in `src/types/index.ts`).
  - Exported PURE helper in `all.ts`: `applyCompletionToClip(clip: RankedClip, completion: ArcCompletion, bounds: { start: number; end: number }): RankedClip` — returns a copy with `start`/`end`/`duration` updated, `composite_score = +(arcWeightedComposite(rawFromClip, completionAsArcLabel)).toFixed(2)` where `completionAsArcLabel = { synopsis, confidence, components, reactionAfterPeak }`, and `arc` set to that label. (Recover the raw composite as `clip.composite_score / 0.75` when `clip.arc` is undefined, else recompute from the stored candidate — simplest correct route: also thread the raw composite through `SourcedRankedClip`; pick one and document it in code.)
  - Exported PURE helper: `arcRejectionRow(clip: RankedClip, missing: string[], reason: string): ArcRejection` with `ArcRejection { clip_id: string; start: number; end: number; missing: string[]; reason: string }` (type exported from `all.ts`, consumed by Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/arcPipeline.test.ts — completion/gate stage in isolation via the exported helper
import { describe, expect, it } from 'vitest';
import { applyCompletionToClip } from '../../src/cli/commands/all.js';
// build a RankedClip fixture (copy the shape from tests/cli/buildPins.test.ts or types) and
// an ArcCompletion fixture with fullComponents (as in arcCompleter tests).

describe('applyCompletionToClip', () => {
  it('updates start/end/duration, sets arc, and re-scores with the completion label', () => {
    // clip: start 22, end 34, composite_score 6 (raw 8 × 0.75, no prior arc)
    // completion bounds resolved to { start: 18, end: 40 }
    // expect: start 18, end 40, duration 22, arc.synopsis set,
    // composite_score ≈ 0.75×8 + 0.25×10×arcScore(label)
  });
});
```

Write the fixtures fully — the shape of `RankedClip` is in `src/types/index.ts:23`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/arcPipeline.test.ts` — Expected: FAIL (helper not exported).

- [ ] **Step 3: Implement the wiring**

**(a) `analyzeVideo`** — after `const candidates = buildClips(...)` and before the return:

```ts
let arcCandidates = candidates;
let motion: CurvePoint[] = [];
if (chosen !== 'none') {
  sp = ora('Mining micro-story arcs…').start();
  try {
    motion = await motionLayer(dl.videoPath, join(dirs.analysis, 'layer_motion.json'));
    const rmsCurve = toCurve(audio);        // adapt AudioEnergyLayer's rms points to CurvePoint[] — read audioEnergy.ts for field names; write toCurve as a tiny exported pure fn
    const arcs = await mineArcs(
      chunkTranscript(segments),
      (c) => buildEvidenceBlock({ window: { start: c.start, end: c.end }, rms: rmsCurve, motion, silences: audio.silences }),
      { cachePath: join(dirs.analysis, `layer_arcs_${chosen}.json`), durationSec: meta.duration, mode: profile.name },
    );
    arcCandidates = mergeMinedCandidates(candidates, arcs);
    sp.succeed(`arcs: ${arcs.length} mined, ${arcCandidates.length} candidates total`);
  } catch (e) {
    sp.warn(`arc mining unavailable (${e instanceof Error ? e.message : String(e)}) — scorer candidates only`);
  }
} else {
  logger.warn('arc engine OFF — no LLM provider (SEMANTIC_PROVIDER/keys); gate disabled, pipeline runs as before');
}
```

Return `candidates: arcCandidates` and add `motion` to the returned `VideoAnalysis`.

**(b) `rankAndExport`** — replace the current `const selected = rankAcrossAnalyses(pool, { top: opts.top, perVideoCap: opts.perVideoCap });` with the completion/gate stage:

```ts
const provider = pickSemanticProvider(process.env);
const arcRejections: ArcRejection[] = [];
let selected: SourcedRankedClip[];
if (provider === 'none') {
  selected = rankAcrossAnalyses(pool, { top: opts.top, perVideoCap: opts.perVideoCap });
} else {
  const K = Math.max(opts.arcTopk ?? 8, opts.top);
  const topK = rankAcrossAnalyses(pool, { top: K, perVideoCap: opts.perVideoCap });
  const survivors: SourcedRankedClip[] = [];
  for (const item of topK) {
    const { clip, source } = item;
    const window = { start: clip.start, end: clip.end };
    const rmsCurve = toCurve(source.audio);
    const evidence = buildEvidenceBlock({ window: padSpan(window, 10, source.meta.duration), rms: rmsCurve, motion: source.motion ?? [], silences: source.audio.silences });
    const images = await extractKeyframes(
      source.videoPath,
      keyframeTimes(window, peakTime(rmsCurve, window), peakTime(source.motion ?? [], window)),
      join(WS, 'analysis', source.jobId, 'keyframes'),
    ).catch(() => []);                                    // ladder: frames fail → numbers-only
    const contextSegments = source.segments.filter((s) => s.end > window.start - 60 && s.start < window.end + 60);
    const completion = await completeArc({ window, segments: contextSegments, evidence, images, priorArc: clip.arc, mode: source.mode, durationSec: source.meta.duration, ask: undefined });
    const gate = gateArc(completion);
    if (!gate.pass) {
      arcRejections.push(arcRejectionRow(clip, gate.missing, completion ? 'incomplete-arc' : 'arc-label-failed'));
      if (!opts.lenient) continue;
      survivors.push(completion
        ? { source, clip: applyCompletionToClip(clip, completion, resolveOrKeep(completion, clip, source)) }
        : item);                                           // lenient: export as-was, labeled by Task 11
      continue;
    }
    const bounds = resolveBounds(completion!, { envelope: MODE_PROFILES[source.mode].lengths, segments: source.segments, used: opts.allowRepeats ? [] : await loadUsedRanges(source.jobId), durationSec: source.meta.duration });
    if ('reject' in bounds) {
      arcRejections.push(arcRejectionRow(clip, [], 'overlap'));
      if (!opts.lenient) continue;
      survivors.push(item);
      continue;
    }
    survivors.push({ source, clip: applyCompletionToClip(clip, completion!, bounds) });
  }
  survivors.sort((a, b) => b.clip.composite_score - a.clip.composite_score);
  selected = survivors.slice(0, opts.top).map(({ clip, source }, i) => ({
    source, clip: { ...clip, rank: i + 1, clip_id: `clip_${String(i + 1).padStart(3, '0')}` },
  }));
  if (selected.length === 0) {
    logger.warn('arc gate: ZERO clips passed 6/6 — nothing to export. Missing parts per candidate are in the table below (--lenient to export anyway).');
  }
}
```

`padSpan(span, pad, max)` and `resolveOrKeep` (lenient path: try `resolveBounds`, fall back to the clip's own bounds) are small exported pure helpers — write them next to `applyCompletionToClip`. Print `arcRejections` as a `cli-table3` table (clip span, missing parts, reason) right after the loop, and pass `arcRejections` + per-clip completions to the export step (Task 11 threads them into `writeExports`). Also: lenient survivors and gated survivors both need their `arc` data available to Task 11 — build `arcByClip: Map<string, { completion: ArcCompletion | null; complete: boolean; missing: string[] }>` keyed by final `clip_id` inside the renumbering map, and hold it next to `succeeded` for the `writeExports` call.

**(c) CLI flags** in `src/cli/index.ts`, on every command that builds `AllOpts` (`all`, `process`, `batch`):

```ts
.option('--arc-topk <n>', 'candidates given the arc completion+gate pass (min = --top)', (v) => parseInt(v, 10), 8)
.option('--lenient', 'export clips that fail the 6/6 story gate (labeled arc.complete=false)')
```

and thread `arcTopk`/`lenient` into the `AllOpts` object literals.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/cli/arcPipeline.test.ts && npx vitest run tests/cli/ && npx tsc --noEmit` — Expected: all PASS/clean. Pre-existing `all.ts` tests (buildPins etc.) must not change behavior.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/all.ts src/cli/index.ts src/types/index.ts tests/cli/arcPipeline.test.ts
git commit -m "feat(arc): pipeline wiring — mining in analysis, completion+gate before export, --arc-topk/--lenient"
```

---

### Task 11: Exports, manifest, GUI badge

**Files:**
- Modify: `src/export/exporter.ts` (`writeExports` at ~line 115, `buildManifest` at ~line 99)
- Modify: `src/cli/commands/all.ts` (the `writeExports` call at ~line 464)
- Modify: `ui/lib/workspace.ts` (manifest clip type) and `ui/components/clips-tab.tsx` (badge)
- Test: `tests/export/exporter.test.ts` (extend)

**Interfaces:**
- Consumes: `ArcCompletion` (Task 9), `ArcRejection` + `arcByClip` map (Task 10), `arcScore` (Task 1).
- Produces:
  - `ArcExport { complete: boolean; missing: string[]; arcScore: number; synopsis: string; reactionAfterPeak: boolean; components: ArcComponents; provider: string }` exported from `exporter.ts`.
  - `writeExports(...)` gains two trailing optional params: `arcByClip?: Map<string, ArcExport>` and `arcRejections?: ArcRejection[]`. Per-clip `clip.json` gains `arc: ArcExport` when present. `buildManifest` output gains per-clip `arc_complete?: boolean` and top-level `arc_rejections: ArcRejection[]` (empty array when none).
  - GUI: manifest clip type gains `arc_complete?: boolean`; `clips-tab.tsx` renders a small badge next to the existing predicted-retention badge — `arc_complete === true` → green `story ✓`, `false` → amber `partial`, `undefined` → nothing.

- [ ] **Step 1: Write the failing tests** (extend `tests/export/exporter.test.ts` following its existing fixture style — read it first)

```ts
// appended cases:
// 1. writeExports with arcByClip → clip.json contains the arc block verbatim
// 2. buildManifest marks arc_complete per clip and carries arc_rejections
// 3. no arc data → clip.json has NO arc key, manifest arc_rejections === []
```

Write these as real tests using the file's existing tmp-dir/fixture helpers.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/export/exporter.test.ts` — Expected: new cases FAIL (unknown params).

- [ ] **Step 3: Implement**

- `exporter.ts`: add the `ArcExport`/params; in the per-clip json build, spread `...(arcByClip?.get(clip.clip_id) ? { arc: arcByClip.get(clip.clip_id) } : {})`; in `buildManifest`, add `arc_complete: arcByClip?.get(c.clip_id)?.complete` per clip (omit when undefined) and `arc_rejections: arcRejections ?? []` at top level.
- `all.ts`: build `Map<string, ArcExport>` from Task 10's completion data (`complete = gate.pass`, `missing`, `arcScore: arcScore(label)`, `provider: pickSemanticProvider(process.env)`) and pass both new args at the `writeExports` call.
- `ui/lib/workspace.ts`: add `arc_complete?: boolean` to the manifest clip type.
- `ui/components/clips-tab.tsx`: next to the predicted-retention badge, mirror its markup:

```tsx
{clip.arc_complete !== undefined && (
  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${clip.arc_complete ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'}`}>
    {clip.arc_complete ? 'story ✓' : 'partial'}
  </span>
)}
```

(match the file's actual class conventions — read the neighboring badge first).

- [ ] **Step 4: Run tests + builds**

Run: `npx vitest run tests/export/ && npx tsc --noEmit && cd ui && npm run build && cd ..` — Expected: PASS / clean builds.

- [ ] **Step 5: Commit**

```bash
git add src/export/exporter.ts src/cli/commands/all.ts ui/lib/workspace.ts ui/components/clips-tab.tsx tests/export/exporter.test.ts
git commit -m "feat(arc): arc block in clip.json + manifest rejections + GUI story badge"
```

---

### Task 12: Full gates + live Gemini smoke

**Files:** none new — verification only.

- [ ] **Step 1: Full test suite** — Run: `npx vitest run` — Expected: ALL PASS (≥ the pre-task count; no skips added).
- [ ] **Step 2: Typecheck gates** — Run: `npx tsc --noEmit && (cd remotion && npx tsc --noEmit) && (cd ui && npm run build)` — Expected: clean.
- [ ] **Step 3: Live smoke (REQUIRED before claiming done — superpowers:verification-before-completion):**

```bash
npm run build   # or the repo's dist build script — check package.json
SEMANTIC_PROVIDER=gemini node dist/cli/index.js all "<a real ~20-60min YouTube URL>" --top 2
```

Verify, and paste evidence into the final report:
1. Log shows `Mining micro-story arcs…` with a mined-arc count and `layer_arcs_gemini.json` exists in the job's analysis dir.
2. At least one completion call ran with keyframes (keyframes dir has `kf_*.jpg` ≤512px wide).
3. An exported `clip.json` contains a full `arc` block with six components and `complete: true` — and the clip's bounds differ from the pre-completion candidate when the model expanded them.
4. Either a rejection table printed with named missing components, or re-run with `--arc-topk 3 --top 3` until at least one rejection appears; then re-run with `--lenient` and confirm the rejected clip exports with `arc.complete false`.
5. Zero-clip path: confirm the warning copy appears if everything is rejected (or force it: `--minScore 99` is NOT the mechanism — instead temporarily verify via the integration test; the live check is optional if rejections were observed in (4)).

- [ ] **Step 4: Commit any smoke fixes, then final commit**

```bash
git add -A && git commit -m "feat(arc): micro-story arc engine live-verified on Gemini 2.5 Flash"
```

---

## Self-Review Notes (already applied)

- Spec coverage: §1 provider layer → Task 5; §2 motion/evidence → Tasks 3–4; §3 mining → Tasks 2, 6; §4 completion/keyframes/bounds → Tasks 8–9; §5 gate/scoring/two-stage rank → Tasks 7, 9, 10; §6 ladder → Tasks 6 (retryable chunks), 8 (frame skip), 9 (null completion), 10 (`provider none`, zero-clip warning, lenient); §7 outputs/GUI → Task 11; §8 cost (`--arc-topk`) → Task 10; §9 tests/smoke → every task + Task 12.
- Raw-composite recovery in `applyCompletionToClip` (Task 10) is the one place with two valid implementations — the task text mandates picking one and documenting it in code.
- Names used across tasks were cross-checked: `arcScore`, `validateArc`, `arcOuterSpan`, `missingComponents`, `chunkTranscript`, `motionLayer`, `buildEvidenceBlock`, `downsampleCurve`, `askVisionJson`, `toGeminiParts`, `toClaudeContent`, `mineArcs`, `mergeMinedCandidates`, `overlapFraction`, `arcWeightedComposite`, `keyframeTimes`, `peakTime`, `extractKeyframes`, `completionPrompt`, `parseCompletion`, `resolveBounds`, `gateArc`, `completeArc`, `applyCompletionToClip`, `arcRejectionRow`.
