# Montagem Engine v1 + Clippies Full-Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `clipforge montage` — one or more videos + a music track → beat-synced montagem Short (flashes, velocity ramps, drop payoff, live counter, AI payoff frame); plus clippies mode becomes full-screen-only with a `--aspect 9:16|3:4` choice.

**Architecture:** Montage is its own pipeline in `src/montage/` mirroring RankRot (harvest moments → pure planner → dedicated Remotion comp). The music masters the timeline: segments are muted, so per-segment `playbackRate` never desyncs audio. Clippies full-screen = mode-level framing default (`crop`) + an aspect parameter threaded through the existing crop geometry and Remotion comp dims.

**Tech Stack:** TypeScript ESM, ffmpeg via `run()` (NEVER pipe binary through stdout — temp files only), `music-tempo` (new dep, pure JS beat tracking), Gemini via existing key-pool rotation, Remotion, vitest.

## Global Constraints

- **Gemini-first mandate:** every LLM feature must work with only `GEMINI_API_KEYS` set; Claude is a drop-in upgrade, never a dependency. No LLM at all → montage still renders (counter off, real-frame payoff).
- **LLM budget per montage:** max 1 vision call (counter label) + 1 image-gen call (payoff).
- **No Python** (no librosa). Pure Node + ffmpeg.
- `run()` stdout is utf8 — binary data (PCM, images) goes through temp files.
- Remotion props are `type` aliases, not `interface` (Record constraint).
- Remotion default composition dims 1080×1920@30fps; new comps follow RankRotVideo's registration pattern in `remotion/src/Root.tsx`.
- Caption preset changes must be mirrored in the GUI `PRESET_STYLES` (ui) — keep in sync with `src/captions/presets.ts`.
- Fail-soft everywhere: counter/payoff/SEO failures must never fail the render.
- Gates before "done": `npx vitest run` (root), `npx tsc --noEmit` (root + `remotion/`), `npm run build` in `ui/`.
- Commit after every task with the repo's `feat(...)`/`fix(...)` style.

---

### Task 1: Aspect-aware crop geometry

