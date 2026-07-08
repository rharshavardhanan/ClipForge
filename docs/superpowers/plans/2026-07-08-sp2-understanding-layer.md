# SP2 Understanding Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One unified per-chunk LLM pass produces Scene Graph + Story Graph edges + arcs; pure-Node importance-curve fusion; four consumers wired (ranker sort boost, arc-completion context, AVSS attention blend, exports); perception flips default-ON and overlapped.

**Architecture:** New `src/understanding/` package evolves the arc miner: the existing one-call-per-9-min-chunk shape, per-chunk cache, and fail-soft-retry mechanics stay; the prompt gains a perception digest and the response gains `scenes` + `edges` beside `arcs`. Assembly (seam merge, id remap, importance fusion) is pure Node. Consumers follow the established identity-preserving patterns (sort-only boost, optional SourceSignals field, prompt context section, trailing exporter maps).

**Tech Stack:** TypeScript (Node), vitest, existing `llmJson` ask helpers (Gemini key-pool + Claude structured outputs), no new dependencies.

## Global Constraints

- **Gemini-first mandate:** every feature works fully on free Gemini 2.5 Flash (loose-shape tolerance via normalizers); Claude is a drop-in upgrade; **every Claude-facing JSON-schema object carries `additionalProperties: false`** (nested included) or Claude 400s.
- **Budget-flat:** LLM calls per video unchanged vs today (1 understanding call per chunk replaces 1 arc-mining call per chunk; completion pass untouched).
- **Identity guarantees:** no understanding result → ranker order bit-identical; no `importance` in SourceSignals → simulation bit-identical; no context string → completion prompt identical; perception off → pipeline byte-identical to perception-off today. Each has an explicit test.
- **Pinned authority:** the STRICT 6/6 gate, `resolveBounds` envelope hard-gate, `--lenient`, `arcWeightedComposite`, `ArcLabel` shape, and contiguous `{start,end}` clips are all UNCHANGED.
- **Fail-soft:** per-chunk LLM failures warn + skip + stay uncached (retry next run); a fully-failed pass degrades per the spec §6 matrix; the run never dies for understanding reasons.
- **Perception default ON:** gate becomes `PERCEPTION=0 → off; PERCEPTION=1 → on; else opts.perception !== false`. CLI accepts BOTH `--perception` (back-compat force-on) and `--no-perception`. Launch right after download unawaited; await before the understanding pass.
- **Importance fusion constants (spec §3):** `W_SCENE 0.45, W_RMS 0.20, W_MOTION 0.15, W_EVENT 0.20`; no-LLM renormalization `0.36/0.27/0.36`; curve at 1s; scene step curve smoothed by 3-point moving average; RMS/motion normalized so video p95 → 1.
- **Consumer constants:** `IMPORTANCE_SORT_WEIGHT = 1.5` (sort-only), attention blend `0.15 × (importance(t) − 0.5)`, edge min confidence `0.3`, scene min `3s`, seam-merge gap `≤1s` / cap `180s`, digest cap `40` lines.
- Cache file: `workspace/analysis/layer_understanding_<provider>.json`; old `layer_arcs_<provider>.json` ignored (re-mine once).
- Gates: `npx vitest run && npx tsc --noEmit` clean at the end of every task (focused suites while iterating). **Never `next build` in `ui/`.**
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
src/understanding/
  types.ts        # SceneNode/StoryEdge/UnderstandingResult + JSON schemas + constants (Task 1)
  digest.ts       # perception digest for prompts (Task 2)
  normalize.ts    # Gemini loose-shape tolerance for scenes/edges (Task 3)
  validate.ts     # clamp/trim/ref-check scenes & edges (Task 3)
  prompt.ts       # unified prompt, absorbs miningPrompt (Task 4)
  assemble.ts     # seam merge + id remap + importance fusion + slice/mean helpers (Task 5)
  context.ts      # renderUnderstandingContext for the completion prompt (Task 8)
  engine.ts       # runUnderstanding: chunk loop, cache, fail-soft (Task 6)
src/analysis/arcMiner.ts        # export MODE_VOCAB; mineArcs body retired in Task 11 (schema + mergeMinedCandidates stay)
src/clipDetection/ranker.ts     # importance sort boost (Task 7)
src/analysis/arcCompleter.ts    # understanding context section (Task 8)
src/avss/editPlan.ts, simulator.ts  # SourceSignals.importance + attention blend (Task 9)
src/perception/perceptionClient.ts  # perceptionEnabled() gate helper (Task 10)
src/cli/index.ts                # --perception/--no-perception pair (Task 10)
src/cli/commands/all.ts         # overlap launch, understanding wiring, consumers (Tasks 10-11)
src/export/exporter.ts          # UnderstandingExport maps (Task 11)
tests/understanding/*.test.ts   # per-module tests
```

---

### Task 1: Understanding types, schemas, constants

**Files:**
- Create: `src/understanding/types.ts`
- Test: `tests/understanding/types.test.ts`

**Interfaces:**
- Consumes: `ArcLabel` from `src/types/index.js`; `ARC_MINE_SCHEMA` from `src/analysis/arcMiner.js` (its `properties.arcs` is reused verbatim so arc items stay schema-identical).
- Produces (later tasks import these exact names): `SceneNode`, `StoryEdge`, `StoryEdgeType`, `UnderstandingResult`, `STORY_EDGE_TYPES`, `UNDERSTAND_SCHEMA`, constants `EDGE_MIN_CONFIDENCE (0.3)`, `MIN_SCENE_SEC (3)`, `SCENE_MERGE_MAX_GAP_SEC (1)`, `SCENE_MERGE_MAX_SEC (180)`, `W_SCENE (0.45)`, `W_RMS (0.2)`, `W_MOTION (0.15)`, `W_EVENT (0.2)`, `IMPORTANCE_SORT_WEIGHT (1.5)`, `MAX_DIGEST_LINES (40)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/understanding/types.test.ts
import { describe, expect, it } from 'vitest';
import { STORY_EDGE_TYPES, UNDERSTAND_SCHEMA } from '../../src/understanding/types.js';

/** Every object node in a Claude-facing schema must set additionalProperties: false. */
function assertStrictObjects(node: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (!node || typeof node !== 'object') return out;
  const n = node as Record<string, unknown>;
  if (n.type === 'object' && n.additionalProperties !== false) out.push(path);
  for (const [k, v] of Object.entries(n)) out.push(...assertStrictObjects(v, `${path}.${k}`));
  return out;
}

describe('UNDERSTAND_SCHEMA', () => {
  it('sets additionalProperties:false on every object (Claude structured-outputs rule)', () => {
    expect(assertStrictObjects(UNDERSTAND_SCHEMA)).toEqual([]);
  });
  it('requires arcs, scenes and edges at the top level', () => {
    expect((UNDERSTAND_SCHEMA as { required: string[] }).required).toEqual(['arcs', 'scenes', 'edges']);
  });
  it('edge type enum matches STORY_EDGE_TYPES', () => {
    const edgeItems = (UNDERSTAND_SCHEMA as never as {
      properties: { edges: { items: { properties: { type: { enum: string[] } } } } };
    }).properties.edges.items;
    expect(edgeItems.properties.type.enum).toEqual([...STORY_EDGE_TYPES]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/understanding/types.test.ts`
Expected: FAIL — cannot resolve `src/understanding/types.js`.

- [ ] **Step 3: Implement**

```ts
// src/understanding/types.ts
/**
 * SP2 Understanding contract (spec 2026-07-08): Scene Graph nodes, Story Graph edges,
 * the assembled UnderstandingResult, the unified LLM response schema, and the pinned
 * constants from the spec. Arc items reuse ARC_MINE_SCHEMA's items verbatim so the
 * arc contract cannot drift from the miner's.
 */
import type { ArcLabel, ArcSpan } from '../types/index.js';
import { ARC_MINE_SCHEMA } from '../analysis/arcMiner.js';

export const STORY_EDGE_TYPES = ['setup_for', 'escalates', 'pays_off', 'reacts_to', 'callback'] as const;
export type StoryEdgeType = (typeof STORY_EDGE_TYPES)[number];

export interface SceneNode {
  id: string;                     // "sc0"… global after assembly
  span: ArcSpan;                  // source-absolute seconds
  label: string;                  // natural phrase, never /^scene \d+$/
  participants: string[];         // speaker ids ("S0") when diarized, else inferred names
  goal: string;
  emotion: string;
  events: string[];               // ≤5
  importance: number;             // 0-1 LLM anchor
}

export interface StoryEdge {
  from: string;                   // "sc<i>" | "arc<i>"
  to: string;
  type: StoryEdgeType;
  confidence: number;             // 0-1
}

export interface ImportancePoint { t: number; v: number; }

export interface UnderstandingResult {
  scenes: SceneNode[];
  arcs: ArcLabel[];               // EXACTLY today's mineArcs output shape
  edges: StoryEdge[];
  importance: ImportancePoint[];  // 1s resolution, whole video, 0-1
  provider: string;               // 'claude' | 'gemini' | 'none'
}

// --- pinned constants (spec §3-§4) ---
export const EDGE_MIN_CONFIDENCE = 0.3;
export const MIN_SCENE_SEC = 3;
export const SCENE_MERGE_MAX_GAP_SEC = 1;
export const SCENE_MERGE_MAX_SEC = 180;
export const W_SCENE = 0.45;
export const W_RMS = 0.20;
export const W_MOTION = 0.15;
export const W_EVENT = 0.20;
export const IMPORTANCE_SORT_WEIGHT = 1.5;
export const MAX_DIGEST_LINES = 40;

// --- unified response schema ---
const SPAN_SCHEMA = {
  type: 'object',
  properties: { start: { type: 'number' }, end: { type: 'number' } },
  required: ['start', 'end'],
  additionalProperties: false,
} as const;

const SCENE_SCHEMA = {
  type: 'object',
  properties: {
    span: SPAN_SCHEMA,
    label: { type: 'string' },
    participants: { type: 'array', items: { type: 'string' } },
    goal: { type: 'string' },
    emotion: { type: 'string' },
    events: { type: 'array', items: { type: 'string' } },
    importance: { type: 'number' },
  },
  required: ['span', 'label', 'participants', 'goal', 'emotion', 'events', 'importance'],
  additionalProperties: false,
} as const;

const EDGE_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    type: { enum: [...STORY_EDGE_TYPES] },
    confidence: { type: 'number' },
  },
  required: ['from', 'to', 'type', 'confidence'],
  additionalProperties: false,
} as const;

export const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    arcs: (ARC_MINE_SCHEMA as { properties: { arcs: unknown } }).properties.arcs,
    scenes: { type: 'array', items: SCENE_SCHEMA },
    edges: { type: 'array', items: EDGE_SCHEMA },
  },
  required: ['arcs', 'scenes', 'edges'],
  additionalProperties: false,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/understanding/types.test.ts && npx tsc --noEmit`
Expected: 3 passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/understanding/types.ts tests/understanding/types.test.ts
git commit -m "feat(understanding): SP2 contract types + unified response schema (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Perception digest for prompts

**Files:**
- Create: `src/understanding/digest.ts`
- Test: `tests/understanding/digest.test.ts`

**Interfaces:**
- Consumes: `SemanticTimeline` from `src/perception/timeline.js`; `MAX_DIGEST_LINES` from Task 1.
- Produces: `buildPerceptionDigest(timeline: SemanticTimeline | null, window: ArcSpan): string` — '' when timeline is null or nothing lands in the window. Task 4's prompt and Task 11's wiring rely on this exact signature.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/understanding/digest.test.ts
import { describe, expect, it } from 'vitest';
import { buildPerceptionDigest } from '../../src/understanding/digest.js';
import type { SemanticTimeline } from '../../src/perception/timeline.js';

const base: SemanticTimeline = {
  schema_version: 1, job_id: 'j', duration: 600, sample_fps: 2, producers_run: ['mock'],
  speakers: [], audio_events: [], scenes: [], tracks: [], objects: [], depth: [], vlm_captions: [],
};

describe('buildPerceptionDigest', () => {
  it('returns empty string for null timeline', () => {
    expect(buildPerceptionDigest(null, { start: 0, end: 60 })).toBe('');
  });

  it('lists CLIP scenes, audience events and multi-speaker turns inside the window', () => {
    const t: SemanticTimeline = {
      ...base,
      scenes: [
        { start: 10, end: 40, label: 'a gym workout' },
        { start: 40, end: 90, label: 'scene 2' },            // generic mock label → excluded
        { start: 200, end: 260, label: 'a beach or pool' },  // outside window → excluded
      ],
      audio_events: [
        { start: 20, end: 22, kind: 'laughter', score: 0.9 },
        { start: 30, end: 31, kind: 'music', score: 0.9 },   // not an audience kind → excluded
        { start: 25, end: 26, kind: 'applause', score: 0.2 },// below 0.35 → excluded
      ],
      speakers: [
        { id: 'S0', turns: [{ start: 12, end: 18 }] },
        { id: 'S1', turns: [{ start: 18, end: 25 }] },
      ],
    };
    const d = buildPerceptionDigest(t, { start: 0, end: 100 });
    expect(d).toContain('[10.0-40.0] a gym workout');
    expect(d).not.toContain('scene 2');
    expect(d).not.toContain('beach');
    expect(d).toContain('[20.0] laughter 0.90');
    expect(d).not.toContain('music');
    expect(d).not.toContain('applause');
    expect(d).toContain('[12.0-18.0] S0');
    expect(d).toContain('[18.0-25.0] S1');
  });

  it('omits speaker turns when only one speaker exists (mock diarization is noise)', () => {
    const t: SemanticTimeline = { ...base, speakers: [{ id: 'S0', turns: [{ start: 1, end: 50 }] }] };
    expect(buildPerceptionDigest(t, { start: 0, end: 60 })).not.toContain('S0');
  });

  it('caps at MAX_DIGEST_LINES', () => {
    const scenes = Array.from({ length: 60 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, label: `a scene about topic ${i}` }));
    const d = buildPerceptionDigest({ ...base, scenes }, { start: 0, end: 300 });
    expect(d.split('\n').length).toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/understanding/digest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/understanding/digest.ts
/**
 * PURE: compact perception-facts block appended to the understanding prompt —
 * CLIP scene labels, audience audio events, and (real, multi-speaker) diarization
 * turns inside the chunk window. Timeline absent → '' (prompt degrades to the
 * existing RMS/motion evidence alone). Capped like buildEvidenceBlock.
 */
import type { SemanticTimeline } from '../perception/timeline.js';
import type { ArcSpan } from '../types/index.js';
import { MAX_DIGEST_LINES } from './types.js';

const AUDIENCE_KINDS = new Set(['laughter', 'applause', 'cheer', 'impact']);
const GENERIC_SCENE_LABEL = /^scene \d+$/;
const EVENT_SCORE_MIN = 0.35;
const MAX_EVENTS = 15;
const MAX_TURNS = 15;

export function buildPerceptionDigest(timeline: SemanticTimeline | null, window: ArcSpan): string {
  if (!timeline) return '';
  const lines: string[] = [];

  const scenes = timeline.scenes.filter(
    (s) => s.end > window.start && s.start < window.end && !GENERIC_SCENE_LABEL.test(s.label),
  );
  if (scenes.length > 0) {
    lines.push('VISUAL SCENES (camera sees):');
    for (const s of scenes) lines.push(`[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.label}`);
  }

  const events = timeline.audio_events
    .filter((e) => AUDIENCE_KINDS.has(e.kind) && e.score >= EVENT_SCORE_MIN
      && e.start >= window.start && e.start < window.end)
    .sort((a, b) => b.score - a.score).slice(0, MAX_EVENTS)
    .sort((a, b) => a.start - b.start);
  if (events.length > 0) {
    lines.push('AUDIENCE AUDIO EVENTS:');
    for (const e of events) lines.push(`[${e.start.toFixed(1)}] ${e.kind} ${e.score.toFixed(2)}`);
  }

  // Single-speaker layers are the mock's silence-complement — noise, not diarization.
  if (timeline.speakers.length > 1) {
    const turns = timeline.speakers
      .flatMap((sp) => sp.turns
        .filter((t) => t.end > window.start && t.start < window.end)
        .map((t) => ({ id: sp.id, start: t.start, end: t.end })))
      .sort((a, b) => a.start - b.start).slice(0, MAX_TURNS);
    if (turns.length > 0) {
      lines.push('SPEAKER TURNS:');
      for (const t of turns) lines.push(`[${t.start.toFixed(1)}-${t.end.toFixed(1)}] ${t.id}`);
    }
  }

  return lines.slice(0, MAX_DIGEST_LINES).join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/understanding/digest.test.ts && npx tsc --noEmit`
Expected: 4 passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/understanding/digest.ts tests/understanding/digest.test.ts
git commit -m "feat(understanding): perception digest for the unified prompt (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Gemini normalizers + validators for scenes/edges

**Files:**
- Create: `src/understanding/normalize.ts`
- Create: `src/understanding/validate.ts`
- Test: `tests/understanding/normalize.test.ts`, `tests/understanding/validate.test.ts`

**Interfaces:**
- Consumes: `STORY_EDGE_TYPES`, `EDGE_MIN_CONFIDENCE`, `MIN_SCENE_SEC`, `SceneNode`, `StoryEdge` from Task 1; `clamp01` from `src/avss/editPlan.js`.
- Produces: `normalizeUnderstandingRaw(raw: unknown): { arcs: unknown[]; scenes: unknown[]; edges: unknown[] }` (top-level array → arcs, preserving today's Gemini wrapper-drop tolerance; missing keys → `[]`); `normalizeSceneRaw(raw: unknown): unknown`; `normalizeEdgeRaw(raw: unknown): unknown`; `validateScenes(raws: unknown[], chunk: ArcSpan): Omit<SceneNode, 'id'>[]`; `validateEdges(raws: unknown[], sceneCount: number, arcCount: number): StoryEdge[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/understanding/normalize.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeEdgeRaw, normalizeSceneRaw, normalizeUnderstandingRaw } from '../../src/understanding/normalize.js';

describe('normalizeUnderstandingRaw', () => {
  it('treats a bare top-level array as the arcs list (Gemini wrapper drop)', () => {
    const r = normalizeUnderstandingRaw([{ synopsis: 'x' }]);
    expect(r.arcs).toHaveLength(1);
    expect(r.scenes).toEqual([]);
    expect(r.edges).toEqual([]);
  });
  it('fills missing keys with empty arrays', () => {
    expect(normalizeUnderstandingRaw({ arcs: [] })).toEqual({ arcs: [], scenes: [], edges: [] });
    expect(normalizeUnderstandingRaw(null)).toEqual({ arcs: [], scenes: [], edges: [] });
  });
});

describe('normalizeSceneRaw', () => {
  it('coerces "a-b" string spans, string importance, scalar participants', () => {
    const s = normalizeSceneRaw({
      span: '12.9-31.3', label: 'gym bet', participants: 'S0',
      goal: 'win', emotion: 'hype', events: 'dunk', importance: '0.8',
    }) as Record<string, unknown>;
    expect(s.span).toEqual({ start: 12.9, end: 31.3 });
    expect(s.participants).toEqual(['S0']);
    expect(s.events).toEqual(['dunk']);
    expect(s.importance).toBe(0.8);
  });
  it('defaults missing importance to 0.5 and missing arrays to []', () => {
    const s = normalizeSceneRaw({ span: { start: 0, end: 5 }, label: 'x' }) as Record<string, unknown>;
    expect(s.importance).toBe(0.5);
    expect(s.participants).toEqual([]);
    expect(s.events).toEqual([]);
    expect(s.goal).toBe('');
    expect(s.emotion).toBe('');
  });
});

describe('normalizeEdgeRaw', () => {
  it('coerces confidence and lowercases the type', () => {
    const e = normalizeEdgeRaw({ from: 'sc0', to: 'arc1', type: 'Pays_Off', confidence: '0.7' }) as Record<string, unknown>;
    expect(e.type).toBe('pays_off');
    expect(e.confidence).toBe(0.7);
  });
  it('defaults missing confidence to 0.5', () => {
    const e = normalizeEdgeRaw({ from: 'sc0', to: 'sc1', type: 'escalates' }) as Record<string, unknown>;
    expect(e.confidence).toBe(0.5);
  });
});
```

```ts
// tests/understanding/validate.test.ts
import { describe, expect, it } from 'vitest';
import { validateEdges, validateScenes } from '../../src/understanding/validate.js';

const CHUNK = { start: 0, end: 540 };

describe('validateScenes', () => {
  it('clamps spans to the chunk, drops sub-3s scenes, trims overlaps in start order', () => {
    const out = validateScenes([
      { span: { start: -5, end: 30 }, label: 'intro', participants: [], goal: '', emotion: '', events: [], importance: 0.5 },
      { span: { start: 28, end: 60 }, label: 'bet', participants: [], goal: '', emotion: '', events: [], importance: 0.9 },
      { span: { start: 60, end: 61 }, label: 'sliver', participants: [], goal: '', emotion: '', events: [], importance: 0.5 },
    ], CHUNK);
    expect(out).toHaveLength(2);
    expect(out[0].span).toEqual({ start: 0, end: 30 });
    expect(out[1].span.start).toBe(30);            // overlap trimmed to prior end
  });
  it('drops structural garbage, clamps importance, caps events at 5', () => {
    const out = validateScenes([
      { span: { start: 0, end: 10 }, label: 'x', participants: [], goal: '', emotion: '', events: ['a','b','c','d','e','f'], importance: 7 },
      { nope: true },
      null,
    ], CHUNK);
    expect(out).toHaveLength(1);
    expect(out[0].importance).toBe(1);
    expect(out[0].events).toHaveLength(5);
  });
});

describe('validateEdges', () => {
  it('keeps only in-range refs, known types, confidence ≥ 0.3, no self-loops', () => {
    const out = validateEdges([
      { from: 'sc0', to: 'arc0', type: 'pays_off', confidence: 0.8 },   // keep
      { from: 'sc9', to: 'sc0', type: 'escalates', confidence: 0.8 },   // sc9 out of range
      { from: 'sc0', to: 'sc1', type: 'foreshadows', confidence: 0.8 }, // unknown type
      { from: 'sc0', to: 'sc1', type: 'escalates', confidence: 0.2 },   // below floor
      { from: 'sc1', to: 'sc1', type: 'callback', confidence: 0.9 },    // self-loop
    ], 2, 1);
    expect(out).toEqual([{ from: 'sc0', to: 'arc0', type: 'pays_off', confidence: 0.8 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/understanding/normalize.test.ts tests/understanding/validate.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// src/understanding/normalize.ts
/**
 * PURE Gemini-first tolerance layer for the unified response — the scene/edge
 * siblings of normalizeArcRaw: free-tier Gemini returns "a-b" string spans,
 * stringified numbers, scalars where arrays belong, and sometimes drops the
 * object wrapper entirely (a bare array IS the arcs list, matching today's
 * arc-mining tolerance). Garbage stays garbage — validation rejects downstream.
 */

function normalizeSpan(s: unknown): unknown {
  if (typeof s === 'string') {
    const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*$/);
    return m ? { start: Number(m[1]), end: Number(m[2]) } : s;
  }
  const sp = s as { start?: unknown; end?: unknown };
  if (sp && typeof sp === 'object' && sp.start !== undefined && sp.end !== undefined) {
    const start = Number(sp.start);
    const end = Number(sp.end);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }
  return s;
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string' && v.trim() !== '' ? [v] : [];

export function normalizeSceneRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  r.span = normalizeSpan(r.span);
  r.participants = asStringArray(r.participants);
  r.events = asStringArray(r.events);
  if (typeof r.label !== 'string') r.label = '';
  if (typeof r.goal !== 'string') r.goal = '';
  if (typeof r.emotion !== 'string') r.emotion = '';
  const imp = Number(r.importance);
  r.importance = Number.isFinite(imp) && r.importance !== undefined && r.importance !== null ? imp : 0.5;
  return r;
}

export function normalizeEdgeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (typeof r.type === 'string') r.type = r.type.trim().toLowerCase();
  const conf = Number(r.confidence);
  r.confidence = Number.isFinite(conf) && r.confidence !== undefined && r.confidence !== null ? conf : 0.5;
  return r;
}

export function normalizeUnderstandingRaw(raw: unknown): { arcs: unknown[]; scenes: unknown[]; edges: unknown[] } {
  if (Array.isArray(raw)) return { arcs: raw, scenes: [], edges: [] };  // wrapper-drop tolerance
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    arcs: Array.isArray(r.arcs) ? r.arcs : [],
    scenes: (Array.isArray(r.scenes) ? r.scenes : []).map(normalizeSceneRaw),
    edges: (Array.isArray(r.edges) ? r.edges : []).map(normalizeEdgeRaw),
  };
}
```

```ts
// src/understanding/validate.ts
/**
 * PURE strict validation after normalization — clamp scene spans to the chunk,
 * enforce MIN_SCENE_SEC and start-order overlap trimming, cap events, and keep
 * only edges whose refs exist, whose type is known, and whose confidence clears
 * the floor. Strictness lives here; tolerance lives in normalize.ts.
 */
import { clamp01 } from '../avss/editPlan.js';
import type { ArcSpan } from '../types/index.js';
import {
  EDGE_MIN_CONFIDENCE, MIN_SCENE_SEC, STORY_EDGE_TYPES,
  type SceneNode, type StoryEdge, type StoryEdgeType,
} from './types.js';

const EDGE_TYPE_SET = new Set<string>(STORY_EDGE_TYPES);
const REF_RE = /^(sc|arc)(\d+)$/;

export function validateScenes(raws: unknown[], chunk: ArcSpan): Omit<SceneNode, 'id'>[] {
  const candidates: Omit<SceneNode, 'id'>[] = [];
  for (const raw of raws) {
    const r = raw as Record<string, unknown>;
    const span = r?.span as ArcSpan | undefined;
    if (typeof span?.start !== 'number' || typeof span?.end !== 'number') continue;
    const start = Math.max(chunk.start, span.start);
    const end = Math.min(chunk.end, span.end);
    if (end - start < MIN_SCENE_SEC) continue;
    candidates.push({
      span: { start, end },
      label: typeof r.label === 'string' && r.label.trim() !== '' ? r.label.trim() : 'unlabeled',
      participants: Array.isArray(r.participants) ? (r.participants as string[]).slice(0, 8) : [],
      goal: typeof r.goal === 'string' ? r.goal : '',
      emotion: typeof r.emotion === 'string' ? r.emotion : '',
      events: Array.isArray(r.events) ? (r.events as string[]).slice(0, 5) : [],
      importance: clamp01(Number(r.importance)),
    });
  }
  candidates.sort((a, b) => a.span.start - b.span.start);
  const out: Omit<SceneNode, 'id'>[] = [];
  for (const c of candidates) {
    const prevEnd = out.length > 0 ? out[out.length - 1].span.end : -Infinity;
    const start = Math.max(c.span.start, prevEnd);
    if (c.span.end - start < MIN_SCENE_SEC) continue;
    out.push({ ...c, span: { start, end: c.span.end } });
  }
  return out;
}

export function validateEdges(raws: unknown[], sceneCount: number, arcCount: number): StoryEdge[] {
  const inRange = (ref: string): boolean => {
    const m = REF_RE.exec(ref);
    if (!m) return false;
    const idx = Number(m[2]);
    return m[1] === 'sc' ? idx < sceneCount : idx < arcCount;
  };
  const out: StoryEdge[] = [];
  for (const raw of raws) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.from !== 'string' || typeof r?.to !== 'string') continue;
    if (r.from === r.to) continue;
    if (!inRange(r.from) || !inRange(r.to)) continue;
    if (typeof r.type !== 'string' || !EDGE_TYPE_SET.has(r.type)) continue;
    const confidence = clamp01(Number(r.confidence));
    if (confidence < EDGE_MIN_CONFIDENCE) continue;
    out.push({ from: r.from, to: r.to, type: r.type as StoryEdgeType, confidence });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/understanding/ && npx tsc --noEmit`
Expected: all passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/understanding/normalize.ts src/understanding/validate.ts tests/understanding/normalize.test.ts tests/understanding/validate.test.ts
git commit -m "feat(understanding): Gemini tolerance + strict validation for scenes/edges (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Unified prompt (absorbs miningPrompt)

**Files:**
- Modify: `src/analysis/arcMiner.ts:16-19` (add `export` to `MODE_VOCAB`)
- Create: `src/understanding/prompt.ts`
- Test: `tests/understanding/prompt.test.ts`

**Interfaces:**
- Consumes: `MODE_VOCAB` (newly exported from `src/analysis/arcMiner.js`), `TranscriptChunk` from `src/analysis/arcChunker.js`, `ContentMode` from `src/modes.js`.
- Produces: `understandingPrompt(chunk: TranscriptChunk, evidence: string, digest: string, mode: ContentMode, maxSpanSec?: number): string`. Task 6's engine calls it. The arcs instructions are copied VERBATIM from today's `miningPrompt` (same rules, same JSON example lines) so arc quality cannot regress from prompt drift.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/understanding/prompt.test.ts
import { describe, expect, it } from 'vitest';
import { understandingPrompt } from '../../src/understanding/prompt.js';

const CHUNK = { start: 0, end: 540, segments: [{ start: 1, end: 4, text: 'hello world', words: [] }] };

describe('understandingPrompt', () => {
  it('keeps the arc-mining rules, adds scenes+edges instructions and the digest', () => {
    const p = understandingPrompt(CHUNK as never, 'rms 1:2', 'VISUAL SCENES:\n[0.0-10.0] a gym', 'clippies', 45);
    expect(p).toContain('ALL SIX components: setup, trigger, escalation, peak, payoff, reaction');
    expect(p).toContain('HARD LIMIT: each micro-story must span at most 45 seconds');
    expect(p).toContain('2-8 coherent SCENES');
    expect(p).toContain('"sc<i>"');
    expect(p).toContain('setup_for|escalates|pays_off|reacts_to|callback');
    expect(p).toContain('PERCEPTION FACTS:');
    expect(p).toContain('[0.0-10.0] a gym');
    expect(p).toContain('SIGNAL EVIDENCE:');
    expect(p).toContain('[1.0-4.0] hello world');
  });
  it('omits the PERCEPTION FACTS section when the digest is empty', () => {
    const p = understandingPrompt(CHUNK as never, 'rms 1:2', '', 'mindcuts');
    expect(p).not.toContain('PERCEPTION FACTS:');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/understanding/prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

In `src/analysis/arcMiner.ts` change `const MODE_VOCAB` to `export const MODE_VOCAB` (no other change).

```ts
// src/understanding/prompt.ts
/**
 * PURE: the unified understanding prompt — the arc-mining rules VERBATIM from
 * miningPrompt (same six-component instructions, same JSON example) plus scene
 * segmentation, story edges, and the perception-facts digest. One call per chunk,
 * same budget as arc mining alone.
 */
import { MODE_VOCAB } from '../analysis/arcMiner.js';
import type { TranscriptChunk } from '../analysis/arcChunker.js';
import type { ContentMode } from '../modes.js';

export function understandingPrompt(
  chunk: TranscriptChunk, evidence: string, digest: string, mode: ContentMode, maxSpanSec?: number,
): string {
  const transcript = chunk.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  return [
    `Analyze this ${mode} source segment. Return micro-stories, scenes, and story edges.`,
    '',
    'MICRO-STORIES: find 0-4 COMPLETE micro-stories.',
    'A micro-story has ALL SIX components: setup, trigger, escalation, peak, payoff, reaction.',
    'Components may be brief (>=0.5s) or overlap/nest (a trigger inside setup, escalation coinciding with peak) — identify all six or omit the story.',
    `Mode vocabulary: ${MODE_VOCAB[mode]}`,
    ...(maxSpanSec ? [`HARD LIMIT: each micro-story must span at most ${maxSpanSec} seconds from setup start to reaction end — longer stories are rejected downstream.`] : []),
    'Set reactionAfterPeak true when a clear reaction FOLLOWS the peak (weight those stories higher).',
    '',
    'SCENES: segment the window into 2-8 coherent SCENES (each >=3s, non-overlapping, in time order):',
    'label (short natural phrase of what is happening), participants (speaker ids like "S0" when known, else names),',
    'goal (what they are trying to do), emotion (dominant tone), events (up to 5 notable happenings), importance (0-1: how much a viewer must see this).',
    '',
    'EDGES: 0-8 STORY EDGES connecting scenes/stories: type one of setup_for|escalates|pays_off|reacts_to|callback.',
    'from/to reference YOUR OWN arrays in this response: "sc<i>" = scenes[i], "arc<i>" = arcs[i].',
    '',
    'Times are source-absolute seconds.',
    'Return ONLY JSON in EXACTLY this shape (numbers in seconds, every key shown):',
    '{"arcs":[{"synopsis":"one line","confidence":0.8,"reactionAfterPeak":true,'
      + '"components":{"setup":{"start":12.9,"end":31.3},"trigger":{"start":31.3,"end":36.8},'
      + '"escalation":{"start":36.8,"end":57.4},"peak":{"start":57.4,"end":77.8},'
      + '"payoff":{"start":77.8,"end":93.6},"reaction":{"start":93.6,"end":110.3}}}],'
      + '"scenes":[{"span":{"start":10.0,"end":42.5},"label":"gym bet between friends","participants":["S0","S1"],'
      + '"goal":"win the bet","emotion":"hype","events":["bet made","first attempt fails"],"importance":0.8}],'
      + '"edges":[{"from":"sc0","to":"arc0","type":"setup_for","confidence":0.8}]}',
    '', 'TRANSCRIPT:', transcript,
    '', 'SIGNAL EVIDENCE:', evidence,
    ...(digest.trim() !== '' ? ['', 'PERCEPTION FACTS:', digest] : []),
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/understanding/prompt.test.ts tests/analysis/ && npx tsc --noEmit`
Expected: prompt tests pass; existing arc tests unaffected; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/arcMiner.ts src/understanding/prompt.ts tests/understanding/prompt.test.ts
git commit -m "feat(understanding): unified prompt absorbing the arc-mining rules (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Assembly — seam merge, id remap, importance fusion

**Files:**
- Create: `src/understanding/assemble.ts`
- Test: `tests/understanding/assemble.test.ts`

**Interfaces:**
- Consumes: Task 1 types/constants; `CurvePoint` from `src/rankrot/signals.js` (`{time, v}`); `AudioEvent` from `src/perception/timeline.js`; `clamp01` from `src/avss/editPlan.js`.
- Produces (Tasks 6/7/9/11 rely on these exact names):
  - `interface ChunkUnderstanding { chunkKey: string; chunkSpan: ArcSpan; arcs: ArcLabel[]; scenes: Omit<SceneNode,'id'>[]; edges: StoryEdge[] }`
  - `assembleUnderstanding(chunks: ChunkUnderstanding[], signals: AssembleSignals, provider: string): UnderstandingResult` where `interface AssembleSignals { rms: CurvePoint[]; motion: CurvePoint[]; events: AudioEvent[]; durationSec: number; useSceneTerm: boolean }`
  - `sliceImportance(curve: ImportancePoint[], clipStart: number, clipEnd: number): ImportancePoint[]` (clip-relative)
  - `meanImportance01(curve: ImportancePoint[], start: number, end: number): number` (0 when curve empty/no points in range)

**Assembly rules (from the spec, stated here so the implementer needs no other doc):** chunks arrive in time order; scenes get global ids `sc0…` in start order, arcs `arc0…` in chunk order; each chunk's local edge refs (`sc<i>`/`arc<i>` local to that chunk's arrays) are remapped by that chunk's global offsets. After concatenation, adjacent scenes merge iff gap ≤ `SCENE_MERGE_MAX_GAP_SEC` AND labels equal case-insensitive AND (participant sets both empty OR `|A∩B| / min(|A|,|B|) ≥ 0.5`); merged span union capped at `SCENE_MERGE_MAX_SEC` (if union exceeds cap → do not merge); merged importance = max, events = first 5 of concatenation, participants = union; edge refs to a merged-away scene remap to the survivor; ids re-assigned `sc0…` after merging with edges remapped again; duplicate edges (same from/to/type) dedupe keeping max confidence. Importance curve: 1s grid `t = 0 … floor(durationSec)`; `scene01(t)` = importance of the scene containing `t` (0.5 outside any scene), then 3-point moving average; `rms01`/`motion01` = value at nearest point ÷ p95 of the series (p95 of empty series → term is 0), clamped to 1; `event01(t)` = max score of audience-kind events overlapping `t`, else 0; `v(t) = clamp01(W_SCENE·scene01 + W_RMS·rms01 + W_MOTION·motion01 + W_EVENT·event01)` when `useSceneTerm`, else `clamp01((W_RMS·rms01 + W_MOTION·motion01 + W_EVENT·event01) / (1 − W_SCENE))`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/understanding/assemble.test.ts
import { describe, expect, it } from 'vitest';
import {
  assembleUnderstanding, meanImportance01, sliceImportance, type ChunkUnderstanding,
} from '../../src/understanding/assemble.js';

const sc = (start: number, end: number, label: string, importance = 0.5, participants: string[] = []) =>
  ({ span: { start, end }, label, participants, goal: '', emotion: '', events: [], importance });
const SIG = { rms: [], motion: [], events: [], durationSec: 100, useSceneTerm: true };

describe('assembleUnderstanding', () => {
  it('assigns global ids and remaps per-chunk edge refs by offsets', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: '0-540', chunkSpan: { start: 0, end: 50 }, arcs: [], scenes: [sc(0, 10, 'a'), sc(10, 20, 'b')],
        edges: [{ from: 'sc0', to: 'sc1', type: 'setup_for', confidence: 0.8 }] },
      { chunkKey: '480-1020', chunkSpan: { start: 50, end: 100 }, arcs: [], scenes: [sc(50, 60, 'c')],
        edges: [] },
    ];
    const u = assembleUnderstanding(chunks, SIG, 'gemini');
    expect(u.scenes.map((s) => s.id)).toEqual(['sc0', 'sc1', 'sc2']);
    expect(u.edges).toEqual([{ from: 'sc0', to: 'sc1', type: 'setup_for', confidence: 0.8 }]);
    expect(u.provider).toBe('gemini');
  });

  it('merges seam scenes with same label + participant overlap, remapping edges to the survivor', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 50 }, arcs: [], scenes: [sc(0, 49.5, 'Gym Bet', 0.4, ['S0', 'S1'])],
        edges: [] },
      { chunkKey: 'b', chunkSpan: { start: 50, end: 100 }, arcs: [], scenes: [sc(50, 80, 'gym bet', 0.9, ['S0'])],
        edges: [{ from: 'sc0', to: 'sc0', type: 'callback', confidence: 0.9 }] }, // self after remap → dropped
    ];
    const u = assembleUnderstanding(chunks, SIG, 'gemini');
    expect(u.scenes).toHaveLength(1);
    expect(u.scenes[0].span).toEqual({ start: 0, end: 80 });
    expect(u.scenes[0].importance).toBe(0.9);           // max
    expect(u.scenes[0].participants.sort()).toEqual(['S0', 'S1']);
    expect(u.edges).toEqual([]);                        // merged-away → self-loop → dropped
  });

  it('does not merge across a >1s gap or different labels', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 100 }, arcs: [],
        scenes: [sc(0, 10, 'a'), sc(12, 20, 'a'), sc(20, 30, 'b')], edges: [] },
    ];
    const u = assembleUnderstanding(chunks, SIG, 'gemini');
    expect(u.scenes).toHaveLength(3);
  });

  it('importance: scene term dominates where anchored; renormalizes when useSceneTerm=false', () => {
    const chunks: ChunkUnderstanding[] = [
      { chunkKey: 'a', chunkSpan: { start: 0, end: 100 }, arcs: [], scenes: [sc(0, 50, 'hot', 1.0)], edges: [] },
    ];
    const withScene = assembleUnderstanding(chunks, { ...SIG }, 'gemini');
    const at10 = withScene.importance.find((p) => p.t === 10)!;
    const at80 = withScene.importance.find((p) => p.t === 80)!;
    expect(at10.v).toBeGreaterThan(at80.v);             // inside the hot scene > outside

    const noScene = assembleUnderstanding(chunks, { ...SIG, useSceneTerm: false }, 'none');
    // no rms/motion/events either → renormalized terms are all 0
    expect(noScene.importance.every((p) => p.v === 0)).toBe(true);
    expect(noScene.importance).toHaveLength(101);       // 0..100 inclusive at 1s
  });

  it('event term lifts the curve at audience events', () => {
    const chunks: ChunkUnderstanding[] = [];
    const u = assembleUnderstanding(chunks, {
      rms: [], motion: [], durationSec: 30, useSceneTerm: false,
      events: [{ start: 10, end: 12, kind: 'laughter', score: 1.0 }],
    }, 'none');
    const at11 = u.importance.find((p) => p.t === 11)!;
    const at20 = u.importance.find((p) => p.t === 20)!;
    expect(at11.v).toBeGreaterThan(at20.v);
  });
});

describe('sliceImportance / meanImportance01', () => {
  const curve = [{ t: 0, v: 0.2 }, { t: 1, v: 0.4 }, { t: 2, v: 0.6 }, { t: 3, v: 0.8 }];
  it('slices clip-relative', () => {
    expect(sliceImportance(curve, 1, 3)).toEqual([{ t: 0, v: 0.4 }, { t: 1, v: 0.6 }]);
  });
  it('means over the span, 0 on empty', () => {
    expect(meanImportance01(curve, 1, 3)).toBeCloseTo(0.5, 5);
    expect(meanImportance01([], 0, 10)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/understanding/assemble.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/understanding/assemble.ts
/**
 * PURE assembly: per-chunk understanding → one global UnderstandingResult.
 * Global ids, per-chunk edge-ref remapping, seam merging of split scenes, and
 * the importance-curve fusion (spec §3). The LLM anchors scene importance;
 * everything time-domain here is deterministic Node math.
 */
import { clamp01 } from '../avss/editPlan.js';
import type { CurvePoint } from '../rankrot/signals.js';
import type { AudioEvent } from '../perception/timeline.js';
import type { ArcLabel, ArcSpan } from '../types/index.js';
import {
  SCENE_MERGE_MAX_GAP_SEC, SCENE_MERGE_MAX_SEC, W_EVENT, W_MOTION, W_RMS, W_SCENE,
  type ImportancePoint, type SceneNode, type StoryEdge, type UnderstandingResult,
} from './types.js';

export interface ChunkUnderstanding {
  chunkKey: string;
  chunkSpan: ArcSpan;
  arcs: ArcLabel[];
  scenes: Omit<SceneNode, 'id'>[];
  edges: StoryEdge[];              // refs local to THIS chunk's scenes/arcs arrays
}

export interface AssembleSignals {
  rms: CurvePoint[];
  motion: CurvePoint[];
  events: AudioEvent[];
  durationSec: number;
  useSceneTerm: boolean;           // false = no-LLM renormalized fusion (spec §3)
}

const AUDIENCE_KINDS = new Set(['laughter', 'applause', 'cheer', 'impact']);

function participantsCompatible(a: string[], b: string[]): boolean {
  if (a.length === 0 && b.length === 0) return true;
  if (a.length === 0 || b.length === 0) return false;
  const setB = new Set(b);
  const shared = a.filter((x) => setB.has(x)).length;
  return shared / Math.min(a.length, b.length) >= 0.5;
}

/** Merge seam-split scenes; returns scenes plus an index remap old→new. */
function mergeScenes(scenes: Omit<SceneNode, 'id'>[]): { merged: Omit<SceneNode, 'id'>[]; remap: number[] } {
  const merged: Omit<SceneNode, 'id'>[] = [];
  const remap: number[] = [];
  for (const s of scenes) {
    const prev = merged[merged.length - 1];
    const canMerge = prev
      && s.span.start - prev.span.end <= SCENE_MERGE_MAX_GAP_SEC
      && prev.label.toLowerCase() === s.label.toLowerCase()
      && participantsCompatible(prev.participants, s.participants)
      && s.span.end - prev.span.start <= SCENE_MERGE_MAX_SEC;
    if (canMerge) {
      prev.span = { start: prev.span.start, end: Math.max(prev.span.end, s.span.end) };
      prev.importance = Math.max(prev.importance, s.importance);
      prev.participants = [...new Set([...prev.participants, ...s.participants])];
      prev.events = [...prev.events, ...s.events].slice(0, 5);
      remap.push(merged.length - 1);
    } else {
      merged.push({ ...s, participants: [...s.participants], events: [...s.events] });
      remap.push(merged.length - 1);
    }
  }
  return { merged, remap };
}

const p95 = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
};

const nearest = (pts: CurvePoint[], t: number): number => {
  if (pts.length === 0) return 0;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
  return best.v;
};

function buildImportanceCurve(
  scenes: Omit<SceneNode, 'id'>[], sig: AssembleSignals,
): ImportancePoint[] {
  const rmsP95 = p95(sig.rms.map((p) => p.v));
  const motionP95 = p95(sig.motion.map((p) => p.v));
  const audience = sig.events.filter((e) => AUDIENCE_KINDS.has(e.kind));

  const sceneRaw: number[] = [];
  const n = Math.floor(sig.durationSec);
  for (let t = 0; t <= n; t++) {
    const scene = scenes.find((s) => t >= s.span.start && t < s.span.end);
    sceneRaw.push(scene ? scene.importance : 0.5);
  }
  // 3-point moving average smooths scene steps.
  const scene01 = sceneRaw.map((_, i) => {
    const window = sceneRaw.slice(Math.max(0, i - 1), Math.min(sceneRaw.length, i + 2));
    return window.reduce((a, b) => a + b, 0) / window.length;
  });

  const out: ImportancePoint[] = [];
  for (let t = 0; t <= n; t++) {
    const rms01 = rmsP95 > 0 ? Math.min(1, nearest(sig.rms, t) / rmsP95) : 0;
    const motion01 = motionP95 > 0 ? Math.min(1, nearest(sig.motion, t) / motionP95) : 0;
    const event01 = audience.reduce((m, e) => (t >= e.start && t <= e.end ? Math.max(m, e.score) : m), 0);
    const v = sig.useSceneTerm
      ? clamp01(W_SCENE * scene01[t] + W_RMS * rms01 + W_MOTION * motion01 + W_EVENT * event01)
      : clamp01((W_RMS * rms01 + W_MOTION * motion01 + W_EVENT * event01) / (1 - W_SCENE));
    out.push({ t, v });
  }
  return out;
}

export function assembleUnderstanding(
  chunks: ChunkUnderstanding[], signals: AssembleSignals, provider: string,
): UnderstandingResult {
  // 1. Concatenate with global offsets; remap each chunk's local edge refs.
  const allScenes: Omit<SceneNode, 'id'>[] = [];
  const allArcs: ArcLabel[] = [];
  const globalEdges: StoryEdge[] = [];
  for (const c of chunks) {
    const scOff = allScenes.length;
    const arcOff = allArcs.length;
    allScenes.push(...c.scenes);
    allArcs.push(...c.arcs);
    for (const e of c.edges) {
      const remapRef = (ref: string): string => {
        const m = /^(sc|arc)(\d+)$/.exec(ref)!;
        return m[1] === 'sc' ? `sc${scOff + Number(m[2])}` : `arc${arcOff + Number(m[2])}`;
      };
      globalEdges.push({ ...e, from: remapRef(e.from), to: remapRef(e.to) });
    }
  }

  // 2. Sort scenes by start (chunks are in order, but be safe) with an index map,
  //    then seam-merge and remap edges to survivors.
  const order = allScenes.map((_, i) => i).sort((a, b) => allScenes[a].span.start - allScenes[b].span.start);
  const sorted = order.map((i) => allScenes[i]);
  const posOf = new Map(order.map((oldIdx, pos) => [oldIdx, pos]));
  const { merged, remap } = mergeScenes(sorted);

  const remapScRef = (ref: string): string => {
    const m = /^sc(\d+)$/.exec(ref);
    if (!m) return ref;                                   // arc refs unchanged
    return `sc${remap[posOf.get(Number(m[1]))!]}`;
  };
  const seen = new Map<string, StoryEdge>();
  for (const e of globalEdges) {
    const from = remapScRef(e.from);
    const to = remapScRef(e.to);
    if (from === to) continue;                            // merged into a self-loop → drop
    const key = `${from}|${to}|${e.type}`;
    const prev = seen.get(key);
    if (!prev || e.confidence > prev.confidence) seen.set(key, { ...e, from, to });
  }

  const scenes: SceneNode[] = merged.map((s, i) => ({ ...s, id: `sc${i}` }));
  return {
    scenes,
    arcs: allArcs,
    edges: [...seen.values()],
    importance: buildImportanceCurve(merged, signals),
    provider,
  };
}

/** PURE: clip-relative slice of the importance curve for AVSS. */
export function sliceImportance(curve: ImportancePoint[], clipStart: number, clipEnd: number): ImportancePoint[] {
  return curve.filter((p) => p.t >= clipStart && p.t < clipEnd).map((p) => ({ t: p.t - clipStart, v: p.v }));
}

/** PURE: mean importance over [start, end); 0 when no points land inside. */
export function meanImportance01(curve: ImportancePoint[], start: number, end: number): number {
  const pts = curve.filter((p) => p.t >= start && p.t < end);
  return pts.length > 0 ? pts.reduce((a, p) => a + p.v, 0) / pts.length : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/understanding/ && npx tsc --noEmit`
Expected: all passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/understanding/assemble.ts tests/understanding/assemble.test.ts
git commit -m "feat(understanding): assembly — seam merge, edge remap, importance fusion (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Engine — chunk loop, cache, fail-soft

**Files:**
- Create: `src/understanding/engine.ts`
- Test: `tests/understanding/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5 (`UNDERSTAND_SCHEMA`, `understandingPrompt`, `normalizeUnderstandingRaw`, `validateScenes`, `validateEdges`, `assembleUnderstanding`, `ChunkUnderstanding`, `AssembleSignals`); `normalizeArcRaw`/`validateArc` from `src/analysis/arcTypes.js`; `AskVisionFn`/`askVisionJson` from `src/broll/llmJson.js`; `TranscriptChunk` from arcChunker.
- Produces (Task 11 calls this): `runUnderstanding(chunks: TranscriptChunk[], evidenceFor: (c: TranscriptChunk) => string, digestFor: (c: TranscriptChunk) => string, signals: AssembleSignals, opts: UnderstandOpts): Promise<UnderstandingResult>` with `interface UnderstandOpts { cachePath: string; durationSec: number; mode: ContentMode; maxSpanSec?: number; provider: string; ask?: AskVisionFn }`. Cache shape `{ chunks: Record<key, { arcs: ArcLabel[]; scenes: Omit<SceneNode,'id'>[]; edges: StoryEdge[] }> }`, key `"${chunk.start}-${chunk.end}"`, incremental writes, failed chunks NOT cached — the exact mineArcs mechanics.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/understanding/engine.test.ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runUnderstanding } from '../../src/understanding/engine.js';

const CHUNKS = [
  { start: 0, end: 540, segments: [{ start: 1, end: 4, text: 'hello', words: [] }] },
  { start: 480, end: 1020, segments: [{ start: 500, end: 504, text: 'world', words: [] }] },
] as never[];
const SIG = { rms: [], motion: [], events: [], durationSec: 1000, useSceneTerm: true };
const GOOD = {
  arcs: [], edges: [],
  scenes: [{ span: { start: 0, end: 30 }, label: 'intro chat', participants: [], goal: 'g', emotion: 'e', events: [], importance: 0.7 }],
};

describe('runUnderstanding', () => {
  it('asks once per chunk, validates, assembles, and caches incrementally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'und-'));
    const cachePath = join(dir, 'layer_understanding_test.json');
    let calls = 0;
    const u = await runUnderstanding(CHUNKS, () => 'ev', () => '', SIG, {
      cachePath, durationSec: 1000, mode: 'clippies', provider: 'gemini',
      ask: async () => { calls++; return GOOD; },
    });
    expect(calls).toBe(2);
    expect(u.scenes.length).toBeGreaterThan(0);
    expect(u.provider).toBe('gemini');
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(Object.keys(cache.chunks)).toEqual(['0-540', '480-1020']);

    // second run: cache hit, zero calls
    const u2 = await runUnderstanding(CHUNKS, () => 'ev', () => '', SIG, {
      cachePath, durationSec: 1000, mode: 'clippies', provider: 'gemini',
      ask: async () => { throw new Error('must not be called'); },
    });
    expect(u2.scenes.length).toBe(u.scenes.length);
  });

  it('a throwing chunk is skipped and NOT cached (retry next run)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'und-'));
    const cachePath = join(dir, 'layer_understanding_test.json');
    let n = 0;
    const u = await runUnderstanding(CHUNKS, () => 'ev', () => '', SIG, {
      cachePath, durationSec: 1000, mode: 'clippies', provider: 'gemini',
      ask: async () => { n++; if (n === 1) throw new Error('429'); return GOOD; },
    });
    expect(u.scenes.length).toBeGreaterThan(0);          // chunk 2 still contributed
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(Object.keys(cache.chunks)).toEqual(['480-1020']);
  });

  it("provider 'none' makes zero LLM calls and returns a heuristic result", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'und-'));
    const u = await runUnderstanding(CHUNKS, () => 'ev', () => '', { ...SIG, useSceneTerm: false }, {
      cachePath: join(dir, 'c.json'), durationSec: 1000, mode: 'clippies', provider: 'none',
      ask: async () => { throw new Error('must not be called'); },
    });
    expect(u.arcs).toEqual([]);
    expect(u.edges).toEqual([]);
    expect(u.importance.length).toBe(1001);
    expect(u.provider).toBe('none');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/understanding/engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/understanding/engine.ts
/**
 * Understanding engine (SP2) — supersedes mineArcs: one unified LLM call per
 * transcript chunk (arcs + scenes + edges), per-chunk incremental cache, and
 * per-chunk fail-soft (failed chunks are NOT cached so re-runs retry them).
 * provider 'none' → zero LLM calls, heuristic curve only (spec §6 rows 3-4).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { askVisionJson, type AskVisionFn } from '../broll/llmJson.js';
import { normalizeArcRaw, validateArc } from '../analysis/arcTypes.js';
import type { TranscriptChunk } from '../analysis/arcChunker.js';
import type { ContentMode } from '../modes.js';
import type { ArcLabel } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { UNDERSTAND_SCHEMA, type SceneNode, type StoryEdge, type UnderstandingResult } from './types.js';
import { understandingPrompt } from './prompt.js';
import { normalizeUnderstandingRaw } from './normalize.js';
import { validateEdges, validateScenes } from './validate.js';
import { assembleUnderstanding, type AssembleSignals, type ChunkUnderstanding } from './assemble.js';

interface CacheEntry { arcs: ArcLabel[]; scenes: Omit<SceneNode, 'id'>[]; edges: StoryEdge[]; }
interface UnderstandingCache { chunks: Record<string, CacheEntry>; }

async function loadCache(path: string): Promise<UnderstandingCache> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    if (j && typeof j.chunks === 'object') return j as UnderstandingCache;
  } catch { /* cold */ }
  return { chunks: {} };
}

export interface UnderstandOpts {
  cachePath: string;
  durationSec: number;
  mode: ContentMode;
  maxSpanSec?: number;
  provider: string;                // 'claude' | 'gemini' | 'none'
  /** Test seam; default askVisionJson (text-only here). */
  ask?: AskVisionFn;
}

export async function runUnderstanding(
  chunks: TranscriptChunk[],
  evidenceFor: (c: TranscriptChunk) => string,
  digestFor: (c: TranscriptChunk) => string,
  signals: AssembleSignals,
  opts: UnderstandOpts,
): Promise<UnderstandingResult> {
  if (opts.provider === 'none') {
    return assembleUnderstanding([], { ...signals, useSceneTerm: false }, 'none');
  }

  const ask = opts.ask ?? askVisionJson;
  const cache = await loadCache(opts.cachePath);
  const done: ChunkUnderstanding[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.start}-${chunk.end}`;
    let entry = cache.chunks[key];
    if (!entry) {
      let raw: unknown;
      try {
        raw = await ask({
          system: 'You are a top YouTube Shorts story editor. You find complete micro-stories, coherent scenes, and the narrative threads between them.',
          prompt: understandingPrompt(chunk, evidenceFor(chunk), digestFor(chunk), opts.mode, opts.maxSpanSec),
          schema: UNDERSTAND_SCHEMA as unknown as Record<string, unknown>,
          label: `understand ${key}`,
        });
      } catch (e) {
        logger.warn(`[understand ${key}] chunk failed (${e instanceof Error ? e.message : String(e)}) — will retry next run`);
        continue;                                        // NOT cached → retryable
      }
      const norm = normalizeUnderstandingRaw(raw);
      const arcs = norm.arcs.map((a) => validateArc(normalizeArcRaw(a), opts.durationSec)).filter((a): a is ArcLabel => a !== null);
      const scenes = validateScenes(norm.scenes, { start: chunk.start, end: Math.min(chunk.end, opts.durationSec) });
      const edges = validateEdges(norm.edges, scenes.length, arcs.length);
      entry = { arcs, scenes, edges };
      cache.chunks[key] = entry;
      await mkdir(dirname(opts.cachePath), { recursive: true });
      await writeFile(opts.cachePath, JSON.stringify(cache, null, 2));   // incremental
    }
    done.push({ chunkKey: key, chunkSpan: { start: chunk.start, end: chunk.end }, ...entry });
  }
  return assembleUnderstanding(done, signals, opts.provider);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/understanding/ && npx tsc --noEmit`
Expected: all passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/understanding/engine.ts tests/understanding/engine.test.ts
git commit -m "feat(understanding): engine — unified per-chunk pass with cache + fail-soft (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Ranker — sort-only importance boost

**Files:**
- Modify: `src/clipDetection/ranker.ts` (the `rank` function, ~lines 64-81)
- Test: `tests/clipDetection/ranker.test.ts` (extend — read the file first, reuse its fixtures)

**Interfaces:**
- Consumes: `meanImportance01`, `ImportancePoint` (via `IMPORTANCE_SORT_WEIGHT` too) from `src/understanding/assemble.js` / `types.js`.
- Produces: `rank(candidates, segments, opts, semantic)` where `opts` gains optional `importance?: ImportancePoint[]`. `adjusted` gains `+ IMPORTANCE_SORT_WEIGHT * meanImportance01(opts.importance ?? [], cand.start, cand.end)`. Absent/empty curve → term is 0 → **bit-identical output** (identity test required). `composite_score` reporting unchanged (sort-only).

- [ ] **Step 1: Write the failing tests** (adapt to the existing test file's candidate fixtures)

```ts
it('importance boost is sort-only and identity when absent', () => {
  const candidates = [
    { start: 0, end: 20, composite: 5.0, triggerScore: 3, audioScore: 2 },
    { start: 100, end: 120, composite: 5.2, triggerScore: 3, audioScore: 2 },
  ];
  const segs = [
    { start: 0, end: 20, text: 'alpha bravo charlie', words: [] },
    { start: 100, end: 120, text: 'delta echo foxtrot', words: [] },
  ];
  const base = rank(candidates as never, segs as never, { top: 2 });
  // hot curve over the FIRST (lower-composite) candidate flips the order
  const curve = Array.from({ length: 21 }, (_, t) => ({ t, v: 1 }));
  const boosted = rank(candidates as never, segs as never, { top: 2, importance: curve });
  expect(base[0].start).toBe(100);
  expect(boosted[0].start).toBe(0);
  // composite reporting untouched by the boost
  expect(boosted.find((c) => c.start === 0)!.composite_score).toBe(base.find((c) => c.start === 0)!.composite_score);
  // identity: no curve / empty curve → identical result object
  expect(rank(candidates as never, segs as never, { top: 2, importance: [] })).toEqual(base);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/clipDetection/ranker.test.ts`
Expected: FAIL — `importance` not accepted / order unchanged.

- [ ] **Step 3: Implement**

In `src/clipDetection/ranker.ts`: add imports and extend `rank`:

```ts
import { meanImportance01 } from '../understanding/assemble.js';
import { IMPORTANCE_SORT_WEIGHT, type ImportancePoint } from '../understanding/types.js';
```

`rank` opts type gains `importance?: ImportancePoint[]`; the `adjusted` expression becomes:

```ts
      const adjusted = arcWeightedComposite(cand.composite, cand.arc)
        + priorityBoost(sw, opts.priorities)
        - FILLER_PENALTY_WEIGHT * fillerRatio(text)
        // SP2: understanding importance — sort-only like the mode boost; composite untouched.
        + IMPORTANCE_SORT_WEIGHT * meanImportance01(opts.importance ?? [], cand.start, cand.end);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/clipDetection/ && npx tsc --noEmit`
Expected: all passed (existing ranker tests untouched), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/clipDetection/ranker.ts tests/clipDetection/ranker.test.ts
git commit -m "feat(director): sort-only importance boost in the ranker (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Completion prompt gains understanding context

**Files:**
- Create: `src/understanding/context.ts`
- Modify: `src/analysis/arcCompleter.ts` (`completionPrompt` opts + `CompleteArcOpts` + `completeArc` passthrough)
- Test: `tests/understanding/context.test.ts`; extend `tests/analysis/arcCompleter.test.ts` (read it first)

**Interfaces:**
- Consumes: `UnderstandingResult`, `SceneNode`, `StoryEdge` from Task 1; `ArcSpan`.
- Produces: `renderUnderstandingContext(u: UnderstandingResult | null, window: ArcSpan): string` — '' when null/nothing overlaps; scenes overlapping the window (≤6 lines `[a-b] label — goal (emotion)`) then edges touching those scene ids or any arc (≤6 lines `sc2 -pays_off-> sc3 (0.80)`); total ≤12 lines. `completionPrompt` opts and `CompleteArcOpts` gain `understanding?: string`, injected as a `STORY CONTEXT (scene graph):` section when non-empty. Empty/absent → prompt byte-identical to today (identity assertion).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/understanding/context.test.ts
import { describe, expect, it } from 'vitest';
import { renderUnderstandingContext } from '../../src/understanding/context.js';

const U = {
  provider: 'gemini', arcs: [], importance: [],
  scenes: [
    { id: 'sc0', span: { start: 0, end: 30 }, label: 'gym bet', participants: [], goal: 'win bet', emotion: 'hype', events: [], importance: 0.8 },
    { id: 'sc1', span: { start: 30, end: 60 }, label: 'reaction', participants: [], goal: 'celebrate', emotion: 'joy', events: [], importance: 0.9 },
    { id: 'sc2', span: { start: 200, end: 260 }, label: 'far away', participants: [], goal: '', emotion: '', events: [], importance: 0.1 },
  ],
  edges: [
    { from: 'sc0', to: 'sc1', type: 'pays_off' as const, confidence: 0.8 },
    { from: 'sc2', to: 'sc0', type: 'callback' as const, confidence: 0.9 },
  ],
};

describe('renderUnderstandingContext', () => {
  it('renders overlapping scenes and their edges, skipping far scenes', () => {
    const s = renderUnderstandingContext(U as never, { start: 10, end: 50 });
    expect(s).toContain('[0.0-30.0] gym bet — win bet (hype)');
    expect(s).toContain('sc0 -pays_off-> sc1 (0.80)');
    expect(s).not.toContain('far away');
    expect(s).toContain('sc2 -callback-> sc0 (0.90)');   // edge touches an overlapping scene
    expect(s.split('\n').length).toBeLessThanOrEqual(12);
  });
  it('returns empty string for null or non-overlapping understanding', () => {
    expect(renderUnderstandingContext(null, { start: 0, end: 10 })).toBe('');
    expect(renderUnderstandingContext(U as never, { start: 500, end: 520 })).toBe('');
  });
});
```

And in the arcCompleter test file:

```ts
it('completionPrompt includes STORY CONTEXT only when understanding text is provided', () => {
  const base = { window: { start: 0, end: 30 }, contextSegments: [], evidence: 'e', mode: 'clippies' as const, hasImages: false };
  const without = completionPrompt(base);
  const withCtx = completionPrompt({ ...base, understanding: 'sc0 -pays_off-> sc1 (0.80)' });
  expect(without).not.toContain('STORY CONTEXT');
  expect(withCtx).toContain('STORY CONTEXT (scene graph):');
  expect(withCtx).toContain('sc0 -pays_off-> sc1 (0.80)');
  // identity: undefined understanding produces the exact same prompt as before this change
  expect(completionPrompt({ ...base, understanding: undefined })).toBe(without);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/understanding/context.test.ts tests/analysis/arcCompleter.test.ts`
Expected: FAIL — module/param missing.

- [ ] **Step 3: Implement**

```ts
// src/understanding/context.ts
/** PURE: ≤12-line scene-graph context for the arc-completion prompt — evidence,
 *  never policy (the 6/6 gate is unchanged). */
import type { ArcSpan } from '../types/index.js';
import type { UnderstandingResult } from './types.js';

const MAX_SCENE_LINES = 6;
const MAX_EDGE_LINES = 6;

export function renderUnderstandingContext(u: UnderstandingResult | null, window: ArcSpan): string {
  if (!u) return '';
  const scenes = u.scenes.filter((s) => s.span.end > window.start && s.span.start < window.end).slice(0, MAX_SCENE_LINES);
  if (scenes.length === 0) return '';
  const ids = new Set(scenes.map((s) => s.id));
  const edges = u.edges
    .filter((e) => ids.has(e.from) || ids.has(e.to) || e.from.startsWith('arc') || e.to.startsWith('arc'))
    .slice(0, MAX_EDGE_LINES);
  const lines = scenes.map((s) =>
    `[${s.span.start.toFixed(1)}-${s.span.end.toFixed(1)}] ${s.label}${s.goal ? ` — ${s.goal}` : ''}${s.emotion ? ` (${s.emotion})` : ''}`);
  for (const e of edges) lines.push(`${e.from} -${e.type}-> ${e.to} (${e.confidence.toFixed(2)})`);
  return lines.join('\n');
}
```

In `src/analysis/arcCompleter.ts`:
- `completionPrompt` opts gain `understanding?: string`; insert AFTER the `priorArc` spread line (order matters for the identity assertion — appended sections only):

```ts
    ...(opts.priorArc ? ['', `A previous pass suggested: ${JSON.stringify(opts.priorArc.components)}`] : []),
    ...(opts.understanding && opts.understanding.trim() !== ''
      ? ['', 'STORY CONTEXT (scene graph):', opts.understanding] : []),
```

- `CompleteArcOpts` gains `understanding?: string`; `completeArc` passes `understanding: opts.understanding` into `completionPrompt`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/understanding/ tests/analysis/ && npx tsc --noEmit`
Expected: all passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/understanding/context.ts src/analysis/arcCompleter.ts tests/understanding/context.test.ts tests/analysis/arcCompleter.test.ts
git commit -m "feat(understanding): scene-graph context feeds the arc-completion prompt (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: AVSS — importance in the attention curve

**Files:**
- Modify: `src/avss/editPlan.ts` (`SourceSignals` + `buildSourceSignals`)
- Modify: `src/avss/simulator.ts` (`attentionCurve`)
- Test: extend `tests/avss/editPlan.test.ts` and `tests/avss/simulator.test.ts` (read both first, reuse fixtures)

**Interfaces:**
- Consumes: `ImportancePoint` from `src/understanding/types.js`.
- Produces: `SourceSignals` gains `importance?: ImportancePoint[]` (clip-relative); `buildSourceSignals(clip, words, audio, semantic, reactionEvents?, importance?)` — new FINAL optional param, included in the return. `attentionCurve` adds `IMPORTANCE_ATTENTION_WEIGHT (0.15) × (importanceAt(signals, t) − 0.5)` inside the existing `clamp01(...)`, only when `signals.importance` is non-empty. Absent → **bit-identical simulation** (identity test).

- [ ] **Step 1: Write the failing tests**

In `tests/avss/simulator.test.ts` (adapt fixture names to the file):

```ts
it('importance lifts attention inside high-importance spans and is identity when absent', () => {
  const hot = { ...baseSignals, importance: Array.from({ length: 60 }, (_, t) => ({ t, v: 1 })) };
  const cold = { ...baseSignals, importance: Array.from({ length: 60 }, (_, t) => ({ t, v: 0 })) };
  const simHot = simulate(basePlan, hot);
  const simCold = simulate(basePlan, cold);
  const meanA = (s: { attention: { v: number }[] }) => s.attention.reduce((a, p) => a + p.v, 0) / s.attention.length;
  expect(meanA(simHot)).toBeGreaterThan(meanA(simCold));
  // identity
  expect(simulate(basePlan, baseSignals)).toEqual(simulate(basePlan, { ...baseSignals, importance: undefined }));
});
```

In `tests/avss/editPlan.test.ts`:

```ts
it('buildSourceSignals threads importance through as the final optional param', () => {
  const signals = buildSourceSignals(clip, words, audio, semantic, undefined, [{ t: 0, v: 0.9 }]);
  expect(signals.importance).toEqual([{ t: 0, v: 0.9 }]);
  expect(buildSourceSignals(clip, words, audio, semantic).importance).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/avss/`
Expected: FAIL — param/field missing, attention unchanged.

- [ ] **Step 3: Implement**

`src/avss/editPlan.ts`:

```ts
import type { ImportancePoint } from '../understanding/types.js';
```

`SourceSignals` gains:

```ts
  /** SP2 understanding importance (clip-relative, 1s grid); absent when understanding is off. */
  importance?: ImportancePoint[];
```

`buildSourceSignals` signature gains the final param `importance?: ImportancePoint[]` and the return object gains `importance,`.

`src/avss/simulator.ts` — add near the other helpers:

```ts
// SP2: understanding importance nudges attention (evidence, small weight — the proxies stay primary).
const IMPORTANCE_ATTENTION_WEIGHT = 0.15;

function importanceAt(signals: SourceSignals, t: number): number {
  const curve = signals.importance!;
  let best = curve[0];
  for (const p of curve) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best.v;
}
```

In `attentionCurve`, the returned value becomes:

```ts
    const imp = signals.importance && signals.importance.length > 0
      ? IMPORTANCE_ATTENTION_WEIGHT * (importanceAt(signals, t) - 0.5) : 0;
    const v = clamp01(0.35 + 0.3 * wordsPerSecAt(signals, t) + 0.35 * rmsAt(signals, t) + boost - stale + imp);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/avss/ && npx tsc --noEmit`
Expected: all passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/avss/editPlan.ts src/avss/simulator.ts tests/avss/editPlan.test.ts tests/avss/simulator.test.ts
git commit -m "feat(avss): understanding importance nudges the attention curve (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Perception default-ON + overlapped launch + CLI flag pair

**Files:**
- Modify: `src/perception/perceptionClient.ts` (add `perceptionEnabled`)
- Modify: `src/cli/index.ts:43` (flag pair)
- Modify: `src/cli/commands/all.ts` (launch/await split; ~lines 145-147 option doc, 252-259 the current block)
- Test: `tests/perception/resolvePerception.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `perceptionEnabled(flag: boolean | undefined, env: NodeJS.ProcessEnv): boolean` — `PERCEPTION=0` → false; `PERCEPTION=1` → true; else `flag !== false`. In `all.ts`, the perception block moves: a `perceptionPromise` is created right after `extractMetadata` (unawaited), and `const perception = await perceptionPromise;` happens where the old block sat is REMOVED — the await moves to just before the understanding pass (Task 11 places it; in THIS task, await it at the same place the old block was, keeping behavior identical except the launch point — Task 11 then moves the await down). CLI declares BOTH `--perception` (force on, back-compat) and `--no-perception`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/perception/resolvePerception.test.ts
import { perceptionEnabled } from '../../src/perception/perceptionClient.js';

describe('perceptionEnabled', () => {
  it('defaults ON', () => {
    expect(perceptionEnabled(undefined, {})).toBe(true);
    expect(perceptionEnabled(true, {})).toBe(true);
  });
  it('--no-perception turns it off', () => {
    expect(perceptionEnabled(false, {})).toBe(false);
  });
  it('PERCEPTION env wins in both directions', () => {
    expect(perceptionEnabled(undefined, { PERCEPTION: '0' })).toBe(false);
    expect(perceptionEnabled(false, { PERCEPTION: '1' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/perception/resolvePerception.test.ts`
Expected: FAIL — `perceptionEnabled` not exported.

- [ ] **Step 3: Implement**

Append to `src/perception/perceptionClient.ts`:

```ts
/** SP2: perception is ON by default (understanding consumes it). PERCEPTION=0/1
 *  overrides in either direction; otherwise only an explicit --no-perception disables. */
export function perceptionEnabled(flag: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  if (env.PERCEPTION === '0') return false;
  if (env.PERCEPTION === '1') return true;
  return flag !== false;
}
```

`src/cli/index.ts` line 43 becomes the pair:

```ts
    .option('--perception', 'force the perception pass on (default: on; cached per source)')
    .option('--no-perception', 'skip the perception pass (semantic timeline + understanding digest)')
```

`src/cli/commands/all.ts`:
- Update the `AllOptions.perception` doc comment: `/** Perception pass (semantic timeline). ON by default (SP2 understanding consumes it); --no-perception or PERCEPTION=0 disables. */`
- Replace the block at ~252-259: immediately after the `sp.succeed('Downloaded: …')` line add:

```ts
  // SP2: perception is ON by default and launched in the BACKGROUND — the understanding
  // pass awaits it later, hidden behind transcript/semantic work (the Phase-1a lesson:
  // never block the critical path with a silent multi-second ffmpeg pass).
  const perceptionPromise = resolvePerception(
    perceptionEnabled(opts.perception, process.env), dl.videoPath, jobId, new SubprocessPerceptionClient(),
  );
```

- Where the old block sat (after transcript), replace it with `const perception = await perceptionPromise;` (Task 11 moves this await below the semantic pass; keeping it here in Task 10 keeps the diff reviewable and behavior identical).
- Import `perceptionEnabled` alongside `resolvePerception`.

- [ ] **Step 4: Run the gates + a live no-LLM sanity run**

Run: `npx vitest run tests/perception/ && npx tsc --noEmit`
Expected: all passed, tsc clean.
Run: `SEMANTIC_PROVIDER=none PERCEPTION=0 node dist/cli/index.js all <any cached local file under workspace/downloads> --top 1 --allow-repeats` after `npm run build`
Expected: runs exactly as before (no perception line).

- [ ] **Step 5: Commit**

```bash
git add src/perception/perceptionClient.ts src/cli/index.ts src/cli/commands/all.ts tests/perception/resolvePerception.test.ts
git commit -m "feat(perception): default ON, background launch, --no-perception flag (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Pipeline wiring — understanding pass, consumers, exports

**Files:**
- Modify: `src/cli/commands/all.ts` (mining block ~289-321, rank call ~430, completion call ~475, AVSS call ~634, writeExports calls ~850-852, analysis-result type)
- Modify: `src/export/exporter.ts` (`writeExports`, `buildClipJson`, `buildManifest`)
- Modify: `src/analysis/arcMiner.ts` (delete `mineArcs` + its cache internals; KEEP `MODE_VOCAB`, `ARC_MINE_SCHEMA`, `miningPrompt` deleted too if unreferenced, `overlapFraction`, `mergeMinedCandidates`)
- Test: `tests/export/exporter.test.ts` (extend, read first); existing arc-flow tests that stubbed `mineArcs` get pointed at the engine seam (read `tests/cli/` and `tests/analysis/` hits for `mineArcs` first)

**Interfaces:**
- Consumes: `runUnderstanding` (Task 6), `buildPerceptionDigest` (Task 2), `renderUnderstandingContext` (Task 8), `sliceImportance` (Task 5), `UnderstandingResult`.
- Produces: analysis result gains `understanding: UnderstandingResult | null` (add beside the existing `perception` field in the same type); `writeExports(..., selectionByClip?, understandingByClip?, manifestUnderstanding?)` — two NEW trailing params: `understandingByClip?: Map<string, UnderstandingExport>` with `export interface UnderstandingExport { scene_labels: string[]; edge_types: string[] }` and `manifestUnderstanding?: { scenes: number; edges: number; provider: string }`; `buildClipJson` writes an `understanding` block when present; `buildManifest` writes a top-level `understanding` object when present.

- [ ] **Step 1: Rewire analyzeVideo (the mining block, ~lines 289-321) — code:**

```ts
  // Move the perception await here (from Task 10's placement): the digest needs it,
  // and by now transcript+triggers+semantic have hidden the pass's wall time.
  const perception = await perceptionPromise;

  // SP2 understanding pass (supersedes arc mining): one unified LLM call per chunk
  // returns arcs + scenes + edges; importance fused in pure Node. Fail-soft per chunk.
  let understanding: UnderstandingResult | null = null;
  let arcCandidates = candidates;
  let motion: { time: number; v: number }[] = [];
  if (chosen !== 'none') {
    sp = ora('Understanding pass (scenes + stories + importance)…').start();
    try {
      motion = await motionLayer(dl.videoPath, join(dirs.analysis, 'layer_motion.json'));
      understanding = await runUnderstanding(
        chunkTranscript(segments),
        (c) => buildEvidenceBlock({
          window: { start: c.start, end: c.end },
          rms: toCurve(audio), motion, silences: audio.silence_regions,
        }),
        (c) => buildPerceptionDigest(perception, { start: c.start, end: c.end }),
        { rms: toCurve(audio), motion, events: perception?.audio_events ?? [],
          durationSec: meta.duration, useSceneTerm: true },
        { cachePath: join(dirs.analysis, `layer_understanding_${chosen}.json`),
          durationSec: meta.duration, mode: profile.name,
          maxSpanSec: profile.lengths.max, provider: chosen },
      );
      arcCandidates = mergeMinedCandidates(candidates, understanding.arcs);
      sp.succeed(`understanding: ${understanding.scenes.length} scenes, ${understanding.edges.length} edges, `
        + `${understanding.arcs.length} arcs, importance ready (${understanding.provider})`);
    } catch (e) {
      sp.warn(`understanding unavailable (${e instanceof Error ? e.message : String(e)}) — scorer candidates only`);
    }
  } else {
    logger.warn('understanding OFF — no LLM provider (SEMANTIC_PROVIDER/keys); story gate disabled, pipeline runs as before');
    understanding = await runUnderstanding([], () => '', () => '',
      { rms: toCurve(audio), motion: [], events: perception?.audio_events ?? [],
        durationSec: meta.duration, useSceneTerm: false },
      { cachePath: join(dirs.analysis, 'layer_understanding_none.json'),
        durationSec: meta.duration, mode: profile.name, provider: 'none' });
  }
```

…and the return line gains `understanding`:

```ts
  return { jobId, url, videoPath: dl.videoPath, meta, segments, triggers, audio, semantic, candidates: finalCandidates, mode: profile.name, motion, perception, understanding };
```

(The Slice E `generateArcTemplateCandidates` call between these stays exactly where it is, operating on `arcCandidates`.) Add `understanding: UnderstandingResult | null` beside `perception` in the analysis-result type (find it by grepping the type that declares `perception` in `all.ts` / `src/types`).

- [ ] **Step 2: Wire the three consumers — code:**

Rank call (~430):

```ts
    const ranked = rank(candidates, analysis.segments, {
      top: Infinity, minScore: opts.minScore, priorities: MODE_PROFILES[analysis.mode].priorities,
      importance: analysis.understanding?.importance,
    }, analysis.semantic);
```

Completion call (~475) gains:

```ts
        understanding: renderUnderstandingContext(source.understanding ?? null, window),
```

AVSS call (~634) gains the final param:

```ts
      const signals = buildSourceSignals(
        clip, captionWords, source.audio, source.semantic,
        clipReactionEvents(source.perception?.audio_events ?? [], clip.start, clip.end),
        sliceImportance(source.understanding?.importance ?? [], clip.start, clip.end),
      );
```

- [ ] **Step 3: Exports — code:**

In `src/export/exporter.ts`:

```ts
export interface UnderstandingExport { scene_labels: string[]; edge_types: string[]; }
```

`writeExports` gains trailing `understandingByClip?: Map<string, UnderstandingExport>, manifestUnderstanding?: { scenes: number; edges: number; provider: string }`; `buildClipJson` gains `understanding?: UnderstandingExport` (spread `...(understanding ? { understanding } : {})` into the clip JSON); `buildManifest` gains `manifestUnderstanding` (spread `...(manifestUnderstanding ? { understanding: manifestUnderstanding } : {})`).

In `all.ts`, before the `writeExports` calls, build the map for the selected clips:

```ts
  const understandingByClip = new Map<string, UnderstandingExport>();
  for (const { clip, source } of selected) {
    const u = source.understanding;
    if (!u) continue;
    const overlapping = u.scenes.filter((s) => s.span.end > clip.start && s.span.start < clip.end);
    const ids = new Set(overlapping.map((s) => s.id));
    understandingByClip.set(clip.clip_id, {
      scene_labels: [...new Set(overlapping.map((s) => s.label))].slice(0, 6),
      edge_types: [...new Set(u.edges.filter((e) => ids.has(e.from) || ids.has(e.to)).map((e) => e.type))],
    });
  }
  const manifestUnderstanding = primary.understanding
    ? { scenes: primary.understanding.scenes.length, edges: primary.understanding.edges.length, provider: primary.understanding.provider }
    : undefined;
```

…and both `writeExports` call sites (top-level and `below_retention/`) gain `, understandingByClip, manifestUnderstanding` as trailing args.

- [ ] **Step 4: Retire `mineArcs`**

Delete `mineArcs`, `loadCache`, `MineOpts`, and `miningPrompt` from `src/analysis/arcMiner.ts` (keep `MODE_VOCAB`, `ARC_MINE_SCHEMA`, `SPAN_SCHEMA`, `overlapFraction`, `mergeMinedCandidates`). Grep for remaining references first: `grep -rn "mineArcs\|miningPrompt" src/ tests/` — update any test that imported them to target `runUnderstanding`/`understandingPrompt` equivalents (the miner's own prompt/flow tests move to the understanding suite; keep `mergeMinedCandidates` tests as-is).

- [ ] **Step 5: Extend exporter tests**

```ts
it('clip.json carries the understanding block and manifest carries counts when provided', async () => {
  // reuse the file's existing writeExports fixture; add:
  const uMap = new Map([[clip.clip_id, { scene_labels: ['gym bet'], edge_types: ['pays_off'] }]]);
  await writeExports(dir, 'job', 'url', meta, [clip], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, uMap, { scenes: 3, edges: 2, provider: 'gemini' });
  const clipJson = JSON.parse(readFileSync(join(dir, `${clip.clip_id}.json`), 'utf8'));
  expect(clipJson.understanding).toEqual({ scene_labels: ['gym bet'], edge_types: ['pays_off'] });
  const manifest = JSON.parse(readFileSync(join(dir, 'clips_manifest.json'), 'utf8'));
  expect(manifest.understanding).toEqual({ scenes: 3, edges: 2, provider: 'gemini' });
});
```

(Adapt argument positions to the file's real fixture style — the two new params are strictly trailing.)

- [ ] **Step 6: Run the FULL gates**

Run: `npx vitest run && npx tsc --noEmit && (cd remotion && npx tsc --noEmit)`
Expected: full suite green, both tsc clean. This task is the integration point — expect and fix fallout from retired `mineArcs` imports here, nowhere else.

- [ ] **Step 7: Commit**

```bash
git add -A src/ tests/
git commit -m "feat(understanding): pipeline wiring — unified pass replaces arc mining, consumers + exports (SP2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Live smoke + budget parity (Gemini)

**Files:** none expected (fix-forward commits allowed).

> Needs a `GEMINI_API_KEY`/`GEMINI_API_KEYS` in `.env` (free tier fine — the pass costs the same request count as the old arc mining). Prefer a video with cached transcript, e.g. `workspace/downloads/H14bBuluwB8` (372s talk) or the user's `7MP0pnAgC4g`.

- [ ] **Step 1:** `npm run build`, then:
`SEMANTIC_PROVIDER=gemini node dist/cli/index.js all <cached source URL or local path> --top 1 --allow-repeats`
Expected: run-log shows the perception line AFTER transcript work (background launch), then `understanding: N scenes, M edges, K arcs, importance ready (gemini)`; export completes exit 0.
- [ ] **Step 2:** Inspect `workspace/analysis/<jobId>/layer_understanding_gemini.json`: scene labels are natural phrases (no `unlabeled` flood), ≥1 edge on story content, importance curve non-flat (`max(v) − min(v) ≥ 0.1`).
- [ ] **Step 3:** Budget parity: count `understand <key>` log lines = chunk count (same as the old `arc-mine` count for the same video); completion (`arc-complete`) call count unchanged.
- [ ] **Step 4:** Re-run the same command → understanding cache hit (zero `understand` calls), identical scene/edge counts.
- [ ] **Step 5:** Degradation spot-checks: `SEMANTIC_PROVIDER=none …` → no LLM calls, pipeline exports as pre-SP2 (no gate), no crash; `… --no-perception` → understanding runs, digest empty, no audience term (curve still present); `PERCEPTION=0` equivalent.
- [ ] **Step 6:** Verify `clip.json` has the `understanding` block, manifest has counts, GUI run (if the dev server is up) shows no post-download stall.
- [ ] **Step 7:** Record scene/edge counts + wall times in the final commit message; commit any fixes as `fix(understanding): …`.

---

## Self-Review Notes (done at plan time)

- **Spec coverage:** §1 contract → Task 1; §2 digest/prompt/normalize/validate/assemble/engine → Tasks 2-6; §3 fusion+degrades → Task 5 (weights, renormalization, p95, moving average); §4 consumers 1-4 → Tasks 7, 8, 9, 11(exports); §5 gate flip + overlap → Task 10 (+await move in Task 11); §6 matrix → engine `none` path (Task 6) + smoke Step 5; §7 tests → per-task + Task 12 (incl. budget parity).
- **Type consistency:** `ImportancePoint {t,v}` used by ranker/AVSS/assemble; `ChunkUnderstanding`/`AssembleSignals` between Tasks 5-6; `UnderstandingExport` between exporter and all.ts; `understanding?: string` between context.ts/arcCompleter/all.ts; digest signature between Tasks 2/6/11.
- **Known deltas, deliberate:** Task 10 awaits the perception promise at the old location and Task 11 moves it below semantic — keeps each diff reviewable and behavior-identical at every commit. `miningPrompt` is deleted with `mineArcs` since `understandingPrompt` carries its rules verbatim (tests moved, not dropped). The heuristic (`provider none`) path skips `motionLayer` (motion term 0) — spec's degrade rows allow this; noted for the smoke.
- **Cross-cutting risk flagged for the executor:** existing tests import `mineArcs` (grep first in Task 11); the exporter's positional-trailing param count grows to 15 — both call sites in all.ts must be updated together.