The crop window math hardcodes 9:16 in `clampCropWindow` ([faceTracker.ts:241](src/extraction/faceTracker.ts#L241)). Thread an `aspect` (width/height ratio, default `9/16`) through the whole crop-track path so 3:4 output is possible.

**Files:**
- Modify: `src/extraction/faceTracker.ts`
- Test: `tests/extraction/faceTrackerAspect.test.ts` (new file)

**Interfaces:**
- Consumes: existing `clampCropWindow`, `smoothTrack`, `buildActiveSpeakerTrack`, `centerCropTrack`, `forcedCropTrack`, `smoothTrackSegmented`, `planFraming`, `detectFaceTrack`.
- Produces: same functions with a trailing optional `aspect = 9 / 16` parameter. Exact new signatures later tasks rely on:
  - `centerCropTrack(srcW: number, srcH: number, time = 0, aspect = 9 / 16): CropKeyframe[]`
  - `planFraming(videoPath: string, srcW: number, srcH: number, fps = 3, force?: FramingMode, aspect = 9 / 16): Promise<{...}>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/extraction/faceTrackerAspect.test.ts
import { describe, expect, it } from 'vitest';
import { centerCropTrack, smoothTrack } from '../../src/extraction/faceTracker.js';

describe('aspect-aware crop geometry', () => {
  it('centerCropTrack defaults to 9:16', () => {
    const [k] = centerCropTrack(1920, 1080);
    expect(k.cropH).toBe(1080);
    expect(k.cropW).toBeCloseTo(1080 * (9 / 16), 5);
  });

  it('centerCropTrack builds a 3:4 window when asked', () => {
    const [k] = centerCropTrack(1920, 1080, 0, 3 / 4);
    expect(k.cropH).toBe(1080);
    expect(k.cropW).toBeCloseTo(810, 5);
  });

  it('smoothTrack windows honor the aspect', () => {
    const samples = [0, 1, 2].map((i) => ({
      time: i, box: { x: 900, y: 400, w: 120, h: 160 },
    }));
    const track = smoothTrack(samples, 1920, 1080, 0.15, 3 / 4);
    for (const k of track) expect(k.cropW / k.cropH).toBeCloseTo(3 / 4, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extraction/faceTrackerAspect.test.ts`
Expected: FAIL — the 3:4 cases produce 9:16 windows (cropW ≈ 607.5, not 810).

- [ ] **Step 3: Implement**

In `src/extraction/faceTracker.ts`:

```ts
/** Builds a crop window (default 9:16) from a center + height, clamped fully inside the source. */
function clampCropWindow(
  cx: number, cy: number, cropH: number,
  srcW: number, srcH: number, aspect = 9 / 16,
): { cx: number; cy: number; cropW: number; cropH: number } {
  let h = clamp(cropH, 1, srcH);
  let w = h * aspect;
  if (w > srcW) {
    w = srcW;
    h = clamp(w / aspect, 1, srcH);
  }
  const x = clamp(cx - w / 2, 0, srcW - w);
  const y = clamp(cy - h / 2, 0, srcH - h);
  return { cx: x + w / 2, cy: y + h / 2, cropW: w, cropH: h };
}
```

Then add the trailing `aspect = 9 / 16` param to `smoothTrack`, `buildActiveSpeakerTrack`, `centerCropTrack`, `smoothTrackSegmented`, `forcedCropTrack`, `detectFaceTrack`, and `planFraming`, passing it down to every `clampCropWindow` / `centerCropTrack` / `smoothTrack` / `buildActiveSpeakerTrack` call inside them. `detectFaceTrack`'s existing optional `maxSec` param stays before `aspect`. Update doc comments that say "9:16" to "aspect (default 9:16)".

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/extraction`
Expected: new test PASSES, all existing extraction tests still pass (default preserves 9/16).

- [ ] **Step 5: Commit**

```bash
git add src/extraction/faceTracker.ts tests/extraction/faceTrackerAspect.test.ts
git commit -m "feat(framing): aspect-aware crop geometry — crop windows take a w/h ratio (default 9:16)"
```

---

### Task 2: Clippies full-screen by default (mode-level framing)

User mandate: clippies produces ONLY full-screen video (no blur bars). Mode profiles gain a framing default; `--framing` still overrides.

**Files:**
- Modify: `src/modes.ts`, `src/cli/commands/all.ts` (framing resolution at ~[all.ts:474](src/cli/commands/all.ts#L474))
- Test: `tests/modes.test.ts` (existing mode tests file — if named differently, add to the file that tests `resolveMode`)

**Interfaces:**
- Produces: `ModeProfile.framing?: 'crop' | 'blur'` and
  `resolveFraming(flag: string | undefined, profile: ModeProfile): 'crop' | 'blur' | undefined` (pure, exported from `src/modes.ts`). `undefined` = auto decision.

- [ ] **Step 1: Write the failing test**

```ts
import { MODE_PROFILES, resolveFraming } from '../src/modes.js';

describe('resolveFraming', () => {
  it('explicit flag always wins', () => {
    expect(resolveFraming('blur', MODE_PROFILES.clippies)).toBe('blur');
    expect(resolveFraming('crop', MODE_PROFILES.mindcuts)).toBe('crop');
  });
  it('clippies defaults to full-screen crop', () => {
    expect(resolveFraming('auto', MODE_PROFILES.clippies)).toBe('crop');
    expect(resolveFraming(undefined, MODE_PROFILES.clippies)).toBe('crop');
  });
  it('mindcuts keeps the auto decision', () => {
    expect(resolveFraming('auto', MODE_PROFILES.mindcuts)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/modes.test.ts` → FAIL (`resolveFraming` not exported).

- [ ] **Step 3: Implement**

In `src/modes.ts`: add `framing?: 'crop' | 'blur';` to `ModeProfile` (doc: "Framing default when --framing is auto/absent; undefined = auto decision engine"). Set `framing: 'crop'` on `clippies` only. Add:

```ts
/** PURE: --framing flag + mode profile → forced framing ('crop'|'blur') or undefined (auto). */
export function resolveFraming(flag: string | undefined, profile: ModeProfile): 'crop' | 'blur' | undefined {
  if (flag === 'crop' || flag === 'blur') return flag;
  return profile.framing;
}
```

In `src/cli/commands/all.ts`, replace the inline ternary in the `planFraming` call with:

```ts
const { mode, track, faces } = await planFraming(fullPath, source.meta.width, source.meta.height, 3,
  resolveFraming(opts.framing, profile));
```

(`profile` is already in scope; import `resolveFraming` from `../../modes.js`.)

- [ ] **Step 4: Run tests** — `npx vitest run` → all green. Also `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/modes.ts src/cli/commands/all.ts tests/modes.test.ts
git commit -m "feat(modes): clippies is full-screen by default — mode-level framing default, --framing still overrides"
```

---

### Task 3: `--aspect 9:16|3:4` end to end

**Files:**
- Create: `src/extraction/aspect.ts`
- Modify: `src/cli/index.ts` (all/process/batch options), `src/cli/commands/all.ts`, `src/captions/remotionRenderer.ts`, `src/types/index.ts` (`ClipCompositionProps`), `remotion/src/Root.tsx`, `remotion/src/CaptionedClip.tsx` (only if it hardcodes 1080/1920), `ui/components/import-tab.tsx` + `ui/app/api/run/route.ts` (aspect select → CLI arg)
- Test: `tests/extraction/aspect.test.ts`

**Interfaces:**
- Produces: `aspectDims(flag: string): { outW: number; outH: number; ratio: number }` — `'9:16' → {1080, 1920, 9/16}`, `'3:4' → {1080, 1440, 3/4}`, anything else throws.
- `RenderOpts`/`ClipCompositionProps` gain `outWidth?: number; outHeight?: number`.

- [ ] **Step 1: Failing test**

```ts
// tests/extraction/aspect.test.ts
import { aspectDims } from '../../src/extraction/aspect.js';

it('maps aspect flags to output dims', () => {
  expect(aspectDims('9:16')).toEqual({ outW: 1080, outH: 1920, ratio: 9 / 16 });
  expect(aspectDims('3:4')).toEqual({ outW: 1080, outH: 1440, ratio: 3 / 4 });
  expect(() => aspectDims('4:3')).toThrow(/aspect/);
});
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/extraction/aspect.ts
/** Output geometries for short-form exports. 9:16 = full portrait, 3:4 = tall-but-not-full. */
export function aspectDims(flag: string): { outW: number; outH: number; ratio: number } {
  if (flag === '9:16') return { outW: 1080, outH: 1920, ratio: 9 / 16 };
  if (flag === '3:4') return { outW: 1080, outH: 1440, ratio: 3 / 4 };
  throw new Error(`--aspect must be 9:16 or 3:4 (got "${flag}")`);
}
```

Wire-up (no new tests needed beyond Step 1; covered by tsc + existing suites):
1. `src/cli/index.ts`: add `.option('--aspect <a>', 'output aspect: 9:16 (full portrait) or 3:4', '9:16')` to the `all`, `process`, and `batch` commands; validate via `aspectDims` in the shared option-check block (same place `--framing` is validated) and pass `aspect: o.aspect` into the opts object.
2. `src/cli/commands/all.ts`: `const dims = aspectDims(opts.aspect ?? '9:16');` near the top of the per-clip loop's setup; pass `dims.ratio` as the new `aspect` arg to `planFraming(...)` and `outWidth: dims.outW, outHeight: dims.outH` into `render({...})`.
3. `src/captions/remotionRenderer.ts`: add `outWidth?: number; outHeight?: number` to `RenderOpts`, spread them into props in `buildProps` (same `...(x !== undefined ? {} : {})` pattern as `srcW`).
4. `src/types/index.ts`: add the two optional fields to `ClipCompositionProps`.
5. `remotion/src/Root.tsx` CaptionedClip registration: extend `calculateMetadata` to `({ props }) => ({ durationInFrames: ..., fps: ..., width: props.outWidth ?? 1080, height: props.outHeight ?? 1920 })` and add `outWidth: 1080, outHeight: 1920` to defaultProps. Mirror the fields on the `ClipProps` type in `CaptionedClip.tsx`.
6. `grep -n "1920\|1080" remotion/src/CaptionedClip.tsx` — replace any layout math using literals with `useVideoConfig().width/height` (blur backdrop, caption positioning). If it already uses `useVideoConfig`, no change.
7. GUI: in `ui/components/import-tab.tsx` add an Aspect select (9:16 / 3:4) next to the existing Framing select; thread through `ui/app/api/run/route.ts` → `args.push('--aspect', body.aspect)` (validate against the two literals).

- [ ] **Step 4: Gates**

Run: `npx vitest run && npx tsc --noEmit && (cd remotion && npx tsc --noEmit) && (cd ui && npm run build)`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(framing): --aspect 9:16|3:4 — aspect-aware crop + Remotion dims via calculateMetadata + GUI select"
```

---

### Task 4: Music map — PCM decode, beats, drops, sections

**Files:**
- Create: `src/montage/types.ts`, `src/montage/musicMap.ts`, `src/types/music-tempo.d.ts`
- Modify: `package.json` (dep `music-tempo@^1`)
- Test: `tests/montage/musicMap.test.ts`

**Interfaces (Produces — later tasks import these exactly):**

```ts
// src/montage/types.ts
import type { CurvePoint } from '../rankrot/signals.js';
export interface Drop { time: number; strength: number }
export type SectionKind = 'build' | 'drop' | 'cool';
export interface Section { kind: SectionKind; start: number; end: number }
export interface MusicMap {
  bpm: number; beats: number[]; drops: Drop[];
  energy: CurvePoint[]; sections: Section[]; duration: number;
}
export interface MontageMoment {
  src: string;          // moment FILE path (extracted), not the source video
  start: number;        // always 0 for extracted files; kept for pure-fn testability
  dur: number;
  motionScore: number;  // 0-1 pool-normalized
  audioScore: number;   // 0-1
  cycleEvents: number[]; // times WITHIN the moment file (periodic reps), [] if none
}
export type FlashKind = 'white' | 'red' | 'black' | 'glitch' | 'blur';
export interface MontageSegment {
  src: string; srcStart: number; srcDur: number;
  playbackRate: number; freeze: boolean; zoom: boolean; shake: boolean;
}
export interface FlashEvent { time: number; kind: FlashKind; frames: number }
export interface CounterEvent { time: number; value: number }
export interface MontagePlan {
  segments: MontageSegment[]; flashes: FlashEvent[];
  musicOffset: number;   // seconds into the track where the montage starts
  payoffAt: number; payoffDur: number; totalDur: number;
}
```

```ts
// musicMap.ts exports
export async function decodePcmMono(audioPath: string): Promise<Float32Array>; // 44100 Hz via ffmpeg → temp f32le file
export function detectDrops(bass: CurvePoint[]): Drop[];                        // PURE
export function classifySections(drops: Drop[], duration: number, dropLen?: number): Section[]; // PURE
export async function buildMusicMap(audioPath: string): Promise<MusicMap>;
```

- [ ] **Step 1: Install dep + type stub**

```bash
npm install music-tempo
```

```ts
// src/types/music-tempo.d.ts
declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: Record<string, unknown>);
    tempo: number;    // BPM
    beats: number[];  // beat times in seconds
  }
}
```

- [ ] **Step 2: Failing tests (pure parts)**

```ts
// tests/montage/musicMap.test.ts
import { describe, expect, it } from 'vitest';
import { detectDrops, classifySections } from '../../src/montage/musicMap.js';

const flat = (v: number, n: number, dt = 0.5) =>
  Array.from({ length: n }, (_, i) => ({ time: i * dt, v }));

describe('detectDrops', () => {
  it('finds a bass surge after a dip', () => {
    // 0-10s quiet bass (3), 10-20s loud (8) → one drop at ~10s
    const bass = [...flat(3, 20), ...flat(8, 20).map((p) => ({ ...p, time: p.time + 10 }))];
    const drops = detectDrops(bass);
    expect(drops).toHaveLength(1);
    expect(drops[0].time).toBeGreaterThanOrEqual(9.5);
    expect(drops[0].time).toBeLessThanOrEqual(11);
  });
  it('flat loud bass has no drop', () => {
    expect(detectDrops(flat(8, 60))).toHaveLength(0);
  });
  it('two surges 20s apart are two drops', () => {
    const seg = (v: number, from: number, sec: number) =>
      flat(v, sec * 2).map((p) => ({ ...p, time: p.time + from }));
    const bass = [...seg(3, 0, 10), ...seg(8, 10, 5), ...seg(3, 15, 15), ...seg(8, 30, 5)];
    expect(detectDrops(bass)).toHaveLength(2);
  });
});

describe('classifySections', () => {
  it('build → drop → build → drop → cool', () => {
    const s = classifySections([{ time: 10, strength: 5 }, { time: 30, strength: 4 }], 45);
    expect(s.map((x) => x.kind)).toEqual(['build', 'drop', 'build', 'drop', 'cool']);
    expect(s[1]).toMatchObject({ start: 10, end: 18 });
    expect(s[4].end).toBe(45);
  });
  it('no drops → one build section', () => {
    expect(classifySections([], 30)).toEqual([{ kind: 'build', start: 0, end: 30 }]);
  });
});
```

- [ ] **Step 3: Run** — `npx vitest run tests/montage` → FAIL (module missing).

- [ ] **Step 4: Implement `src/montage/musicMap.ts`**

```ts
/**
 * Music analysis for the montagem engine — the TRACK masters the timeline.
 * Beats via music-tempo (pure JS; house pivot: librosa → music-tempo), drops via the
 * rankrot bass-band trick (lowpass RMS surge after a dip). PCM goes through a temp
 * file: run() stdout is utf8 and corrupts binary.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import MusicTempo from 'music-tempo';
import { run } from '../utils/cmd.js';
import { audioCurve, type CurvePoint } from '../rankrot/signals.js';
import type { Drop, MusicMap, Section } from './types.js';

const SR = 44_100;

export async function decodePcmMono(audioPath: string): Promise<Float32Array> {
  const dir = await mkdtemp(join(tmpdir(), 'clipforge-pcm-'));
  const out = join(dir, 'a.f32');
  try {
    await run('ffmpeg', ['-y', '-i', audioPath, '-ac', '1', '-ar', String(SR), '-f', 'f32le', out]);
    const buf = await readFile(out);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const meanIn = (c: CurvePoint[], a: number, b: number): number => {
  const xs = c.filter((p) => p.time >= a && p.time < b);
  return xs.length === 0 ? 0 : xs.reduce((s, p) => s + p.v, 0) / xs.length;
};

/** PURE: bass surge (post ≥ 6.5, jump ≥ 2 on the 0-10 scale) after a dip; ≥8s apart. */
export function detectDrops(bass: CurvePoint[]): Drop[] {
  const raw: Drop[] = [];
  for (const p of bass) {
    const pre = meanIn(bass, p.time - 2, p.time - 0.25);
    const post = meanIn(bass, p.time, p.time + 1);
    if (post >= 6.5 && post - pre >= 2) raw.push({ time: p.time, strength: post - pre });
  }
  const drops: Drop[] = [];
  for (const d of raw.sort((a, b) => b.strength - a.strength)) {
    if (drops.every((k) => Math.abs(k.time - d.time) >= 8)) drops.push(d);
  }
  return drops.sort((a, b) => a.time - b.time);
}

/** PURE: build until each drop, `dropLen`s of drop, tail after the last drop = cool. */
export function classifySections(drops: Drop[], duration: number, dropLen = 8): Section[] {
  if (drops.length === 0) return [{ kind: 'build', start: 0, end: duration }];
  const out: Section[] = [];
  let cursor = 0;
  for (const d of drops) {
    if (d.time > cursor) out.push({ kind: 'build', start: cursor, end: d.time });
    const end = Math.min(d.time + dropLen, duration);
    out.push({ kind: 'drop', start: d.time, end });
    cursor = end;
  }
  if (cursor < duration) out.push({ kind: 'cool', start: cursor, end: duration });
  return out;
}

export async function buildMusicMap(audioPath: string): Promise<MusicMap> {
  const pcm = await decodePcmMono(audioPath);
  const duration = pcm.length / SR;
  const mt = new MusicTempo(pcm);
  const [energy, bass] = [await audioCurve(audioPath), await audioCurve(audioPath, true)];
  let drops = detectDrops(bass);
  // A montage needs a climax: no detectable drop → synthesize one at 60% of the track.
  if (drops.length === 0) drops = [{ time: duration * 0.6, strength: 1 }];
  return {
    bpm: mt.tempo, beats: mt.beats, drops, energy,
    sections: classifySections(drops, duration), duration,
  };
}
```

- [ ] **Step 5: Run tests** — `npx vitest run tests/montage` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/montage src/types/music-tempo.d.ts tests/montage package.json package-lock.json
git commit -m "feat(montage): music map — music-tempo beats + bass-surge drop detection + build/drop/cool sections"
```

> Spec note: the spec's "beats refined by snapping to our own energy-flux onsets" is DEFERRED —
> music-tempo's beats ship as-is, and the onset-snap (or the essentia.js upgrade) only happens
> if the Task-13 live smoke shows misaligned cuts. Montage tracks (phonk/EDM) have strong grids.

---

### Task 5: Moment harvesting + rep-cycle detection

**Files:**
- Create: `src/montage/moments.ts`
- Test: `tests/montage/moments.test.ts`

**Interfaces:**
- Consumes: `motionCurve`, `audioCurve`, `percentile` from `src/rankrot/signals.js`; `detectSceneCuts` from `src/extraction/sceneCuts.js`; `extractMoment` from `src/rankrot/moment.js`; `probe` from `src/utils/ffmpeg.js`.
- Produces:
  - `detectCycles(motion: CurvePoint[]): number[]` — PURE; times of periodic motion peaks (reps); `[]` unless ≥4 peaks with consistent period.
  - `pickMomentWindows(motion: CurvePoint[], audio: CurvePoint[], cuts: number[], duration: number, count: number): { start: number; end: number; motionScore: number; audioScore: number }[]` — PURE.
  - `harvestMoments(videoPath: string, outDir: string, count: number): Promise<MontageMoment[]>` — extracts each window to `outDir/mm_<i>.mp4`, runs `detectCycles` on the window's motion slice (times shifted to be file-relative).

- [ ] **Step 1: Failing tests**

```ts
// tests/montage/moments.test.ts
import { describe, expect, it } from 'vitest';
import { detectCycles, pickMomentWindows } from '../../src/montage/moments.js';

const curve = (vs: number[], dt: number) => vs.map((v, i) => ({ time: i * dt, v }));

describe('detectCycles', () => {
  it('finds periodic peaks (reps at ~1.25s period)', () => {
    // 8 Hz motion curve, peak every 10 samples: v=10 on the beat, 1 elsewhere
    const vs = Array.from({ length: 80 }, (_, i) => (i % 10 === 5 ? 10 : 1));
    const cycles = detectCycles(curve(vs, 1 / 8));
    expect(cycles.length).toBeGreaterThanOrEqual(4);
    const gaps = cycles.slice(1).map((t, i) => t - cycles[i]);
    for (const g of gaps) expect(g).toBeCloseTo(1.25, 1);
  });
  it('irregular motion → no cycles', () => {
    const vs = [1, 9, 1, 1, 1, 1, 1, 8, 1, 10, 1, 1, 1, 1, 1, 1, 1, 1, 9, 1];
    expect(detectCycles(curve(vs, 1 / 8))).toEqual([]);
  });
});

describe('pickMomentWindows', () => {
  it('picks the highest-motion windows without overlap', () => {
    // 60s video: hot at 10-14s and 40-44s
    const vs = Array.from({ length: 480 }, (_, i) => {
      const t = i / 8;
      return (t >= 10 && t < 14) || (t >= 40 && t < 44) ? 9 : 1;
    });
    const wins = pickMomentWindows(curve(vs, 1 / 8), curve(Array(120).fill(5), 0.5), [], 60, 2);
    expect(wins).toHaveLength(2);
    const hits = wins.map((w) => (w.start < 14 && w.end > 10) || (w.start < 44 && w.end > 40));
    expect(hits.every(Boolean)).toBe(true);
  });
  it('snaps to scene-cut boundaries when the hot region is a shot', () => {
    // hot exactly between the cuts at 10s and 14s → the cut-derived candidate wins the tie
    const vs = Array.from({ length: 240 }, (_, i) => (i / 8 >= 10 && i / 8 < 14 ? 9 : 1));
    const wins = pickMomentWindows(curve(vs, 1 / 8), curve(Array(60).fill(5), 0.5), [10, 14], 30, 1);
    expect(wins[0].start).toBeCloseTo(10, 5);
    expect(wins[0].end).toBeCloseTo(14, 5);
  });
});
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement `src/montage/moments.ts`**

```ts
/**
 * Montage moment harvesting — motion/audio peaks become the segment pool, scene cuts
 * are preferred window boundaries, and PERIODIC motion (reps) is detected by
 * cycle-consistency on the YDIF curve (pure signal math, no LLM) to feed the counter.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { motionCurve, audioCurve, percentile, type CurvePoint } from '../rankrot/signals.js';
import { extractMoment } from '../rankrot/moment.js';
import { detectSceneCuts } from '../extraction/sceneCuts.js';
import { probe } from '../utils/ffmpeg.js';
import type { MontageMoment } from './types.js';

const MIN_WIN = 1.5, MAX_WIN = 6, SLIDE_WIN = 3, SLIDE_STEP = 1.5;

/** PURE: periodic peak times — ≥4 peaks above p60 whose gaps stay within 35% of the median gap. */
export function detectCycles(motion: CurvePoint[]): number[] {
  if (motion.length < 8) return [];
  const floor = percentile(motion, 60);
  const peaks: number[] = [];
  for (let i = 1; i < motion.length - 1; i++) {
    const p = motion[i];
    if (p.v > floor && p.v >= motion[i - 1].v && p.v >= motion[i + 1].v) {
      if (peaks.length === 0 || p.time - peaks[peaks.length - 1] >= 0.35) peaks.push(p.time);
    }
  }
  if (peaks.length < 4) return [];
  const gaps = peaks.slice(1).map((t, i) => t - peaks[i]);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (gaps.some((g) => Math.abs(g - median) > median * 0.35)) return [];
  return peaks;
}

const meanIn = (c: CurvePoint[], a: number, b: number): number => {
  const xs = c.filter((p) => p.time >= a && p.time < b);
  return xs.length === 0 ? 0 : xs.reduce((s, p) => s + p.v, 0) / xs.length;
};

/** PURE: top `count` non-overlapping windows scored 0.6·motion + 0.4·audio (audio /10). */
export function pickMomentWindows(
  motion: CurvePoint[], audio: CurvePoint[], cuts: number[], duration: number, count: number,
): { start: number; end: number; motionScore: number; audioScore: number }[] {
  const cands: { start: number; end: number }[] = [];
  if (cuts.length > 0) {
    const bounds = [0, ...cuts, duration];
    for (let i = 0; i < bounds.length - 1; i++) {
      const len = bounds[i + 1] - bounds[i];
      if (len >= MIN_WIN) cands.push({ start: bounds[i], end: bounds[i] + Math.min(len, MAX_WIN) });
    }
  }
  for (let t = 0; t + SLIDE_WIN <= duration; t += SLIDE_STEP) cands.push({ start: t, end: t + SLIDE_WIN });

  const motionMax = Math.max(1e-6, percentile(motion, 95));
  const scored = cands.map((c) => {
    const m = Math.min(1, meanIn(motion, c.start, c.end) / motionMax);
    const a = Math.min(1, meanIn(audio, c.start, c.end) / 10);
    return { ...c, motionScore: m, audioScore: a, score: 0.6 * m + 0.4 * a };
  }).sort((x, y) => y.score - x.score);

  const picked: typeof scored = [];
  for (const c of scored) {
    if (picked.length >= count) break;
    if (picked.every((p) => c.start >= p.end + 1 || c.end <= p.start - 1)) picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start)
    .map(({ start, end, motionScore, audioScore }) => ({ start, end, motionScore, audioScore }));
}

/** Harvest `count` moment files from one video (windows extracted to outDir/mm_<i>.mp4). */
export async function harvestMoments(videoPath: string, outDir: string, count: number): Promise<MontageMoment[]> {
  await mkdir(outDir, { recursive: true });
  const p = await probe(videoPath);
  const [motion, audio, cuts] = [await motionCurve(videoPath), await audioCurve(videoPath), await detectSceneCuts(videoPath)];
  const wins = pickMomentWindows(motion, audio, cuts, p.duration, count);
  const out: MontageMoment[] = [];
  for (const [i, w] of wins.entries()) {
    const file = join(outDir, `mm_${i}_${w.start.toFixed(1)}.mp4`);
    await extractMoment(videoPath, w.start, w.end, file);
    const slice = motion.filter((pt) => pt.time >= w.start && pt.time <= w.end)
      .map((pt) => ({ time: pt.time - w.start, v: pt.v }));
    out.push({
      src: file, start: 0, dur: w.end - w.start,
      motionScore: w.motionScore, audioScore: w.audioScore,
      cycleEvents: detectCycles(slice),
    });
  }
  return out;
}
```

(If `detectSceneCuts`'s actual exported name differs, check `src/extraction/sceneCuts.ts` and use its real export — `planFraming` calls it, so mirror that import.)

- [ ] **Step 4: Run** — `npx vitest run tests/montage && npx tsc --noEmit` → green.

- [ ] **Step 5: Commit**

```bash
git add src/montage/moments.ts tests/montage/moments.test.ts
git commit -m "feat(montage): moment harvesting — cut-aware hot windows + periodic rep-cycle detection"
```

> Spec note: the spec's "face presence as a bonus" scoring input is DEFERRED — v1 scores
> motion + audio only (face detection per candidate window is the expensive part of the
> main pipeline). Revisit if live-smoke picks look wrong (e.g. montage full of crowd shots).

---

### Task 6: Assembly planner (pure, seeded)

**Files:**
- Create: `src/montage/planner.ts`
- Test: `tests/montage/planner.test.ts`

**Interfaces:**
- Produces:
  - `buildMontagePlan(map: MusicMap, moments: MontageMoment[], opts: { targetSec: number; seed: string }): MontagePlan`
  - `remapCycleEvents(plan: MontagePlan, moments: MontageMoment[]): CounterEvent[]` — PURE; cycle times inside used segment spans → montage wall-clock, values 1,2,3…
  - `mulberry32(seed: string): () => number` — deterministic rng (sha1 the seed string to a uint32).

- [ ] **Step 1: Failing tests**

```ts
// tests/montage/planner.test.ts
import { describe, expect, it } from 'vitest';
import { buildMontagePlan, remapCycleEvents } from '../../src/montage/planner.js';
import type { MusicMap, MontageMoment } from '../../src/montage/types.js';

const BPM = 120; // beat = 0.5s
const map: MusicMap = {
  bpm: BPM,
  beats: Array.from({ length: 240 }, (_, i) => i * 0.5),
  drops: [{ time: 20, strength: 4 }],
  energy: [], duration: 120,
  sections: [
    { kind: 'build', start: 0, end: 20 },
    { kind: 'drop', start: 20, end: 28 },
    { kind: 'cool', start: 28, end: 120 },
  ],
};
const mk = (i: number, cycles: number[] = []): MontageMoment => ({
  src: `m${i}.mp4`, start: 0, dur: 5, motionScore: 1 - i * 0.1, audioScore: 0.5, cycleEvents: cycles,
});
const moments = [mk(0), mk(1), mk(2), mk(3), mk(4)];

describe('buildMontagePlan', () => {
  const plan = buildMontagePlan(map, moments, { targetSec: 25, seed: 'test' });

  it('is deterministic for a seed', () => {
    expect(buildMontagePlan(map, moments, { targetSec: 25, seed: 'test' })).toEqual(plan);
  });
  it('lands near the target duration', () => {
    expect(plan.totalDur).toBeGreaterThan(20);
    expect(plan.totalDur).toBeLessThan(31);
  });
  it('every cut sits on the beat grid (±1 frame @30fps)', () => {
    let t = 0;
    for (const s of plan.segments) {
      const rel = (t + plan.musicOffset) % 0.25; // half-beat grid at 120bpm
      expect(Math.min(rel, 0.25 - rel)).toBeLessThan(1 / 30 + 1e-6);
      t += s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
    }
  });
  it('drop section cuts are denser than build cuts', () => {
    // wall-clock positions of each segment
    let t = 0;
    const starts = plan.segments.map((s) => {
      const st = t; t += s.freeze ? s.srcDur : s.srcDur / s.playbackRate; return st;
    });
    const dropRelStart = 20 - plan.musicOffset;
    const inDrop = starts.filter((s) => s >= dropRelStart && s < dropRelStart + 8).length / 8;
    const inBuild = starts.filter((s) => s < dropRelStart).length / Math.max(1, dropRelStart);
    expect(inDrop).toBeGreaterThan(inBuild);
  });
  it('slowmo payoff then freeze at the end', () => {
    const [slow, freeze] = plan.segments.slice(-2);
    expect(slow.playbackRate).toBeLessThanOrEqual(0.5);
    expect(freeze.freeze).toBe(true);
  });
  it('strongest moment is reserved for the drop hit', () => {
    let t = 0;
    for (const s of plan.segments) {
      const st = t; t += s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
      const dropRelStart = 20 - plan.musicOffset;
      if (Math.abs(st - dropRelStart) < 0.05) expect(s.src).toBe('m0.mp4');
    }
  });
  it('flashes only at cut boundaries, 1-4 frames', () => {
    for (const f of plan.flashes) {
      expect(f.frames).toBeGreaterThanOrEqual(1);
      expect(f.frames).toBeLessThanOrEqual(4);
    }
  });
});

describe('remapCycleEvents', () => {
  it('maps source cycle times through the playback rate', () => {
    const withCycles = [mk(0), mk(1, [0.5, 1.5, 2.5, 3.5]), mk(2), mk(3), mk(4)];
    const plan = buildMontagePlan(map, withCycles, { targetSec: 25, seed: 'test' });
    const events = remapCycleEvents(plan, withCycles);
    expect(events.length).toBeGreaterThan(0); // m1 footage IS used, so some cycles land
    expect(events.map((e) => e.value)).toEqual(events.map((_, i) => i + 1));
    const times = events.map((e) => e.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const e of events) { expect(e.time).toBeGreaterThanOrEqual(0); expect(e.time).toBeLessThan(plan.totalDur); }
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `src/montage/planner.ts`**

```ts
/**
 * Montage assembly planner — PURE and seeded. Walks the music's beat grid and fills
 * sections with moment footage: build = sparse cuts at ~1x, escalation (last 8 beats
 * before a drop) = 1 cut/beat sped up, drop = half-beat hyper cuts, payoff = slowmo +
 * freeze. The music is the timeline master; segments are muted downstream, so
 * playbackRate is free. All times in seconds relative to montage start.
 */
import { createHash } from 'node:crypto';
import type { CounterEvent, FlashEvent, FlashKind, MontageMoment, MontagePlan, MontageSegment, MusicMap } from './types.js';

const ESCALATION_BEATS = 8;
const DROP_HYPER_BEATS = 4;   // half-beat cuts for the first 4 beats of a drop
const PAYOFF_SLOW_SEC = 1.2;  // wall-clock slowmo length
const PAYOFF_FREEZE_SEC = 0.7;
const DROP_FLASHES: FlashKind[] = ['white', 'red', 'glitch', 'black'];

export function mulberry32(seed: string): () => number {
  let a = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cut { time: number; kind: 'build' | 'escalation' | 'drop' }

/** Beat-grid cut times for the montage window. Exported for the test-of-last-resort. */
export function cutTimes(map: MusicMap, offset: number, targetSec: number, rng: () => number): Cut[] {
  const end = offset + targetSec;
  const beats = map.beats.filter((b) => b >= offset && b <= end);
  const drop = map.drops.find((d) => d.time >= offset && d.time <= end);
  const halfBeat = 30 / map.bpm;
  const cuts: Cut[] = [];
  let skip = 0;
  for (const [i, b] of beats.entries()) {
    const toDrop = drop ? drop.time - b : Infinity;
    const inEscalation = drop && toDrop > 0 && toDrop <= ESCALATION_BEATS * 2 * halfBeat;
    const inDrop = drop && b >= drop.time && b < drop.time + DROP_HYPER_BEATS * 2 * halfBeat;
    if (inDrop) {
      cuts.push({ time: b - offset, kind: 'drop' });
      if (i < beats.length - 1) cuts.push({ time: b - offset + halfBeat, kind: 'drop' });
    } else if (inEscalation) {
      cuts.push({ time: b - offset, kind: 'escalation' });
    } else {
      if (skip > 0) { skip--; continue; }
      cuts.push({ time: b - offset, kind: 'build' });
      skip = 1 + Math.floor(rng() * 3); // next cut 2-4 beats away
    }
  }
  return cuts;
}

export function buildMontagePlan(
  map: MusicMap, moments: MontageMoment[], opts: { targetSec: number; seed: string },
): MontagePlan {
  const rng = mulberry32(opts.seed);
  const target = Math.max(15, Math.min(45, opts.targetSec));
  const firstDrop = map.drops[0]?.time ?? map.duration * 0.6;
  // Place the window so the drop lands ~70% in (or at 0 for short tracks).
  const offset = Math.max(0, Math.min(firstDrop - target * 0.7, map.duration - target));

  const byScore = [...moments].sort((a, b) => (b.motionScore + b.audioScore) - (a.motionScore + a.audioScore));
  const reserved = byScore[0];
  const pool = byScore.slice(1).length > 0 ? byScore.slice(1) : byScore;
  const cursors = new Map<string, number>(pool.map((m) => [m.src, 0]));

  const rateFor = (kind: Cut['kind']): number =>
    kind === 'build' ? 0.75 + rng() * 0.25 : kind === 'escalation' ? 1.25 + rng() * 0.75 : 1.5 + rng() * 0.5;

  const cuts = cutTimes(map, offset, target, rng);
  const dropRel = firstDrop - offset;
  const segments: MontageSegment[] = [];
  const flashes: FlashEvent[] = [];
  let poolIdx = 0;

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const wallDur = (i + 1 < cuts.length ? cuts[i + 1].time : Math.min(target, dropRel + 8)) - cut.time;
    if (wallDur <= 1 / 30) continue;
    const isDropHit = Math.abs(cut.time - dropRel) < 1e-3;
    const m = isDropHit ? reserved : pool[poolIdx++ % pool.length];
    const rate = isDropHit ? 1 : rateFor(cut.kind);
    const srcDur = Math.min(wallDur * rate, m.dur);
    let srcStart = isDropHit ? Math.max(0, (m.dur - srcDur) / 2) : (cursors.get(m.src) ?? 0);
    if (!isDropHit) {
      if (srcStart + srcDur > m.dur) srcStart = 0; // wrap
      cursors.set(m.src, srcStart + srcDur + 0.3);
    }
    segments.push({
      src: m.src, srcStart, srcDur, playbackRate: rate, freeze: false,
      zoom: cut.kind !== 'build', shake: cut.kind === 'drop',
    });
    // Flashes: every drop/escalation cut; every 2nd build cut.
    if (cut.kind !== 'build' || i % 2 === 0) {
      flashes.push({
        time: cut.time,
        kind: cut.kind === 'drop' ? DROP_FLASHES[i % DROP_FLASHES.length] : rng() < 0.5 ? 'white' : 'blur',
        frames: cut.kind === 'build' ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3),
      });
    }
  }

  // Payoff: slowmo re-show of the reserved peak, then freeze. Wall time continues after the cuts.
  let wall = segments.reduce((s, x) => s + x.srcDur / x.playbackRate, 0);
  const slowSrc = Math.min(PAYOFF_SLOW_SEC * 0.5, reserved.dur);
  segments.push({
    src: reserved.src, srcStart: Math.max(0, reserved.dur / 2 - slowSrc / 2), srcDur: slowSrc,
    playbackRate: 0.5, freeze: false, zoom: true, shake: false,
  });
  flashes.push({ time: wall, kind: 'white', frames: 4 });
  wall += slowSrc / 0.5;
  const payoffAt = wall;
  segments.push({
    src: reserved.src, srcStart: Math.max(0, reserved.dur / 2), srcDur: PAYOFF_FREEZE_SEC,
    playbackRate: 1, freeze: true, zoom: false, shake: false,
  });
  wall += PAYOFF_FREEZE_SEC;

  return { segments, flashes, musicOffset: offset, payoffAt, payoffDur: PAYOFF_FREEZE_SEC, totalDur: wall };
}

/** PURE: cycle events inside used segment spans → montage wall clock, numbered 1..n. */
export function remapCycleEvents(plan: MontagePlan, moments: MontageMoment[]): CounterEvent[] {
  const bySrc = new Map(moments.map((m) => [m.src, m]));
  const out: number[] = [];
  let wall = 0;
  for (const s of plan.segments) {
    const m = bySrc.get(s.src);
    if (m && !s.freeze) {
      for (const c of m.cycleEvents) {
        if (c >= s.srcStart && c < s.srcStart + s.srcDur) out.push(wall + (c - s.srcStart) / s.playbackRate);
      }
    }
    wall += s.freeze ? s.srcDur : s.srcDur / s.playbackRate;
  }
  return out.sort((a, b) => a - b).map((time, i) => ({ time, value: i + 1 }));
}
```

Adjust implementation details freely to make the Step-1 tests pass (they are the contract: determinism, grid alignment, drop density, payoff shape, reservation, flash bounds) — but do not weaken the tests.

- [ ] **Step 4: Run** — `npx vitest run tests/montage/planner.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/montage/planner.ts tests/montage/planner.test.ts
git commit -m "feat(montage): seeded pure assembly planner — beat-grid cuts, escalation/drop density, slowmo+freeze payoff, flash placement"
```

---

### Task 7: Remotion MontageVideo composition + montagem caption preset

**Files:**
- Create: `remotion/src/montageLogic.ts`, `remotion/src/MontageVideo.tsx`
- Modify: `remotion/src/Root.tsx` (register comp), `src/captions/presets.ts` (montagem preset), `ui/components/style-tab.tsx` `PRESET_STYLES` mirror (add montagem)
- Test: `tests/montage/montageLogic.test.ts` (vitest cross-imports remotion logic, same as rankrotLogic tests)

**Interfaces:**
- Produces (in `montageLogic.ts` — type aliases, NOT interfaces):

```ts
export type MontageSegmentProp = {
  videoPath: string; from: number; durationInFrames: number;
  startFromFrames: number; playbackRate: number; freeze: boolean; zoom: boolean; shake: boolean;
};
export type MontageFlashProp = { at: number; frames: number; kind: 'white' | 'red' | 'black' | 'glitch' | 'blur' };
export type MontageCounterProp = { at: number; value: number };
export type MontageProps = {
  segments: MontageSegmentProp[]; flashes: MontageFlashProp[];
  counter: MontageCounterProp[]; counterLabel: string;
  musicPath: string; musicVolume: number; musicStartFromFrames: number;
  payoffImagePath: string;   // '' = none
  payoffAtFrame: number;
  fps: number;
};
export function totalMontageFrames(segments: MontageSegmentProp[]): number; // max(from + durationInFrames), min 1
```

- [ ] **Step 1: Failing test**

```ts
// tests/montage/montageLogic.test.ts
import { totalMontageFrames } from '../../remotion/src/montageLogic.js';

it('total frames = end of the last segment', () => {
  expect(totalMontageFrames([
    { videoPath: 'a', from: 0, durationInFrames: 30, startFromFrames: 0, playbackRate: 1, freeze: false, zoom: false, shake: false },
    { videoPath: 'b', from: 30, durationInFrames: 45, startFromFrames: 0, playbackRate: 2, freeze: false, zoom: true, shake: true },
  ])).toBe(75);
  expect(totalMontageFrames([])).toBe(1);
});
```

- [ ] **Step 2: Run** — FAIL. (Check how existing tests import `remotion/src/rankrotLogic` — mirror that import path/extension exactly.)

- [ ] **Step 3: Implement**

`remotion/src/montageLogic.ts`: the types above plus

```ts
export function totalMontageFrames(segments: MontageSegmentProp[]): number {
  return Math.max(1, ...segments.map((s) => s.from + s.durationInFrames));
}
```

`remotion/src/MontageVideo.tsx` — follow RankRotVideo's component conventions (AbsoluteFill, Sequence, OffthreadVideo, staticFile). Behavior:
- Music: `<Audio src={staticFile(musicPath)} volume={musicVolume} startFrom={musicStartFromFrames} />` mounted for the whole comp.
- Each segment: `<Sequence from={s.from} durationInFrames={s.durationInFrames}>`; inside, `s.freeze` → `<Freeze frame={s.startFromFrames}><OffthreadVideo muted src=.../></Freeze>`, else `<OffthreadVideo muted src={staticFile(s.videoPath)} startFrom={s.startFromFrames} playbackRate={s.playbackRate} style={{width:'100%',height:'100%',objectFit:'cover'}} />`.
- Zoom: when `s.zoom`, wrap in a div scaling `1 → 1.12` across the segment (`interpolate(frame, [0, dur], [1, 1.12])`).
- Shake: when `s.shake`, add `translate(${Math.sin(frame * 12.9898) * 6}px, ${Math.cos(frame * 78.233) * 6}px)` (deterministic pseudo-noise; no Math.random in render).
- Flashes: for each flash, `<Sequence from={f.at} durationInFrames={f.frames}>` with an AbsoluteFill: white/red/black = solid background at opacity 0.85; blur = `backdropFilter: 'blur(14px)'`; glitch = two full-frame color-channel copies offset ±6px with `mixBlendMode: 'screen'` over a 2px `translateX` jitter.
- Counter: when `counter.length > 0`, top-center overlay — label in 42px 900-weight uppercase with red glow (`textShadow: '0 0 18px #FF2E2E, 0 4px 0 #000'`), below it the current value (largest `counter[i].at <= frame`) in 140px, popping `scale 1.35 → 1` over 6 frames after each increment.
- Payoff image: when `payoffImagePath !== ''`, `<Sequence from={payoffAtFrame}>` with `<Img src={staticFile(payoffImagePath)} style={{width:'100%',height:'100%',objectFit:'cover'}} />` and a 4-frame white flash at its start.

Register in `Root.tsx` (dims 1080×1920@30, pattern-match RankRotVideo):

```tsx
<Composition
  id="MontageVideo" component={MontageVideo} width={1080} height={1920} fps={30}
  durationInFrames={300}
  defaultProps={{ segments: [], flashes: [], counter: [], counterLabel: '', musicPath: '', musicVolume: 0.9, musicStartFromFrames: 0, payoffImagePath: '', payoffAtFrame: 0, fps: 30 } as MontageProps}
  calculateMetadata={({ props }) => ({ durationInFrames: totalMontageFrames(props.segments ?? []), fps: props.fps ?? 30 })}
/>
```

`src/captions/presets.ts`: add `'montagem'` to `PresetName` and

```ts
montagem: {
  font: 'anton', fontSize: 82, emphasisSize: 100, baseColor: '#FFFFFF', activeColor: '#FF2E2E',
  strokeWidth: 6, strokeColor: '#000000', animation: 'glow', position: 'center',
  uppercase: true, wordsPerLine: 2, background: 'none',
},
```

Mirror it in the GUI `PRESET_STYLES` (find with `grep -rn "PRESET_STYLES" ui/`) — same keys as the other presets there.

- [ ] **Step 4: Gates**

Run: `npx vitest run && (cd remotion && npx tsc --noEmit) && (cd ui && npm run build)`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add remotion/src src/captions/presets.ts ui tests/montage/montageLogic.test.ts
git commit -m "feat(montage): MontageVideo composition — flashes, ramps, freeze, shake, counter overlay + montagem caption preset"
```

---

### Task 8: Counter engine (vision label + gate)

**Files:**
- Create: `src/montage/counter.ts`
- Test: `tests/montage/counter.test.ts`

**Interfaces:**
- Consumes: `extractKeyframes(videoPath, times, tmpDir): Promise<VisionImage[]>` from `src/analysis/keyframes.js`; `askVisionJson` (type `AskVisionFn`) from `src/broll/llmJson.js`; `remapCycleEvents` from `./planner.js`.
- Produces: `labelCounter(momentFile: string, dur: number, askFn?: AskVisionFn): Promise<string | null>` — ONE vision call; null = counter off. `normalizeCounterRaw(raw: unknown): { countable: boolean; label: string; confidence: number } | null` — PURE (free-tier Gemini shape tolerance, same spirit as `normalizeArcRaw`).

- [ ] **Step 1: Failing tests**

```ts
// tests/montage/counter.test.ts
import { describe, expect, it } from 'vitest';
import { labelCounter, normalizeCounterRaw } from '../../src/montage/counter.js';

describe('normalizeCounterRaw', () => {
  it('accepts the canonical shape', () => {
    expect(normalizeCounterRaw({ countable: true, label: 'PULLUP COUNTER', confidence: 0.9 }))
      .toEqual({ countable: true, label: 'PULLUP COUNTER', confidence: 0.9 });
  });
  it('tolerates a top-level array (free-tier Gemini habit)', () => {
    expect(normalizeCounterRaw([{ countable: true, label: 'REPS', confidence: 0.8 }])?.label).toBe('REPS');
  });
  it('missing confidence defaults to 0.5; garbage → null', () => {
    expect(normalizeCounterRaw({ countable: true, label: 'X' })?.confidence).toBe(0.5);
    expect(normalizeCounterRaw('nope')).toBeNull();
  });
});

describe('labelCounter gate', () => {
  it('low confidence or not countable → null (never a wrong caption)', async () => {
    const no = async () => ({ countable: true, label: 'REPS', confidence: 0.4 });
    expect(await labelCounter('f.mp4', 5, no as never)).toBeNull();
    const notCountable = async () => ({ countable: false, label: 'TALKING', confidence: 0.95 });
    expect(await labelCounter('f.mp4', 5, notCountable as never)).toBeNull();
  });
  it('confident + countable → uppercased label', async () => {
    const yes = async () => ({ countable: true, label: 'pullup counter', confidence: 0.9 });
    expect(await labelCounter('f.mp4', 5, yes as never)).toBe('PULLUP COUNTER');
  });
  it('LLM unavailable (null) → null', async () => {
    expect(await labelCounter('f.mp4', 5, (async () => null) as never)).toBeNull();
  });
});
```

Note: the injected `askFn` fakes skip keyframe extraction — `labelCounter` must call `extractKeyframes` lazily ONLY when about to ask (structure: build times → try/catch around extraction+ask → gate). If extraction inside makes the fake-based test awkward, split: `labelCounter` takes `images: VisionImage[]` and a thin `labelCounterForMoment(file, dur)` wrapper does extraction; test the former, leave the wrapper for live smoke. Choose whichever keeps the test I/O-free — adjust the test imports accordingly.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `src/montage/counter.ts`**

```ts
/**
 * Montage counter engine — counts come from cycle detection (pure signals); the ONE
 * vision call here only decides WHAT is being counted ("PULLUP COUNTER") and whether
 * counting makes sense at all. Low confidence → counter off: silence beats a wrong label.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { extractKeyframes } from '../analysis/keyframes.js';
import { askVisionJson, type AskVisionFn } from '../broll/llmJson.js';

const MIN_CONFIDENCE = 0.6;

const SCHEMA = {
  type: 'object',
  properties: {
    countable: { type: 'boolean' },
    label: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['countable', 'label'],
  additionalProperties: false,
} as const;

const SYSTEM = 'You label repetitive actions in short sports/fitness/gaming clips for an on-screen counter.';
const PROMPT = `These frames come from one clip where a repeating motion was detected.
Decide if the repetitions are a countable action a viewer would enjoy counting (reps, jumps, hits, tricks).
Return EXACTLY this JSON shape (an object, not an array):
{"countable": true|false, "label": "SHORT ALL-CAPS COUNTER TITLE like PULLUP COUNTER", "confidence": 0.0-1.0}`;

/** PURE: free-tier Gemini shape tolerance (top-level arrays, missing confidence). */
export function normalizeCounterRaw(raw: unknown): { countable: boolean; label: string; confidence: number } | null {
  const obj = Array.isArray(raw) ? raw[0] : raw;
  if (obj === null || typeof obj !== 'object') return null;
  const r = obj as Record<string, unknown>;
  if (typeof r.countable !== 'boolean' || typeof r.label !== 'string') return null;
  return { countable: r.countable, label: r.label, confidence: typeof r.confidence === 'number' ? r.confidence : 0.5 };
}

/** One vision call → counter label, or null (off). Never throws. */
export async function labelCounter(momentFile: string, dur: number, askFn: AskVisionFn = askVisionJson): Promise<string | null> {
  try {
    const times = [dur * 0.25, dur * 0.5, dur * 0.75];
    const dir = await mkdtemp(join(tmpdir(), 'clipforge-counter-'));
    let images;
    try { images = await extractKeyframes(momentFile, times, dir); }
    finally { await rm(dir, { recursive: true, force: true }); }
    const raw = await askFn({ system: SYSTEM, prompt: PROMPT, schema: SCHEMA as unknown as Record<string, unknown>, label: 'montage-counter', images });
    const res = normalizeCounterRaw(raw);
    if (!res || !res.countable || res.confidence < MIN_CONFIDENCE || res.label.trim() === '') return null;
    return res.label.trim().toUpperCase().slice(0, 24);
  } catch (e) {
    logger.warn(`[montage-counter] label failed — counter off: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
```

If the fake-based tests need the split described in Step 1's note, do the split (test the pure/injectable part).

- [ ] **Step 4: Run** — `npx vitest run tests/montage/counter.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/montage/counter.ts tests/montage/counter.test.ts
git commit -m "feat(montage): counter engine — one gated vision call labels the cycle counter; silence beats a wrong label"
```

---

### Task 9: AI payoff frame (Gemini image gen + mandatory fallback)

**Files:**
- Create: `src/montage/payoff.ts`
- Test: `tests/montage/payoff.test.ts`

**Interfaces:**
- Consumes: `loadGeminiKeys` from `src/analysis/keyPool.js`; `run` (ffmpeg frame extraction to temp file).
- Produces:
  - `extractPeakFrame(momentFile: string, atSec: number, outPng: string): Promise<void>` — ffmpeg `-ss <t> -frames:v 1`.
  - `generatePayoffImage(framePath: string, cacheDir: string, env?: NodeJS.ProcessEnv, fetchFn?: typeof fetch): Promise<string | null>` — image-to-image via REST `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` (`GEMINI_IMAGE_MODEL` env, default `gemini-2.5-flash-image`), key rotation over `loadGeminiKeys`, sha1(frame bytes + PROMPT_VERSION) cache key, writes `<cacheDir>/<hash>.png`. Returns path or null. **Never throws.**
  - `parseImageResponse(json: unknown): Buffer | null` — PURE; finds the first `inlineData`/`inline_data` part, base64-decodes.

- [ ] **Step 1: Failing tests**

```ts
// tests/montage/payoff.test.ts
import { describe, expect, it } from 'vitest';
import { parseImageResponse, generatePayoffImage } from '../../src/montage/payoff.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const png = Buffer.from('fakepng');
const goodBody = {
  candidates: [{ content: { parts: [
    { text: 'here you go' },
    { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
  ] } }],
};

describe('parseImageResponse', () => {
  it('extracts the inline image part (camelCase and snake_case)', () => {
    expect(parseImageResponse(goodBody)?.equals(png)).toBe(true);
    const snake = { candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: png.toString('base64') } }] } }] };
    expect(parseImageResponse(snake)?.equals(png)).toBe(true);
  });
  it('text-only response → null', () => {
    expect(parseImageResponse({ candidates: [{ content: { parts: [{ text: 'refused' }] } }] })).toBeNull();
  });
});

describe('generatePayoffImage', () => {
  it('writes the cache file on success and returns its path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'payoff-'));
    const frame = join(dir, 'f.jpg');
    await writeFile(frame, Buffer.from('jpegbytes'));
    const fetchFn = (async () => new Response(JSON.stringify(goodBody), { status: 200 })) as typeof fetch;
    const out = await generatePayoffImage(frame, dir, { GEMINI_API_KEYS: 'k1' } as never, fetchFn);
    expect(out).toMatch(/\.png$/);
  });
  it('rotates keys: first 429s, second succeeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'payoff-'));
    const frame = join(dir, 'f.jpg');
    await writeFile(frame, Buffer.from('jpegbytes'));
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return calls === 1
        ? new Response('quota', { status: 429 })
        : new Response(JSON.stringify(goodBody), { status: 200 });
    }) as typeof fetch;
    const out = await generatePayoffImage(frame, dir, { GEMINI_API_KEYS: 'k1,k2' } as never, fetchFn);
    expect(calls).toBe(2);
    expect(out).not.toBeNull();
  });
  it('all keys fail → null, never throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'payoff-'));
    const frame = join(dir, 'f.jpg');
    await writeFile(frame, Buffer.from('jpegbytes'));
    const fetchFn = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    expect(await generatePayoffImage(frame, dir, { GEMINI_API_KEYS: 'k1,k2' } as never, fetchFn)).toBeNull();
  });
  it('no keys → null immediately', async () => {
    expect(await generatePayoffImage('missing.jpg', '/tmp', {} as never)).toBeNull();
  });
});
```

(Check `loadGeminiKeys`'s env-var name in `src/analysis/keyPool.ts` — if it reads a different variable than `GEMINI_API_KEYS` or supports multiple, mirror what it actually does in the test env objects.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `src/montage/payoff.ts`**

```ts
/**
 * AI payoff frame — the montage's final exaggerated image. Image-to-image via the Gemini
 * REST API (the @google/generative-ai SDK lags on image output, so plain fetch), key-pool
 * rotation, sha1 cache. The prompt targets EXAGGERATED/cartoon-grade stylization, not
 * photorealism (YouTube synthetic-media disclosure stays a non-issue). Mandatory fallback:
 * any failure → null and the caller uses a stylized real freeze — a montage NEVER fails
 * over this image.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import { loadGeminiKeys } from '../analysis/keyPool.js';

const PROMPT_VERSION = 'v1';
const PROMPT = `Redraw this exact moment as an EXAGGERATED, hyper-stylized anime-poster payoff frame:
dramatic lighting, speed lines, glowing edges, absurdly heroic proportions. Clearly stylized art,
NOT photorealistic. Keep the subject and pose recognizable. Output the image only.`;

export async function extractPeakFrame(momentFile: string, atSec: number, outPng: string): Promise<void> {
  await run('ffmpeg', ['-y', '-ss', atSec.toFixed(2), '-i', momentFile, '-frames:v', '1', outPng]);
}

/** PURE: first inline image part of a generateContent response → Buffer. */
export function parseImageResponse(json: unknown): Buffer | null {
  const cands = (json as { candidates?: { content?: { parts?: unknown[] } }[] })?.candidates ?? [];
  for (const c of cands) {
    for (const part of c.content?.parts ?? []) {
      const p = part as { inlineData?: { data?: string }; inline_data?: { data?: string } };
      const data = p.inlineData?.data ?? p.inline_data?.data;
      if (typeof data === 'string' && data.length > 0) return Buffer.from(data, 'base64');
    }
  }
  return null;
}

export async function generatePayoffImage(
  framePath: string, cacheDir: string,
  env: NodeJS.ProcessEnv = process.env, fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const keys = loadGeminiKeys(env);
    if (keys.length === 0) return null;
    const frame = await readFile(framePath);
    const hash = createHash('sha1').update(frame).update(PROMPT_VERSION).digest('hex').slice(0, 16);
    await mkdir(cacheDir, { recursive: true });
    const outPath = join(cacheDir, `payoff_${hash}.png`);
    if (existsSync(outPath)) return outPath;

    const model = env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
    const body = JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: 'image/jpeg', data: frame.toString('base64') } },
        { text: PROMPT },
      ] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    for (const [i, key] of keys.entries()) {
      try {
        const res = await fetchFn(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const img = parseImageResponse(await res.json());
        if (!img) throw new Error('no image part in response');
        await writeFile(outPath, img);
        return outPath;
      } catch (e) {
        if (i < keys.length - 1) logger.warn(`[montage-payoff] Gemini key ${i + 1}/${keys.length} failed (${e instanceof Error ? e.message : e}) — rotating`);
      }
    }
    logger.warn('[montage-payoff] all keys failed — falling back to stylized real freeze');
    return null;
  } catch (e) {
    logger.warn(`[montage-payoff] skipped: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/montage/payoff.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/montage/payoff.ts tests/montage/payoff.test.ts
git commit -m "feat(montage): AI payoff frame — Gemini image-gen REST w/ key rotation + sha1 cache; null = stylized real freeze"
```

---

### Task 10: Render bridge (plan → props → remotion)

**Files:**
- Create: `src/montage/render.ts`
- Test: `tests/montage/render.test.ts`

**Interfaces:**
- Consumes: `MontagePlan`, `CounterEvent` (types); `MontageProps`/`MontageSegmentProp` shapes from `remotion/src/montageLogic.ts` (duplicate the type locally if cross-importing remotion types into src/ isn't already done — check how `rankrot/render.ts` handles it: it does NOT import from remotion; it builds plain objects. Do the same).
- Produces:
  - `buildMontageProps(plan: MontagePlan, counter: CounterEvent[], counterLabel: string, stagedRel: Map<string, string>, musicRel: string, payoffRel: string, fps: number, musicVolume: number): Record<string, unknown>` — PURE. Converts seconds → frames: each segment `from` = cumulative wall frames, `durationInFrames = round((freeze ? srcDur : srcDur/playbackRate) * fps)`, `startFromFrames = round(srcStart * fps)`; flashes/counter `at` = `round(time * fps)`; `musicStartFromFrames = round(plan.musicOffset * fps)`; `payoffAtFrame = round(plan.payoffAt * fps)`.
  - `renderMontage(plan, counter, counterLabel, musicPath, payoffImagePath, opts: { outPath: string; musicVolume?: number; fps?: number }): Promise<void>` — stages every distinct `plan.segments[].src` + music + payoff image into `remotion/public/input/` (unique `montage_` prefixed names), writes a props JSON, runs `npx remotion render src/index.ts MontageVideo` with the same retry/stall/log-throttle pattern as `renderRankRot`, cleans up in `finally`.

- [ ] **Step 1: Failing test (pure props math)**

```ts
// tests/montage/render.test.ts
import { buildMontageProps } from '../../src/montage/render.js';
import type { MontagePlan } from '../../src/montage/types.js';

const plan: MontagePlan = {
  segments: [
    { src: 'a.mp4', srcStart: 1, srcDur: 2, playbackRate: 2, freeze: false, zoom: false, shake: false }, // 1s wall
    { src: 'b.mp4', srcStart: 0, srcDur: 0.7, playbackRate: 1, freeze: true, zoom: false, shake: false }, // 0.7s wall
  ],
  flashes: [{ time: 1, kind: 'white', frames: 3 }],
  musicOffset: 4, payoffAt: 1, payoffDur: 0.7, totalDur: 1.7,
};

it('converts wall seconds to cumulative frames', () => {
  const staged = new Map([['a.mp4', 'input/m_a.mp4'], ['b.mp4', 'input/m_b.mp4']]);
  const p = buildMontageProps(plan, [{ time: 0.5, value: 1 }], 'REPS', staged, 'input/music.mp3', '', 30, 0.9) as never as {
    segments: { from: number; durationInFrames: number; startFromFrames: number }[];
    flashes: { at: number }[]; counter: { at: number; value: number }[];
    musicStartFromFrames: number; payoffAtFrame: number;
  };
  expect(p.segments[0]).toMatchObject({ from: 0, durationInFrames: 30, startFromFrames: 30 });
  expect(p.segments[1].from).toBe(30);
  expect(p.segments[1].durationInFrames).toBe(21);
  expect(p.flashes[0].at).toBe(30);
  expect(p.counter[0]).toEqual({ at: 15, value: 1 });
  expect(p.musicStartFromFrames).toBe(120);
  expect(p.payoffAtFrame).toBe(30);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — `buildMontageProps` per the spec above (walk segments accumulating `from`); `renderMontage` copied structurally from `renderRankRot` ([render.ts:107-141](src/rankrot/render.ts#L107-L141)): stage `[...new Set(plan.segments.map(s => s.src))]`, music, payoff image (when non-null) with `montage_` prefixes; props path `remotion/props_montage_<Date.now()>.json`; composition id `MontageVideo`; cleanup in `finally`.

- [ ] **Step 4: Run** — `npx vitest run tests/montage/render.test.ts && npx tsc --noEmit` → green.

- [ ] **Step 5: Commit**

```bash
git add src/montage/render.ts tests/montage/render.test.ts
git commit -m "feat(montage): render bridge — pure seconds→frames props builder + staged remotion render"
```

---

### Task 11: Pipeline + CLI command

**Files:**
- Create: `src/montage/pipeline.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/montage/pipeline.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: everything above, plus `download` from `src/ingest/downloader.js`, `ingestLocal`/`isLocalInput`/`localJobId` from `src/ingest/localFile.js`, `probe`.
- Produces:
  - `montageSlug(inputs: string[]): string` — PURE: `'montage_' + sha1(inputs.join('|')).slice(0, 10)`.
  - `pickMontageTrack(tracks: { path: string; duration: number }[], targetSec: number, seed: string): string | null` — PURE: prefer tracks with `duration >= targetSec + 10` (seeded pick among them via `mulberry32`); none long enough → the longest; empty array → null.
  - `buildMontageTexts(sourceTitles: string[], counterLabel: string | null): { title: string; description: string; hashtags: string[] }` — PURE, no LLM.
  - `runMontage(inputs: string[], opts: MontageOpts): Promise<string>` where

```ts
export interface MontageOpts {
  music?: string;        // explicit track file
  musicDir?: string;     // default './music'
  duration: number;      // default 25
  seed: string;          // default 'montage'
  counters: boolean;     // --no-counters
  payoffImage: boolean;  // --no-payoff-image
  nativeAudio: number;   // 0..1, default 0 (music volume stays 0.9)
}
```

**Pipeline flow (implement in `runMontage`):**
1. Slug + `workspace/exports/<slug>/` + `workspace/montage/<slug>/` work dir.
2. Resolve music: `opts.music` if set (must exist, else throw); else scan `<musicDir>/montagem/` for audio files (reuse `AUDIO_EXTS` logic from `src/music/library.ts` — export the Set from there if private), probe durations, `pickMontageTrack`. Nothing found → `throw new Error('No music: pass --music <file> or drop tracks into ./music/montagem/ — a montage cannot exist without its track.')`.
3. Ingest inputs sequentially: URL (`/^https?:/i`) → `download(url, join(WS, 'downloads', 'dl_' + sha1(url).slice(0, 10)))`; local (via `isLocalInput`) → `ingestLocal(p, join(WS, 'downloads', localJobId(p)))`; else throw naming the bad input. Collect `videoPath`s + best-effort titles (read `video.info.json` `title` field when present; else basename).
4. `buildMusicMap(musicPath)` (ora spinner per stage, pattern-match rankrot pipeline).
5. `harvestMoments(videoPath, workDir, perVideo)` for each video where `perVideo = Math.max(4, Math.ceil(12 / inputs.length))`; merge pools; `< 3` total moments → throw with a clear message.
6. `buildMontagePlan(map, moments, { targetSec: opts.duration, seed: opts.seed })`.
7. Counter: `opts.counters` and some moment has `cycleEvents.length > 0` → `remapCycleEvents(plan, moments)`; if events ≥ 3, `labelCounter` on the moment file with the most cycles; label null → empty counter (events discarded).
8. Payoff: `opts.payoffImage` → `extractPeakFrame(reserved peak file — the src of the freeze segment — at its srcStart, workDir/peak.jpg)` then `generatePayoffImage(frame, './broll_cache')`; null → `''` (comp then shows the real freeze, which is already segment-level).
9. `renderMontage(...)` → `<exportsDir>/montage_final.mp4`, `musicVolume: 0.9` (nativeAudio reserved: segments stay muted in v1 — document flag as reserved if not wired, or wire per-segment volume; simplest correct: when `nativeAudio > 0`, pass it through props and set `muted={false}` `volume={nativeAudio}` on non-freeze segments in the comp — do this only if trivially done in Task 7's component, else log 'native audio not yet supported' and continue).
10. Thumbnail: `generateThumbnail(freeze segment src, srcStart, texts.title, join(exportsDir, 'thumbnail.png'), { accent: '#FF2E2E' })` in try/catch (never fail).
11. Write `title.txt` / `description.txt` / `hashtags.txt` from `buildMontageTexts` and `montage_manifest.json`: `{ inputs, slug, music: { path, bpm, drops }, generated_at, moments: n, segments: n, counter_label, payoff_image: bool, total_sec }`.
12. Return `exportsDir`.

`buildMontageTexts` (deterministic):

```ts
export function buildMontageTexts(sourceTitles: string[], counterLabel: string | null): { title: string; description: string; hashtags: string[] } {
  const base = (sourceTitles[0] ?? 'MONTAGE').slice(0, 60);
  const title = `${base} 🔥 (INSANE EDIT)`;
  const description = `The hardest moments, cut to the beat.\n\nSources: ${sourceTitles.join(', ')}`;
  const hashtags = ['#shorts', '#montage', '#edit', ...(counterLabel ? ['#challenge'] : [])];
  return { title, description, hashtags };
}
```

**CLI registration in `src/cli/index.ts`** (after the rankrot command, same error pattern):

```ts
program.command('montage')
  .description('Video(s) + music → beat-synced montagem Short (flashes, ramps, drop payoff, counter, AI payoff frame)')
  .argument('<inputs...>', 'YouTube URLs and/or local video files')
  .option('--music <file>', 'music track (else picks from ./music/montagem/)')
  .option('--music-dir <p>', 'music library root', process.env.MUSIC_DIR ?? './music')
  .option('--duration <sec>', 'target length 15-45s', (v) => parseFloat(v), 25)
  .option('--seed <s>', 'plan seed (same seed = same edit)', 'montage')
  .option('--no-counters', 'disable the rep counter overlay')
  .option('--no-payoff-image', 'disable the AI-generated payoff frame')
  .option('--native-audio <v>', 'source audio level under the music 0-1', (v) => parseFloat(v), 0)
  .action(async (inputs, o) => {
    await preflightOrExit();
    try {
      await runMontage(inputs, {
        music: o.music, musicDir: o.musicDir, duration: o.duration, seed: o.seed,
        counters: o.counters, payoffImage: o.payoffImage, nativeAudio: o.nativeAudio,
      });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });
```

- [ ] **Step 1: Failing tests**

```ts
// tests/montage/pipeline.test.ts
import { describe, expect, it } from 'vitest';
import { montageSlug, pickMontageTrack, buildMontageTexts } from '../../src/montage/pipeline.js';

describe('montageSlug', () => {
  it('is deterministic and filesystem-safe', () => {
    const a = montageSlug(['https://youtu.be/x', './b.mp4']);
    expect(a).toBe(montageSlug(['https://youtu.be/x', './b.mp4']));
    expect(a).toMatch(/^montage_[0-9a-f]{10}$/);
    expect(a).not.toBe(montageSlug(['https://youtu.be/y']));
  });
});

describe('pickMontageTrack', () => {
  const t = (path: string, duration: number) => ({ path, duration });
  it('prefers tracks long enough for the montage (+10s headroom)', () => {
    const pick = pickMontageTrack([t('short.mp3', 20), t('long.mp3', 120)], 25, 's');
    expect(pick).toBe('long.mp3');
  });
  it('none long enough → the longest', () => {
    expect(pickMontageTrack([t('a.mp3', 18), t('b.mp3', 22)], 30, 's')).toBe('b.mp3');
  });
  it('seeded pick is deterministic', () => {
    const tracks = [t('a.mp3', 100), t('b.mp3', 100), t('c.mp3', 100)];
    expect(pickMontageTrack(tracks, 25, 'seed1')).toBe(pickMontageTrack(tracks, 25, 'seed1'));
  });
  it('empty → null', () => {
    expect(pickMontageTrack([], 25, 's')).toBeNull();
  });
});

describe('buildMontageTexts', () => {
  it('builds deterministic title/description/hashtags with no LLM', () => {
    const texts = buildMontageTexts(['Insane Calisthenics Session'], 'PULLUP COUNTER');
    expect(texts.title).toContain('Insane Calisthenics Session');
    expect(texts.description).toContain('Insane Calisthenics Session');
    expect(texts.hashtags).toContain('#shorts');
    expect(texts.hashtags).toContain('#challenge'); // counter present
    expect(buildMontageTexts(['X'], null).hashtags).not.toContain('#challenge');
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/montage/pipeline.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** pipeline + CLI as specified.
- [ ] **Step 4: Run** — `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 5: Commit**

```bash
git add src/montage/pipeline.ts src/cli/index.ts src/music/library.ts tests/montage/pipeline.test.ts
git commit -m "feat(montage): pipeline + CLI — ingest, music map, harvest, plan, counter, payoff, render, exports"
```

---

### Task 12: GUI Montage tab

**Files:**
- Create: `ui/app/api/montage/route.ts`, `ui/components/montage-tab.tsx`
- Modify: `ui/app/page.tsx` (7th tab entry + content)

**Interfaces:**
- Consumes: `startRun` from `ui/lib/runs` (see `ui/app/api/rankrot/route.ts` for the exact pattern), the result-player pattern from `rankrot-tab.tsx`.
- Produces: `POST /api/montage` body `{ inputs: string[], music?: string, duration?: number, counters?: boolean, payoffImage?: boolean }` → `{ id, args, slug }`.

- [ ] **Step 1: API route** — copy `ui/app/api/rankrot/route.ts` structurally:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { startRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

/** MIRROR of src/montage/pipeline.ts montageSlug — keep in sync (names the exports dir). */
function montageSlug(inputs: string[]): string {
  return 'montage_' + createHash('sha1').update(inputs.join('|')).digest('hex').slice(0, 10);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const inputs: string[] = Array.isArray(body?.inputs)
    ? body.inputs.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0).map((s: string) => s.trim())
    : [];
  if (inputs.length === 0) return NextResponse.json({ error: 'at least one URL or file path required' }, { status: 400 });

  const args = ['montage', ...inputs];
  if (typeof body.music === 'string' && body.music.trim()) args.push('--music', body.music.trim());
  const duration = Number(body.duration);
  if (Number.isFinite(duration) && duration >= 15 && duration <= 45) args.push('--duration', String(duration));
  if (body.counters === false) args.push('--no-counters');
  if (body.payoffImage === false) args.push('--no-payoff-image');

  const run = startRun(args);
  return NextResponse.json({ id: run.id, args: run.args, slug: montageSlug(inputs) });
}
```

- [ ] **Step 2: Tab component** — `ui/components/montage-tab.tsx` mirroring `rankrot-tab.tsx`'s structure (same run-log + result-player wiring): a textarea for inputs (one URL/path per line), text input for an optional music file path (placeholder `./music/montagem/track.mp3`), duration number input (15–45, default 25), two checkboxes (Counter overlay ✓, AI payoff frame ✓), Run button POSTing to `/api/montage`, result video from the returned slug's `montage_final.mp4` via the existing video-serving route. Read `rankrot-tab.tsx` first and reuse its exact hooks/components for run status.

- [ ] **Step 3: Register the tab** — in `ui/app/page.tsx` add `{ id: 'Montage', label: 'Montage', sub: 'Video + music → beat-synced montagem edit', icon: 'rank' }` to the tab list and a `<Tabs.Content value="Montage" ...><MontageTab /></Tabs.Content>` entry, pattern-matching the RankRot lines exactly.

- [ ] **Step 4: Gate** — `cd ui && npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add ui && git commit -m "feat(montage): GUI Montage tab — inputs + music + flags → run API with slug mirror"
```

---

### Task 13: Full gates + live smoke

- [ ] **Step 1: All gates**

```bash
npx vitest run && npx tsc --noEmit && (cd remotion && npx tsc --noEmit) && (cd ui && npm run build)
```
Expected: everything green. (Two gated face-detection integration tests time out under render load — rerun with `--testTimeout 300000` before judging them broken.)

- [ ] **Step 2: Clippies live check** — run `node dist/cli/index.js all <a multi-person video URL> --mode clippies --clips 1` after `npm run build`; confirm the export is full-screen (no blur bars). Then re-run with `--aspect 3:4` and confirm 1080×1440 output via `ffprobe`.

- [ ] **Step 3: Montage live smoke** — needs a real track in `./music/montagem/` (ask the user to drop one if empty — do NOT source audio yourself) and a fitness/sports YouTube URL. Run:

```bash
node dist/cli/index.js montage "<url>" --duration 25
```

Verify, by extracting frames around key times from `montage_manifest.json`:
1. cuts land on beats (eyeball frame changes against the drop time),
2. flash frames present at drop cuts,
3. slowmo + freeze payoff at the end,
4. counter renders ONLY if the label call passed (check logs),
5. payoff image generated or clean fallback (logs say which),
6. free-tier key rotation visible in logs if quota hits.

- [ ] **Step 4: Fix-forward** any live-smoke failures as `fix(montage): ...` commits (free-tier Gemini shape surprises are expected — extend `normalizeCounterRaw` tolerance as needed, mirroring the arc engine's history).

- [ ] **Step 5: Final commit + report** — summarize what was verified live vs. unit-tested only (call out anything not exercised live, e.g. multi-video input if only one URL was smoked).
