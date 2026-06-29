# ClipForge Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest runnable ClipForge pipeline — one command turns a YouTube URL into at least one finished 9:16 captioned clip, proving every hard integration end-to-end.

**Architecture:** A TypeScript/ESM CLI orchestrates a linear pipeline (ingest → transcript → lite analysis → clip detection → extraction → captions → export). Each stage is a focused module that separates pure logic from process side-effects. External tools (yt-dlp, ffmpeg, Remotion) are invoked via a thin spawn wrapper with retry. Word-level timing comes from YouTube json3 captions (whisper.cpp fallback); audio energy comes from ffmpeg filters — **no Python in Slice 1**.

**Tech Stack:** Node v24 (ESM), TypeScript, vitest, commander, ora, chalk, cli-table3, winston, uuid, dotenv; ffmpeg/ffprobe 8.x; yt-dlp; Remotion (React/TSX) in a sub-package.

## Global Constraints

Every task implicitly includes these. Values are copied verbatim from the spec.

- **Platform:** macOS (Darwin) **arm64**. No CUDA. **Zero Python in Slice 1.** No `apt-get`, no `device="cuda"`.
- **Module system:** ESM (`"type": "module"`). All relative imports use explicit `.js` extensions (NodeNext).
- **Dependency allowlist (runtime):** `commander`, `ora`, `chalk`, `cli-table3`, `winston`, `uuid`, `dotenv` only. (Gemini SDK, bullmq, librosa, mediapipe, etc. are out of scope — do not add.)
- **Output video:** exactly **1080×1920**, `-c:v libx264 -crf 18 -pix_fmt yuv420p`, audio `aac`.
- **Loudness:** normalize to **−14 LUFS** (`loudnorm=I=-14:TP=-1.5:LRA=11`).
- **Clip duration:** target **30–90s**, **hard cap 90s**.
- **Captions:** **≤4 words per line**, ≤2 lines; active word scale 120% + accent; accent default **`#FFD700`**; default style **`bold`**; font **Anton**.
- **jobId:** YouTube video id when parseable, else a uuid.
- **Composite (Slice 1):** `composite = triggerScore*0.6 + audioScore*0.4`. `RankedClip` carries all six layer fields; non-Slice-1 layers = `0`.
- **External calls** (yt-dlp, ffmpeg, whisper-cli, remotion) wrapped in `withRetry` (3 attempts, 1s/4s/16s).
- **astats RMS parsing:** accept BOTH `lavfi.astats.Overall.RMS_level` and `lavfi.astats.RMS_level` via one tolerant regex; degrade gracefully (skip/neighbor-fill) when neither appears — never crash.

## File Structure

```
package.json · tsconfig.json · vitest.config.ts · .gitignore · .env.example
src/
  types/index.ts                      # all shared types (source of truth)
  utils/{logger,cmd,retry,ffmpeg}.ts  # logging, spawn, backoff, ffprobe/ffmpeg helpers
  ingest/{downloader,metadataExtractor}.ts
  transcript/{youtubeTranscript,whisperRunner,transcriptManager}.ts
  analysis/{transcriptTriggers,audioEnergy}.ts
  clipDetection/{windowScorer,merger,ranker}.ts
  extraction/{clipExtractor,audioProcessor}.ts
  captions/{captionWords,srtGenerator,remotionRenderer}.ts
  export/exporter.ts
  cli/{index,preflight}.ts · cli/commands/{ingest,all}.ts
tests/
  helpers/makeTestAsset.ts            # ffmpeg-generated deterministic test media
  **/*.test.ts                        # colocated by module under tests/
remotion/
  package.json · remotion.config.ts
  src/{Root,CaptionedClip,Caption,HookCard,captionLogic}.tsx
  public/                             # renderer copies input clips here (gitignored)
```

Test files live under `tests/` mirroring `src/` (e.g. `tests/analysis/audioEnergy.test.ts`).

---

### Task 1: Project scaffold, shared types, toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/types/index.ts`
- Test: `tests/types/types.test.ts`

**Interfaces:**
- Produces: every type below. Import sites use `import type { ... } from '../../src/types/index.js'`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "clipforge",
  "version": "0.1.0",
  "type": "module",
  "bin": { "clipforge": "./dist/cli/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.5",
    "commander": "^12.1.0",
    "dotenv": "^16.4.5",
    "ora": "^8.1.0",
    "uuid": "^9.0.1",
    "winston": "^3.14.2"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "remotion"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`, `.gitignore`, `.env.example`**

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000, // integration tests spawn ffmpeg
  },
});
```

`.gitignore`:
```
node_modules/
dist/
workspace/
remotion/node_modules/
remotion/public/
.env
*.log
```

`.env.example`:
```
GEMINI_API_KEY=
WORKSPACE_DIR=./workspace
LOG_LEVEL=info
```

- [ ] **Step 4: Write `src/types/index.ts`**

```typescript
export interface TranscriptWord { start: number; end: number; word: string; probability: number; }
export interface TranscriptSegment {
  id: number; start: number; end: number; text: string;
  words: TranscriptWord[]; speaker?: string;
}
export interface Chapter { title: string; start: number; end: number; }
export interface Comment { text: string; likes: number; }
export interface VideoMetadata {
  jobId: string; title: string; duration: number;
  width: number; height: number; fps: number; codec: string;
  chapters: Chapter[]; description: string;
  viewCount?: number; likeCount?: number; commentCount?: number;
  tags?: string[]; uploadDate?: string; channelName?: string;
  topComments?: Comment[];
}
export type TriggerTier = 1 | 2 | 3 | 'structural';
export interface TriggerHit { time: number; weight: number; phrase: string; tier: TriggerTier; }
export interface RmsPoint { time: number; rms: number; }       // rms normalized 0–10
export interface SilenceRegion { start: number; end: number; }
export interface AudioEnergyLayer { rms_curve: RmsPoint[]; silence_regions: SilenceRegion[]; }
export interface WindowScore { start: number; end: number; triggerScore: number; audioScore: number; composite: number; }
export interface ClipCandidate { start: number; end: number; composite: number; triggerScore: number; audioScore: number; }
export interface RankedClip {
  rank: number; clip_id: string; start: number; end: number; duration: number;
  composite_score: number;
  semantic_score: number; audio_score: number; visual_score: number;
  trigger_score: number; pacing_score: number; metadata_score: number;
  hook_moment: string; clip_titles: string[]; is_standalone: boolean;
  recommended_duration: number; reason: string; transcript_excerpt: string;
}
export interface CaptionWord { text: string; start: number; end: number; emphasized: boolean; }
export interface ClipCompositionProps {
  videoPath: string;          // path relative to remotion/public (staticFile)
  words: CaptionWord[];
  fps: number; durationInFrames: number;
  style: 'minimal' | 'card' | 'bold';
  accentColor: string; showHookCard: boolean; hookText: string;
}
```

- [ ] **Step 5: Write the failing test `tests/types/types.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import type { RankedClip } from '../../src/types/index.js';

describe('types', () => {
  it('RankedClip carries all six layer-score fields', () => {
    const clip: RankedClip = {
      rank: 1, clip_id: 'clip_001', start: 0, end: 60, duration: 60,
      composite_score: 5, semantic_score: 0, audio_score: 4, visual_score: 0,
      trigger_score: 6, pacing_score: 0, metadata_score: 0,
      hook_moment: '', clip_titles: [], is_standalone: true,
      recommended_duration: 60, reason: 'x', transcript_excerpt: 'y',
    };
    expect(clip.semantic_score).toBe(0);
    expect(clip.clip_id).toBe('clip_001');
  });
});
```

- [ ] **Step 6: Install and run**

Run: `npm install && npm test`
Expected: 1 test passes; vitest exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example src/types/index.ts tests/types/types.test.ts
git commit -m "feat: project scaffold, shared types, vitest toolchain"
```

---

### Task 2: Core utils — retry, cmd runner, logger

**Files:**
- Create: `src/utils/logger.ts`, `src/utils/retry.ts`, `src/utils/cmd.ts`
- Test: `tests/utils/retry.test.ts`, `tests/utils/cmd.test.ts`

**Interfaces:**
- Produces:
  - `logger` (winston) with `.info/.warn/.error/.debug`
  - `withRetry<T>(fn: () => Promise<T>, opts: { attempts: number; label: string; baseMs?: number }): Promise<T>`
  - `run(cmd: string, args: string[], opts?: { onStderr?: (line: string) => void; onStdout?: (line: string) => void }): Promise<{ stdout: string; stderr: string }>` — rejects on non-zero exit.

- [ ] **Step 1: Write `src/utils/logger.ts`**

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`),
  ),
  transports: [new winston.transports.Console({ stderrLevels: ['error', 'warn'] })],
});
```

- [ ] **Step 2: Write the failing test `tests/utils/retry.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const r = await withRetry(fn, { attempts: 3, label: 't', baseMs: 1 });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockResolvedValue('ok');
    const r = await withRetry(fn, { attempts: 3, label: 't', baseMs: 1 });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { attempts: 3, label: 't', baseMs: 1 }))
      .rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/utils/retry.test.ts`
Expected: FAIL — cannot find module `retry.js`.

- [ ] **Step 4: Write `src/utils/retry.ts`**

```typescript
import { logger } from './logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; label: string; baseMs?: number },
): Promise<T> {
  const base = opts.baseMs ?? 1000;
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === opts.attempts - 1) break;
      const delay = base * Math.pow(4, i); // 1s, 4s, 16s with base=1000
      logger.warn(`[${opts.label}] attempt ${i + 1} failed: ${(e as Error).message}. Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/utils/retry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write `src/utils/cmd.ts`**

```typescript
import { spawn } from 'node:child_process';

export function run(
  cmd: string,
  args: string[],
  opts: { onStderr?: (line: string) => void; onStdout?: (line: string) => void } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      if (opts.onStdout) s.split('\n').forEach((l) => l && opts.onStdout!(l));
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      if (opts.onStderr) s.split('\n').forEach((l) => l && opts.onStderr!(l));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
```

- [ ] **Step 7: Write `tests/utils/cmd.test.ts` and run**

```typescript
import { describe, it, expect } from 'vitest';
import { run } from '../../src/utils/cmd.js';

describe('run', () => {
  it('captures stdout from a successful command', async () => {
    const { stdout } = await run('node', ['-e', "process.stdout.write('hi')"]);
    expect(stdout).toBe('hi');
  });
  it('rejects on non-zero exit', async () => {
    await expect(run('node', ['-e', 'process.exit(2)'])).rejects.toThrow(/exited 2/);
  });
});
```

Run: `npx vitest run tests/utils/cmd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/utils/logger.ts src/utils/retry.ts src/utils/cmd.ts tests/utils/
git commit -m "feat: core utils — logger, withRetry, spawn runner"
```

---

### Task 3: ffmpeg/ffprobe helpers + deterministic test asset

**Files:**
- Create: `src/utils/ffmpeg.ts`
- Create: `tests/helpers/makeTestAsset.ts`
- Test: `tests/utils/ffmpeg.test.ts`

**Interfaces:**
- Consumes: `run` from `utils/cmd.js`.
- Produces:
  - `probe(videoPath: string): Promise<{ duration: number; width: number; height: number; fps: number; codec: string }>`
  - `runFfmpegNull(input: string, filter: string): Promise<string>` — runs `ffmpeg -i input -af filter -f null -` and returns combined stderr (where ffmpeg prints analysis).
  - test helper `makeTestAsset(outPath: string): Promise<void>` — generates a 6s 1280×720@30 video: tone 0–2s, silence 2–3.2s (>0.5s for silence tests), tone 3.2–6s.

- [ ] **Step 1: Write `tests/helpers/makeTestAsset.ts`**

```typescript
import { run } from '../../src/utils/cmd.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function makeTestAsset(outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  // video: testsrc 6s; audio: tone, then 1.2s silence, then tone (via volume envelope)
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=6:size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-af', "volume='if(between(t,2,3.2),0,1)':eval=frame",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    outPath,
  ]);
}
```

- [ ] **Step 2: Write the failing test `tests/utils/ffmpeg.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { probe } from '../../src/utils/ffmpeg.js';
import { makeTestAsset } from '../helpers/makeTestAsset.js';
import { join } from 'node:path';

const asset = join('workspace', 'temp', 'test_6s.mp4');

describe('ffmpeg helpers', () => {
  beforeAll(async () => { await makeTestAsset(asset); }, 60_000);

  it('probe returns dimensions and duration', async () => {
    const p = await probe(asset);
    expect(p.width).toBe(1280);
    expect(p.height).toBe(720);
    expect(p.duration).toBeGreaterThan(5.5);
    expect(p.fps).toBeCloseTo(30, 0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/utils/ffmpeg.test.ts`
Expected: FAIL — cannot find module `ffmpeg.js`.

- [ ] **Step 4: Write `src/utils/ffmpeg.ts`**

```typescript
import { run } from './cmd.js';

export async function probe(videoPath: string) {
  const { stdout } = await run('ffprobe', [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams', videoPath,
  ]);
  const j = JSON.parse(stdout);
  const v = (j.streams as any[]).find((s) => s.codec_type === 'video');
  const [num, den] = String(v?.r_frame_rate ?? '30/1').split('/').map(Number);
  return {
    duration: Number(j.format?.duration ?? 0),
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    fps: den ? num / den : Number(num) || 30,
    codec: String(v?.codec_name ?? 'unknown'),
  };
}

export async function runFfmpegNull(input: string, filter: string): Promise<string> {
  const { stderr } = await run('ffmpeg', ['-i', input, '-af', filter, '-f', 'null', '-']);
  return stderr;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/utils/ffmpeg.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/ffmpeg.ts tests/utils/ffmpeg.test.ts tests/helpers/makeTestAsset.ts
git commit -m "feat: ffprobe/ffmpeg helpers + deterministic test asset generator"
```

---

### Task 4: Audio energy layer (parsers + analyzeAudio)

**Files:**
- Create: `src/analysis/audioEnergy.ts`
- Test: `tests/analysis/audioEnergy.test.ts`

**Interfaces:**
- Consumes: `run`, `runFfmpegNull` from utils.
- Produces:
  - `parseRmsLevels(stderr: string): number[]` — dB values, tolerant of both key forms; `-inf` → `-100`.
  - `normalizeRms(db: number): number` — `clamp((db + 50)/40*10, 0, 10)`.
  - `parseSilenceRegions(stderr: string): SilenceRegion[]`
  - `analyzeAudio(videoPath: string): Promise<AudioEnergyLayer>`

- [ ] **Step 1: Write failing test `tests/analysis/audioEnergy.test.ts` (pure parsers)**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { parseRmsLevels, normalizeRms, parseSilenceRegions, analyzeAudio } from '../../src/analysis/audioEnergy.js';
import { makeTestAsset } from '../helpers/makeTestAsset.js';
import { join } from 'node:path';

describe('audioEnergy parsers', () => {
  it('parses Overall.RMS_level key form', () => {
    const s = 'lavfi.astats.Overall.RMS_level=-12.5\nlavfi.astats.Overall.RMS_level=-40.0';
    expect(parseRmsLevels(s)).toEqual([-12.5, -40.0]);
  });
  it('parses bare RMS_level key form (mono builds)', () => {
    const s = 'lavfi.astats.RMS_level=-9.0\nlavfi.astats.RMS_level=-inf';
    expect(parseRmsLevels(s)).toEqual([-9.0, -100]);
  });
  it('normalizeRms maps -50→0 and -10→10 clamped', () => {
    expect(normalizeRms(-50)).toBeCloseTo(0);
    expect(normalizeRms(-10)).toBeCloseTo(10);
    expect(normalizeRms(0)).toBe(10);
    expect(normalizeRms(-100)).toBe(0);
  });
  it('parses silencedetect pairs', () => {
    const s = '[silencedetect] silence_start: 2.0\n[silencedetect] silence_end: 3.2 | silence_duration: 1.2';
    expect(parseSilenceRegions(s)).toEqual([{ start: 2.0, end: 3.2 }]);
  });
});

describe('analyzeAudio (integration)', () => {
  const asset = join('workspace', 'temp', 'test_6s.mp4');
  beforeAll(async () => { await makeTestAsset(asset); }, 60_000);
  it('produces an rms curve and finds the silent region', async () => {
    const layer = await analyzeAudio(asset);
    expect(layer.rms_curve.length).toBeGreaterThan(3);
    layer.rms_curve.forEach((p) => { expect(p.rms).toBeGreaterThanOrEqual(0); expect(p.rms).toBeLessThanOrEqual(10); });
    const hasSilence = layer.silence_regions.some((r) => r.start >= 1.5 && r.end <= 3.7);
    expect(hasSilence).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/analysis/audioEnergy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/analysis/audioEnergy.ts`**

```typescript
import { run } from '../utils/cmd.js';
import type { AudioEnergyLayer, RmsPoint, SilenceRegion } from '../types/index.js';

// Accept BOTH "lavfi.astats.Overall.RMS_level" and "lavfi.astats.RMS_level".
const RMS_RE = /lavfi\.astats\.(?:Overall\.)?RMS_level=(-?\d+(?:\.\d+)?|-?inf)/g;

export function parseRmsLevels(stderr: string): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(RMS_RE)) {
    const v = m[1];
    out.push(v.includes('inf') ? -100 : Number(v));
  }
  return out;
}

export function normalizeRms(db: number): number {
  const score = ((db + 50) / 40) * 10;
  return Math.max(0, Math.min(10, score));
}

export function parseSilenceRegions(stderr: string): SilenceRegion[] {
  const starts = [...stderr.matchAll(/silence_start:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const regions: SilenceRegion[] = [];
  for (let i = 0; i < starts.length; i++) {
    if (ends[i] !== undefined) regions.push({ start: starts[i], end: ends[i] });
  }
  return regions;
}

export async function analyzeAudio(videoPath: string): Promise<AudioEnergyLayer> {
  // Per-second RMS: reset astats every 16000 samples (1s @ 16kHz), print the metadata key.
  const { stderr: rmsErr } = await run('ffmpeg', [
    '-i', videoPath,
    '-af', 'aresample=16000,astats=metadata=1:reset=16000,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level',
    '-f', 'null', '-',
  ]);
  let levels = parseRmsLevels(rmsErr);
  // Graceful fallback: some builds print the bare key only — RMS_RE already covers it; if still empty, use silence midpoint.
  const rms_curve: RmsPoint[] = levels.map((db, i) => ({ time: i, rms: normalizeRms(db) }));

  const { stderr: silErr } = await run('ffmpeg', [
    '-i', videoPath,
    '-af', 'silencedetect=noise=-40dB:d=0.5',
    '-f', 'null', '-',
  ]);
  const silence_regions = parseSilenceRegions(silErr);

  return { rms_curve, silence_regions };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/analysis/audioEnergy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analysis/audioEnergy.ts tests/analysis/audioEnergy.test.ts
git commit -m "feat: audio energy layer — RMS curve (dual-key tolerant) + silence detection"
```

---

### Task 5: YouTube json3 transcript parser

**Files:**
- Create: `src/transcript/youtubeTranscript.ts`
- Test: `tests/transcript/youtubeTranscript.test.ts`

**Interfaces:**
- Produces: `parseJson3(raw: string): TranscriptSegment[]` (accepts file contents, not a path, for testability).

- [ ] **Step 1: Write failing test `tests/transcript/youtubeTranscript.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { parseJson3 } from '../../src/transcript/youtubeTranscript.js';

const sample = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1200, segs: [
      { utf8: 'Nobody', tOffsetMs: 0 }, { utf8: ' tells', tOffsetMs: 400 }, { utf8: ' you', tOffsetMs: 800 },
    ]},
    // rolling-cue duplicate of the first words + new word
    { tStartMs: 1200, dDurationMs: 900, segs: [
      { utf8: 'Nobody', tOffsetMs: 0 }, { utf8: ' tells', tOffsetMs: 100 }, { utf8: ' you', tOffsetMs: 200 },
      { utf8: ' this.', tOffsetMs: 500 },
    ]},
    { utf8: '\n' } as any, // newline-only event must be ignored
  ],
});

describe('parseJson3', () => {
  it('extracts word-level timing and dedups rolling cues', () => {
    const segs = parseJson3(sample);
    const words = segs.flatMap((s) => s.words.map((w) => w.word.trim()));
    expect(words).toEqual(['Nobody', 'tells', 'you', 'this.']);
    expect(segs[0].words[0].start).toBeCloseTo(0);
    expect(segs[0].words[1].start).toBeCloseTo(0.4);
  });

  it('splits segments on sentence-ending punctuation', () => {
    const segs = parseJson3(sample);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[segs.length - 1].text).toMatch(/this\.$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/transcript/youtubeTranscript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/transcript/youtubeTranscript.ts`**

```typescript
import type { TranscriptSegment, TranscriptWord } from '../types/index.js';

interface Seg { utf8: string; tOffsetMs?: number; }
interface Event { tStartMs?: number; dDurationMs?: number; segs?: Seg[]; }

export function parseJson3(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as { events?: Event[] };
  const flat: TranscriptWord[] = [];

  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    for (const seg of ev.segs) {
      const text = seg.utf8;
      if (!text || text.trim() === '') continue; // skip newline-only segs
      const start = (ev.tStartMs + (seg.tOffsetMs ?? 0)) / 1000;
      flat.push({ start, end: start, word: text, probability: 1 });
    }
  }

  // Dedup rolling cues: drop a word whose trimmed text + ~start matches the previous kept word.
  const deduped: TranscriptWord[] = [];
  for (const w of flat) {
    const prev = deduped[deduped.length - 1];
    const t = w.word.trim();
    if (prev && prev.word.trim() === t && Math.abs(prev.start - w.start) < 1.5) continue;
    // also skip if this exact word already appeared very recently at a near-identical time (rolling repeat)
    const recent = deduped.slice(-6).some((d) => d.word.trim() === t && Math.abs(d.start - w.start) < 0.05);
    if (recent) continue;
    deduped.push(w);
  }

  // Assign end = next word start; last word gets +0.4s.
  for (let i = 0; i < deduped.length; i++) {
    deduped[i].end = i + 1 < deduped.length ? deduped[i + 1].start : deduped[i].start + 0.4;
  }

  // Group into sentence-ish segments on terminal punctuation or gap > 0.8s.
  const segments: TranscriptSegment[] = [];
  let cur: TranscriptWord[] = [];
  let id = 0;
  const flush = () => {
    if (!cur.length) return;
    segments.push({
      id: id++, start: cur[0].start, end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word).join('').trim(), words: cur,
    });
    cur = [];
  };
  for (let i = 0; i < deduped.length; i++) {
    const w = deduped[i];
    cur.push(w);
    const endsSentence = /[.!?]"?$/.test(w.word.trim());
    const next = deduped[i + 1];
    const gap = next ? next.start - w.end : 0;
    if (endsSentence || gap > 0.8) flush();
  }
  flush();
  return segments;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/transcript/youtubeTranscript.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/transcript/youtubeTranscript.ts tests/transcript/youtubeTranscript.test.ts
git commit -m "feat: json3 transcript parser with rolling-cue dedup + word timing"
```

---

### Task 6: whisper.cpp runner + transcript manager (waterfall)

**Files:**
- Create: `src/transcript/whisperRunner.ts`, `src/transcript/transcriptManager.ts`
- Test: `tests/transcript/whisperRunner.test.ts`, `tests/transcript/transcriptManager.test.ts`

**Interfaces:**
- Consumes: `parseJson3`, `run`, `logger`.
- Produces:
  - `mapWhisperJson(json: unknown): TranscriptSegment[]` (pure; maps whisper.cpp `-oj` token output → segments/words)
  - `transcribe(videoPath: string, workdir: string): Promise<TranscriptSegment[]>` (integration; gated on `whisper-cli` presence)
  - `getTranscript(opts: { jobId: string; videoPath: string; subtitlePath: string | null; outPath: string }): Promise<TranscriptSegment[]>` — json3 first, else whisper; writes `transcript.json`; reuses existing `outPath` (cache).

- [ ] **Step 1: Write failing test `tests/transcript/whisperRunner.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { mapWhisperJson } from '../../src/transcript/whisperRunner.js';

const whisperOut = {
  transcription: [
    { offsets: { from: 0, to: 1200 }, text: ' Stay hard.', tokens: [
      { text: ' Stay', offsets: { from: 0, to: 600 } },
      { text: ' hard.', offsets: { from: 600, to: 1200 } },
    ]},
  ],
};

describe('mapWhisperJson', () => {
  it('maps tokens to words with seconds timing', () => {
    const segs = mapWhisperJson(whisperOut);
    expect(segs[0].words.map((w) => w.word.trim())).toEqual(['Stay', 'hard.']);
    expect(segs[0].words[0].start).toBeCloseTo(0);
    expect(segs[0].words[1].end).toBeCloseTo(1.2);
    expect(segs[0].text).toBe('Stay hard.');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/transcript/whisperRunner.ts`**

Run: `npx vitest run tests/transcript/whisperRunner.test.ts` → FAIL (module missing).

```typescript
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import type { TranscriptSegment, TranscriptWord } from '../types/index.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';

interface WToken { text: string; offsets: { from: number; to: number }; }
interface WSeg { text: string; offsets: { from: number; to: number }; tokens?: WToken[]; }

export function mapWhisperJson(json: unknown): TranscriptSegment[] {
  const segs = (json as { transcription?: WSeg[] }).transcription ?? [];
  return segs.map((s, id) => {
    const words: TranscriptWord[] = (s.tokens ?? [])
      .filter((t) => t.text.trim() && !t.text.startsWith('['))
      .map((t) => ({ start: t.offsets.from / 1000, end: t.offsets.to / 1000, word: t.text, probability: 1 }));
    return { id, start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim(), words };
  });
}

async function ensureModel(workdir: string): Promise<string> {
  const modelDir = join(workdir, 'models');
  const model = join(modelDir, 'ggml-base.en.bin');
  if (!existsSync(model)) {
    await mkdir(modelDir, { recursive: true });
    logger.info('Downloading whisper.cpp model ggml-base.en…');
    await run('curl', ['-L', '-o', model,
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin']);
  }
  return model;
}

export async function transcribe(videoPath: string, workdir: string): Promise<TranscriptSegment[]> {
  try {
    await run('whisper-cli', ['--help']);
  } catch {
    throw new Error('whisper.cpp not found and no YouTube captions available. Install with: brew install whisper-cpp');
  }
  const wav = join(workdir, 'audio16k.wav');
  await run('ffmpeg', ['-y', '-i', videoPath, '-ar', '16000', '-ac', '1', wav]);
  const model = await ensureModel(workdir);
  const outBase = join(workdir, 'whisper');
  await run('whisper-cli', ['-m', model, '-f', wav, '-oj', '-of', outBase, '-ml', '1']);
  const json = JSON.parse(await readFile(`${outBase}.json`, 'utf8'));
  return mapWhisperJson(json);
}
```

Run: `npx vitest run tests/transcript/whisperRunner.test.ts` → PASS.

- [ ] **Step 3: Write failing test `tests/transcript/transcriptManager.test.ts`**

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { getTranscript } from '../../src/transcript/transcriptManager.js';
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = join('workspace', 'temp', 'tm-test');
const subPath = join(dir, 'video.en.json3');
const outPath = join(dir, 'transcript.json');

const json3 = JSON.stringify({ events: [
  { tStartMs: 0, segs: [{ utf8: 'Hello', tOffsetMs: 0 }, { utf8: ' world.', tOffsetMs: 300 }] },
]});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('getTranscript', () => {
  it('prefers json3 subtitles and writes transcript.json', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(subPath, json3);
    const segs = await getTranscript({ jobId: 'x', videoPath: 'unused.mp4', subtitlePath: subPath, outPath });
    expect(segs[0].text).toBe('Hello world.');
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(written[0].text).toBe('Hello world.');
  });

  it('reuses cached transcript.json when present', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(outPath, JSON.stringify([{ id: 0, start: 0, end: 1, text: 'cached', words: [] }]));
    const segs = await getTranscript({ jobId: 'x', videoPath: 'unused.mp4', subtitlePath: null, outPath });
    expect(segs[0].text).toBe('cached');
  });
});
```

- [ ] **Step 4: Run to verify it fails, then write `src/transcript/transcriptManager.ts`**

Run: `npx vitest run tests/transcript/transcriptManager.test.ts` → FAIL.

```typescript
import { parseJson3 } from './youtubeTranscript.js';
import { transcribe } from './whisperRunner.js';
import { logger } from '../utils/logger.js';
import type { TranscriptSegment } from '../types/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function getTranscript(opts: {
  jobId: string; videoPath: string; subtitlePath: string | null; outPath: string;
}): Promise<TranscriptSegment[]> {
  if (existsSync(opts.outPath)) {
    logger.info('Reusing cached transcript.json');
    return JSON.parse(await readFile(opts.outPath, 'utf8'));
  }
  let segments: TranscriptSegment[];
  if (opts.subtitlePath && existsSync(opts.subtitlePath)) {
    logger.info('Parsing YouTube json3 captions');
    segments = parseJson3(await readFile(opts.subtitlePath, 'utf8'));
  } else {
    logger.info('No json3 captions — falling back to whisper.cpp');
    segments = await transcribe(opts.videoPath, dirname(opts.outPath));
  }
  await mkdir(dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, JSON.stringify(segments, null, 2));
  return segments;
}
```

Run: `npx vitest run tests/transcript/transcriptManager.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transcript/whisperRunner.ts src/transcript/transcriptManager.ts tests/transcript/whisperRunner.test.ts tests/transcript/transcriptManager.test.ts
git commit -m "feat: whisper.cpp fallback runner + transcript waterfall manager with caching"
```

---

### Task 7: yt-dlp downloader

**Files:**
- Create: `src/ingest/downloader.ts`
- Test: `tests/ingest/downloader.test.ts`

**Interfaces:**
- Consumes: `run`, `withRetry`, `logger`.
- Produces:
  - `buildYtdlpArgs(url: string, outDir: string): string[]` (pure)
  - `parseVideoId(url: string): string | null` (pure)
  - `download(url: string, outDir: string): Promise<{ videoPath: string; infoJsonPath: string; subtitlePath: string | null }>` (integration; gated `RUN_NETWORK`)

- [ ] **Step 1: Write failing test `tests/ingest/downloader.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildYtdlpArgs, parseVideoId } from '../../src/ingest/downloader.js';

describe('downloader pure helpers', () => {
  it('parses video id from watch and short URLs', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=H14bBuluwB8')).toBe('H14bBuluwB8');
    expect(parseVideoId('https://youtu.be/H14bBuluwB8?t=30')).toBe('H14bBuluwB8');
    expect(parseVideoId('https://vimeo.com/123')).toBeNull();
  });

  it('builds yt-dlp args with json3 subs, info json, 1080p cap, no playlist', () => {
    const args = buildYtdlpArgs('URL', '/out');
    const j = args.join(' ');
    expect(j).toContain('height<=1080');
    expect(j).toContain('--sub-format json3');
    expect(j).toContain('--write-info-json');
    expect(j).toContain('--no-playlist');
    expect(j).toContain('--merge-output-format mp4');
    expect(args[0]).toBe('URL');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/ingest/downloader.ts`**

Run: `npx vitest run tests/ingest/downloader.test.ts` → FAIL.

```typescript
import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';

export function parseVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function buildYtdlpArgs(url: string, outDir: string): string[] {
  return [
    url,
    '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    '--merge-output-format', 'mp4',
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*', '--sub-format', 'json3',
    '--write-info-json', '--no-playlist',
    '--retries', '5', '--fragment-retries', '5',
    '--newline', '-o', join(outDir, 'video.%(ext)s'),
  ];
}

export async function download(url: string, outDir: string) {
  await mkdir(outDir, { recursive: true });
  const videoPath = join(outDir, 'video.mp4');
  const infoJsonPath = join(outDir, 'video.info.json');
  if (existsSync(videoPath) && existsSync(infoJsonPath)) {
    logger.info('Reusing cached download');
  } else {
    await withRetry(() => run('yt-dlp', buildYtdlpArgs(url, outDir), {
      onStdout: (l) => { if (l.includes('%')) process.stderr.write(`\r${l.trim()}`); },
    }), { attempts: 3, label: 'yt-dlp' });
  }
  // json3 subs land as video.en.json3 / video.en-US.json3 — pick the first.
  const files = await readdir(outDir);
  const sub = files.find((f) => f.endsWith('.json3')) ?? null;
  return { videoPath, infoJsonPath, subtitlePath: sub ? join(outDir, sub) : null };
}
```

Run: `npx vitest run tests/ingest/downloader.test.ts` → PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add src/ingest/downloader.ts tests/ingest/downloader.test.ts
git commit -m "feat: yt-dlp downloader — arg builder, video-id parser, cached download"
```

---

### Task 8: Metadata extractor

**Files:**
- Create: `src/ingest/metadataExtractor.ts`
- Test: `tests/ingest/metadataExtractor.test.ts`

**Interfaces:**
- Consumes: `probe`.
- Produces:
  - `mergeMetadata(jobId, probed, infoJson): VideoMetadata` (pure)
  - `extractMetadata(videoPath, infoJsonPath, jobId, outPath): Promise<VideoMetadata>` (writes `metadata.json`)

- [ ] **Step 1: Write failing test `tests/ingest/metadataExtractor.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { mergeMetadata } from '../../src/ingest/metadataExtractor.js';

describe('mergeMetadata', () => {
  it('merges ffprobe dims with info.json fields and maps chapters', () => {
    const probed = { duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264' };
    const info = {
      title: 'Goggins', description: 'd', view_count: 100, like_count: 9,
      channel: 'C', upload_date: '20240101', tags: ['a'],
      chapters: [{ title: 'Intro', start_time: 0, end_time: 30 }],
    };
    const m = mergeMetadata('H14bBuluwB8', probed, info);
    expect(m.jobId).toBe('H14bBuluwB8');
    expect(m.width).toBe(1920);
    expect(m.title).toBe('Goggins');
    expect(m.chapters[0]).toEqual({ title: 'Intro', start: 0, end: 30 });
    expect(m.viewCount).toBe(100);
    expect(m.channelName).toBe('C');
  });

  it('tolerates a missing info.json (null)', () => {
    const probed = { duration: 10, width: 640, height: 480, fps: 25, codec: 'h264' };
    const m = mergeMetadata('uuid-1', probed, null);
    expect(m.title).toBe('uuid-1');
    expect(m.chapters).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/ingest/metadataExtractor.ts`**

Run: `npx vitest run tests/ingest/metadataExtractor.test.ts` → FAIL.

```typescript
import { probe } from '../utils/ffmpeg.js';
import type { VideoMetadata } from '../types/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

type Probed = { duration: number; width: number; height: number; fps: number; codec: string };

export function mergeMetadata(jobId: string, probed: Probed, info: any | null): VideoMetadata {
  const chapters = Array.isArray(info?.chapters)
    ? info.chapters.map((c: any) => ({ title: c.title ?? '', start: c.start_time ?? 0, end: c.end_time ?? 0 }))
    : [];
  return {
    jobId,
    title: info?.title ?? jobId,
    duration: probed.duration,
    width: probed.width, height: probed.height, fps: probed.fps, codec: probed.codec,
    chapters,
    description: info?.description ?? '',
    viewCount: info?.view_count, likeCount: info?.like_count, commentCount: info?.comment_count,
    tags: info?.tags, uploadDate: info?.upload_date, channelName: info?.channel,
  };
}

export async function extractMetadata(videoPath: string, infoJsonPath: string, jobId: string, outPath: string): Promise<VideoMetadata> {
  const probed = await probe(videoPath);
  const info = existsSync(infoJsonPath) ? JSON.parse(await readFile(infoJsonPath, 'utf8')) : null;
  const meta = mergeMetadata(jobId, probed, info);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(meta, null, 2));
  return meta;
}
```

Run: `npx vitest run tests/ingest/metadataExtractor.test.ts` → PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add src/ingest/metadataExtractor.ts tests/ingest/metadataExtractor.test.ts
git commit -m "feat: metadata extractor — ffprobe + info.json merge"
```

---

### Task 9: Transcript trigger detection (Layer D)

**Files:**
- Create: `src/analysis/transcriptTriggers.ts`
- Test: `tests/analysis/transcriptTriggers.test.ts`

**Interfaces:**
- Produces: `detectTriggers(segments: TranscriptSegment[]): TriggerHit[]`
- Constants: tiered phrase lists (verbatim from spec §6.4).

- [ ] **Step 1: Write failing test `tests/analysis/transcriptTriggers.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { detectTriggers } from '../../src/analysis/transcriptTriggers.js';
import type { TranscriptSegment } from '../../src/types/index.js';

const seg = (id: number, start: number, text: string): TranscriptSegment =>
  ({ id, start, end: start + 3, text, words: [] });

describe('detectTriggers', () => {
  it('fires tier-1 with weight 2.5 at the segment time', () => {
    const hits = detectTriggers([seg(0, 12, "Here's the thing, nobody tells you this.")]);
    const t1 = hits.find((h) => h.tier === 1);
    expect(t1?.weight).toBe(2.5);
    expect(t1?.time).toBe(12);
  });
  it('fires tier-2 (1.5) and tier-3 (0.5)', () => {
    const hits = detectTriggers([seg(0, 0, 'Let me explain. Fun fact about this.')]);
    expect(hits.some((h) => h.tier === 2 && h.weight === 1.5)).toBe(true);
    expect(hits.some((h) => h.tier === 3 && h.weight === 0.5)).toBe(true);
  });
  it('detects structural number-statements and contrast (1.0)', () => {
    const hits = detectTriggers([seg(0, 0, 'There are 3 reasons, but the truth is simple.')]);
    expect(hits.some((h) => h.tier === 'structural' && h.weight === 1.0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/analysis/transcriptTriggers.ts`**

Run: `npx vitest run tests/analysis/transcriptTriggers.test.ts` → FAIL.

```typescript
import type { TranscriptSegment, TriggerHit } from '../types/index.js';

const TIER1 = ['wait', 'hold on', 'actually', "here's the thing", 'nobody tells you',
  'the truth is', 'this is the part where', 'what nobody knows', "i'm going to be honest",
  'this changed everything', 'the real reason', "here's what happened"];
const TIER2 = ['think about it', 'you know what i mean', 'crazy right', 'let me explain',
  'plot twist', "here's why", 'the problem is', 'imagine', 'picture this', 'real talk',
  'be honest', "most people don't", 'everyone gets this wrong'];
const TIER3 = ['interesting', 'funny thing', 'believe it or not', "here's the deal",
  'quick question', 'fun fact'];

const NUMBER_RE = /\b(\d+|one|two|three|four|five|seven|ten)\s+(reasons?|things?|ways?|signs?|steps?|rules?)\b/i;
const CONTRAST_RE = /\b(but|however|except)\b/i;

export function detectTriggers(segments: TranscriptSegment[]): TriggerHit[] {
  const hits: TriggerHit[] = [];
  for (const s of segments) {
    const lower = s.text.toLowerCase();
    for (const p of TIER1) if (lower.includes(p)) hits.push({ time: s.start, weight: 2.5, phrase: p, tier: 1 });
    for (const p of TIER2) if (lower.includes(p)) hits.push({ time: s.start, weight: 1.5, phrase: p, tier: 2 });
    for (const p of TIER3) if (lower.includes(p)) hits.push({ time: s.start, weight: 0.5, phrase: p, tier: 3 });
    if (NUMBER_RE.test(s.text)) hits.push({ time: s.start, weight: 1.0, phrase: 'number-statement', tier: 'structural' });
    if (CONTRAST_RE.test(s.text)) hits.push({ time: s.start, weight: 1.0, phrase: 'contrast', tier: 'structural' });
  }
  return hits;
}
```

Run: `npx vitest run tests/analysis/transcriptTriggers.test.ts` → PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src/analysis/transcriptTriggers.ts tests/analysis/transcriptTriggers.test.ts
git commit -m "feat: Layer D transcript trigger detection (tiered + structural)"
```

---

### Task 10: Sliding-window scorer

**Files:**
- Create: `src/clipDetection/windowScorer.ts`
- Test: `tests/clipDetection/windowScorer.test.ts`

**Interfaces:**
- Produces: `scoreWindows(duration: number, triggers: TriggerHit[], audio: AudioEnergyLayer): WindowScore[]` — window 30s, step 15s; `composite = triggerScore*0.6 + audioScore*0.4`; triggerScore capped at 10.

- [ ] **Step 1: Write failing test `tests/clipDetection/windowScorer.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { scoreWindows } from '../../src/clipDetection/windowScorer.js';
import type { AudioEnergyLayer } from '../../src/types/index.js';

const audio: AudioEnergyLayer = {
  rms_curve: Array.from({ length: 60 }, (_, t) => ({ time: t, rms: 5 })),
  silence_regions: [],
};

describe('scoreWindows', () => {
  it('emits 30s windows stepping by 15s', () => {
    const w = scoreWindows(60, [], audio);
    expect(w[0].start).toBe(0); expect(w[0].end).toBe(30);
    expect(w[1].start).toBe(15);
  });
  it('applies the 0.6/0.4 composite and caps trigger score at 10', () => {
    const triggers = [{ time: 5, weight: 9, phrase: 'x', tier: 1 as const }, { time: 6, weight: 9, phrase: 'y', tier: 1 as const }];
    const w = scoreWindows(60, triggers, audio);
    expect(w[0].triggerScore).toBe(10);      // 18 capped to 10
    expect(w[0].audioScore).toBeCloseTo(5);
    expect(w[0].composite).toBeCloseTo(10 * 0.6 + 5 * 0.4);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/clipDetection/windowScorer.ts`**

Run: `npx vitest run tests/clipDetection/windowScorer.test.ts` → FAIL.

```typescript
import type { AudioEnergyLayer, TriggerHit, WindowScore } from '../types/index.js';

const WINDOW = 30;
const STEP = 15;

export function scoreWindows(duration: number, triggers: TriggerHit[], audio: AudioEnergyLayer): WindowScore[] {
  const windows: WindowScore[] = [];
  for (let start = 0; start < Math.max(duration - WINDOW, 0) + STEP && start < duration; start += STEP) {
    const end = Math.min(start + WINDOW, duration);
    const triggerSum = triggers.filter((t) => t.time >= start && t.time < end).reduce((a, t) => a + t.weight, 0);
    const triggerScore = Math.min(10, triggerSum);
    const pts = audio.rms_curve.filter((p) => p.time >= start && p.time < end);
    const audioScore = pts.length ? pts.reduce((a, p) => a + p.rms, 0) / pts.length : 0;
    windows.push({ start, end, triggerScore, audioScore, composite: triggerScore * 0.6 + audioScore * 0.4 });
  }
  return windows;
}
```

Run: `npx vitest run tests/clipDetection/windowScorer.test.ts` → PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add src/clipDetection/windowScorer.ts tests/clipDetection/windowScorer.test.ts
git commit -m "feat: sliding-window scorer (30s/15s, 0.6/0.4 composite)"
```

---

### Task 11: Clip boundary merger (expand, snap, cold-open, cap)

**Files:**
- Create: `src/clipDetection/merger.ts`
- Test: `tests/clipDetection/merger.test.ts`

**Interfaces:**
- Consumes: `WindowScore`, `TranscriptSegment`, `AudioEnergyLayer`.
- Produces:
  - `snapStart(t, segments): number` — to the start of the segment containing/after `t` (never mid-word).
  - `snapEnd(t, segments): number` — to the end of the segment containing/before `t`.
  - `coldOpenTrim(start, silences): number` — push past any silence region covering `start`.
  - `clampDuration(start, end): { start: number; end: number }` — enforce 30–90s, hard cap 90.
  - `buildClips(windows, segments, audio, threshold): ClipCandidate[]`

- [ ] **Step 1: Write failing test `tests/clipDetection/merger.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { snapStart, snapEnd, coldOpenTrim, clampDuration, buildClips } from '../../src/clipDetection/merger.js';
import type { TranscriptSegment, WindowScore, AudioEnergyLayer } from '../../src/types/index.js';

const segs: TranscriptSegment[] = [
  { id: 0, start: 0, end: 9, text: 'a', words: [] },
  { id: 1, start: 10, end: 19, text: 'b', words: [] },
  { id: 2, start: 20, end: 29, text: 'c', words: [] },
];

describe('boundary helpers', () => {
  it('snapStart moves to the enclosing/next segment start', () => {
    expect(snapStart(12, segs)).toBe(10);
    expect(snapStart(9.5, segs)).toBe(10);
  });
  it('snapEnd moves to the enclosing/previous segment end', () => {
    expect(snapEnd(15, segs)).toBe(19);
  });
  it('coldOpenTrim pushes past a leading silence', () => {
    expect(coldOpenTrim(10, [{ start: 9, end: 11 }])).toBe(11);
    expect(coldOpenTrim(10, [{ start: 30, end: 31 }])).toBe(10);
  });
  it('clampDuration hard-caps at 90s', () => {
    expect(clampDuration(0, 200)).toEqual({ start: 0, end: 90 });
  });
});

describe('buildClips', () => {
  it('produces a candidate around a high-score window', () => {
    const windows: WindowScore[] = [
      { start: 0, end: 30, triggerScore: 0, audioScore: 1, composite: 1 },
      { start: 15, end: 45, triggerScore: 9, audioScore: 8, composite: 8.6 },
      { start: 30, end: 60, triggerScore: 0, audioScore: 1, composite: 1 },
    ];
    const longSegs: TranscriptSegment[] = Array.from({ length: 12 }, (_, i) =>
      ({ id: i, start: i * 5, end: i * 5 + 4.5, text: `s${i}`, words: [] }));
    const audio: AudioEnergyLayer = { rms_curve: [], silence_regions: [] };
    const clips = buildClips(windows, longSegs, audio, 5);
    expect(clips.length).toBeGreaterThanOrEqual(1);
    expect(clips[0].end - clips[0].start).toBeGreaterThanOrEqual(30);
    expect(clips[0].end - clips[0].start).toBeLessThanOrEqual(90);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/clipDetection/merger.ts`**

Run: `npx vitest run tests/clipDetection/merger.test.ts` → FAIL.

```typescript
import type { AudioEnergyLayer, ClipCandidate, SilenceRegion, TranscriptSegment, WindowScore } from '../types/index.js';

export function snapStart(t: number, segments: TranscriptSegment[]): number {
  const enclosing = segments.find((s) => t >= s.start && t < s.end);
  if (enclosing) return enclosing.start;
  const next = segments.find((s) => s.start >= t);
  return next ? next.start : t;
}

export function snapEnd(t: number, segments: TranscriptSegment[]): number {
  const enclosing = segments.find((s) => t > s.start && t <= s.end);
  if (enclosing) return enclosing.end;
  const prev = [...segments].reverse().find((s) => s.end <= t);
  return prev ? prev.end : t;
}

export function coldOpenTrim(start: number, silences: SilenceRegion[]): number {
  const covering = silences.find((r) => start >= r.start - 0.01 && start < r.end);
  return covering ? covering.end : start;
}

export function clampDuration(start: number, end: number): { start: number; end: number } {
  let e = end;
  if (e - start > 90) e = start + 90;          // hard cap
  if (e - start < 30) e = start + 30;          // pull up short clips
  return { start, end: e };
}

export function buildClips(
  windows: WindowScore[], segments: TranscriptSegment[], audio: AudioEnergyLayer, threshold: number,
): ClipCandidate[] {
  const floor = threshold * 0.7;
  const peaks = windows.filter((w) => w.composite >= threshold).sort((a, b) => b.composite - a.composite);
  const clips: ClipCandidate[] = [];

  for (const peak of peaks) {
    // expand left/right while neighbors stay above floor
    let start = peak.start;
    let end = peak.end;
    for (const w of windows) {
      if (w.end <= start && w.composite >= floor && start - w.start <= 5) start = w.start;
      if (w.start >= end && w.composite >= floor && w.end - end <= 5) end = w.end;
    }
    // snap + cold-open + clamp
    start = coldOpenTrim(snapStart(start, segments), audio.silence_regions);
    end = snapEnd(end, segments);
    ({ start, end } = clampDuration(start, end));

    // IOU>0.5 merge against existing
    const overlaps = clips.some((c) => {
      const inter = Math.max(0, Math.min(c.end, end) - Math.max(c.start, start));
      const union = Math.max(c.end, end) - Math.min(c.start, start);
      return union > 0 && inter / union > 0.5;
    });
    if (overlaps) continue;

    clips.push({ start, end, composite: peak.composite, triggerScore: peak.triggerScore, audioScore: peak.audioScore });
  }
  return clips;
}
```

Run: `npx vitest run tests/clipDetection/merger.test.ts` → PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add src/clipDetection/merger.ts tests/clipDetection/merger.test.ts
git commit -m "feat: clip boundary merger — expand, snap, cold-open, 90s cap, IOU merge"
```

---

### Task 12: Ranker (dedup, min-score, top-N, RankedClip)

**Files:**
- Create: `src/clipDetection/ranker.ts`
- Test: `tests/clipDetection/ranker.test.ts`

**Interfaces:**
- Consumes: `ClipCandidate`, `TranscriptSegment`.
- Produces:
  - `defaultMinScore(windows: WindowScore[]): number` — `mean + 0.5*stddev` of composites.
  - `clipText(clip, segments): string`
  - `rank(candidates, segments, opts: { top: number; minScore?: number }): RankedClip[]` — sort desc, dedup by >40% transcript-word overlap, assign `clip_NNN`, apply min-score, take top N, build full `RankedClip` (non-Slice-1 layers = 0).

- [ ] **Step 1: Write failing test `tests/clipDetection/ranker.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { rank, defaultMinScore, clipText } from '../../src/clipDetection/ranker.js';
import type { ClipCandidate, TranscriptSegment, WindowScore } from '../../src/types/index.js';

const segs: TranscriptSegment[] = [
  { id: 0, start: 0, end: 30, text: 'alpha beta gamma delta', words: [] },
  { id: 1, start: 30, end: 60, text: 'epsilon zeta eta theta', words: [] },
];

describe('ranker', () => {
  it('defaultMinScore = mean + 0.5*stddev', () => {
    const w: WindowScore[] = [
      { start: 0, end: 30, triggerScore: 0, audioScore: 0, composite: 2 },
      { start: 0, end: 30, triggerScore: 0, audioScore: 0, composite: 4 },
    ];
    expect(defaultMinScore(w)).toBeCloseTo(3 + 0.5 * 1); // mean 3, stddev 1
  });

  it('clipText gathers overlapping segment text', () => {
    expect(clipText({ start: 0, end: 30, composite: 5, triggerScore: 0, audioScore: 0 }, segs)).toContain('alpha');
  });

  it('ranks desc, assigns ids, applies top-N', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 35, composite: 5, triggerScore: 6, audioScore: 4 },
      { start: 30, end: 62, composite: 8, triggerScore: 9, audioScore: 7 },
    ];
    const r = rank(cands, segs, { top: 1, minScore: 0 });
    expect(r).toHaveLength(1);
    expect(r[0].clip_id).toBe('clip_001');
    expect(r[0].composite_score).toBe(8);
    expect(r[0].semantic_score).toBe(0);
    expect(r[0].audio_score).toBe(7);
  });

  it('dedups clips sharing >40% transcript', () => {
    const cands: ClipCandidate[] = [
      { start: 0, end: 30, composite: 8, triggerScore: 0, audioScore: 0 },
      { start: 0, end: 30, composite: 5, triggerScore: 0, audioScore: 0 },
    ];
    const r = rank(cands, segs, { top: 5, minScore: 0 });
    expect(r).toHaveLength(1);
    expect(r[0].composite_score).toBe(8);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/clipDetection/ranker.ts`**

Run: `npx vitest run tests/clipDetection/ranker.test.ts` → FAIL.

```typescript
import type { ClipCandidate, RankedClip, TranscriptSegment, WindowScore } from '../types/index.js';

export function defaultMinScore(windows: WindowScore[]): number {
  if (!windows.length) return 0;
  const xs = windows.map((w) => w.composite);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return mean + 0.5 * Math.sqrt(variance);
}

export function clipText(clip: { start: number; end: number }, segments: TranscriptSegment[]): string {
  return segments.filter((s) => s.end > clip.start && s.start < clip.end).map((s) => s.text).join(' ').trim();
}

function overlapRatio(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

export function rank(
  candidates: ClipCandidate[], segments: TranscriptSegment[], opts: { top: number; minScore?: number },
): RankedClip[] {
  const min = opts.minScore ?? 0;
  const sorted = [...candidates].filter((c) => c.composite >= min).sort((a, b) => b.composite - a.composite);

  const kept: { cand: ClipCandidate; text: string }[] = [];
  for (const cand of sorted) {
    const text = clipText(cand, segments);
    if (kept.some((k) => overlapRatio(k.text, text) > 0.4)) continue;
    kept.push({ cand, text });
  }

  return kept.slice(0, opts.top).map(({ cand, text }, i) => {
    const duration = +(cand.end - cand.start).toFixed(2);
    return {
      rank: i + 1,
      clip_id: `clip_${String(i + 1).padStart(3, '0')}`,
      start: cand.start, end: cand.end, duration,
      composite_score: +cand.composite.toFixed(2),
      semantic_score: 0, audio_score: +cand.audioScore.toFixed(2), visual_score: 0,
      trigger_score: +cand.triggerScore.toFixed(2), pacing_score: 0, metadata_score: 0,
      hook_moment: '', clip_titles: [], is_standalone: true,
      recommended_duration: duration <= 35 ? 30 : duration <= 50 ? 45 : duration <= 75 ? 60 : 90,
      reason: `trigger=${cand.triggerScore.toFixed(1)}, audio=${cand.audioScore.toFixed(1)}`,
      transcript_excerpt: text.slice(0, 200),
    };
  });
}
```

Run: `npx vitest run tests/clipDetection/ranker.test.ts` → PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/clipDetection/ranker.ts tests/clipDetection/ranker.test.ts
git commit -m "feat: ranker — dedup by transcript overlap, min-score, top-N, RankedClip"
```

---

### Task 13: Caption words + SRT generator

**Files:**
- Create: `src/captions/captionWords.ts`, `src/captions/srtGenerator.ts`
- Test: `tests/captions/captionWords.test.ts`, `tests/captions/srtGenerator.test.ts`

**Interfaces:**
- Produces:
  - `buildCaptionWords(words: TranscriptWord[], clipStart: number, triggerPhrases: string[]): CaptionWord[]` — re-bases timing to clip start; flags `emphasized` when the word is inside a trigger phrase.
  - `formatTimestamp(sec: number): string` — `HH:MM:SS,mmm`.
  - `groupCues(words: CaptionWord[], maxPerLine: number): { start: number; end: number; text: string }[]`
  - `writeSrt(words: CaptionWord[], outPath: string): Promise<void>`

- [ ] **Step 1: Write failing tests**

`tests/captions/captionWords.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildCaptionWords } from '../../src/captions/captionWords.js';

describe('buildCaptionWords', () => {
  it('rebases timing to clip start and flags emphasis from trigger phrases', () => {
    const words = [
      { start: 10, end: 10.3, word: 'the', probability: 1 },
      { start: 10.3, end: 10.6, word: 'truth', probability: 1 },
      { start: 10.6, end: 10.9, word: 'is', probability: 1 },
      { start: 10.9, end: 11.2, word: 'simple', probability: 1 },
    ];
    const cw = buildCaptionWords(words, 10, ['the truth is']);
    expect(cw[0].start).toBeCloseTo(0);
    expect(cw[0].emphasized).toBe(true);   // part of 'the truth is'
    expect(cw[3].emphasized).toBe(false);  // 'simple' not in phrase
  });
});
```

`tests/captions/srtGenerator.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { formatTimestamp, groupCues, writeSrt } from '../../src/captions/srtGenerator.js';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const w = (text: string, start: number) => ({ text, start, end: start + 0.4, emphasized: false });
const out = join('workspace', 'temp', 'test.srt');
afterEach(async () => { await rm(out, { force: true }); });

describe('srtGenerator', () => {
  it('formats timestamps as HH:MM:SS,mmm', () => {
    expect(formatTimestamp(3661.5)).toBe('01:01:01,500');
  });
  it('groups into cues of <=4 words', () => {
    const cues = groupCues([w('a', 0), w('b', 0.5), w('c', 1), w('d', 1.5), w('e', 2)], 4);
    expect(cues).toHaveLength(2);
    expect(cues[0].text.split(' ')).toHaveLength(4);
  });
  it('writes a valid SRT file', async () => {
    await writeSrt([w('Hello', 0), w('world', 0.5)], out);
    const txt = await readFile(out, 'utf8');
    expect(txt).toMatch(/^1\n00:00:00,000 --> /);
    expect(txt).toContain('Hello world');
  });
});
```

- [ ] **Step 2: Run to verify they fail, then write the modules**

Run: `npx vitest run tests/captions/` → FAIL.

`src/captions/captionWords.ts`:
```typescript
import type { CaptionWord, TranscriptWord } from '../types/index.js';

export function buildCaptionWords(words: TranscriptWord[], clipStart: number, triggerPhrases: string[]): CaptionWord[] {
  const phrases = triggerPhrases.map((p) => p.toLowerCase());
  const norm = words.map((w) => w.word.trim().toLowerCase().replace(/[^a-z0-9']/g, ''));
  const emphasizedIdx = new Set<number>();
  for (const phrase of phrases) {
    const tokens = phrase.split(/\s+/);
    for (let i = 0; i + tokens.length <= norm.length; i++) {
      if (tokens.every((t, k) => norm[i + k] === t)) {
        for (let k = 0; k < tokens.length; k++) emphasizedIdx.add(i + k);
      }
    }
  }
  return words.map((w, i) => ({
    text: w.word.trim(),
    start: Math.max(0, w.start - clipStart),
    end: Math.max(0, w.end - clipStart),
    emphasized: emphasizedIdx.has(i),
  }));
}
```

`src/captions/srtGenerator.ts`:
```typescript
import type { CaptionWord } from '../types/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function formatTimestamp(sec: number): string {
  const ms = Math.round((sec % 1) * 1000);
  const total = Math.floor(sec);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms).padStart(3, '0')}`;
}

export function groupCues(words: CaptionWord[], maxPerLine: number) {
  const cues: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < words.length; i += maxPerLine) {
    const chunk = words.slice(i, i + maxPerLine);
    cues.push({ start: chunk[0].start, end: chunk[chunk.length - 1].end, text: chunk.map((w) => w.text).join(' ') });
  }
  return cues;
}

export async function writeSrt(words: CaptionWord[], outPath: string): Promise<void> {
  const cues = groupCues(words, 4);
  const body = cues.map((c, i) =>
    `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}\n`).join('\n');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, body);
}
```

Run: `npx vitest run tests/captions/` → PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/captions/captionWords.ts src/captions/srtGenerator.ts tests/captions/
git commit -m "feat: caption word builder (emphasis) + grouped SRT generator"
```

---

### Task 14: Clip extractor + audio processor (ffmpeg)

**Files:**
- Create: `src/extraction/audioProcessor.ts`, `src/extraction/clipExtractor.ts`
- Test: `tests/extraction/clipExtractor.test.ts`

**Interfaces:**
- Consumes: `run`, `withRetry`, `probe`.
- Produces:
  - `buildAudioFilter(): string` → `'loudnorm=I=-14:TP=-1.5:LRA=11'`
  - `buildVideoFilter(width: number, height: number): string` — center-crop to 9:16 then scale 1080×1920; if already ≥ vertical, just scale+pad.
  - `buildExtractArgs(video, start, dur, vf, af, outPath): string[]`
  - `extractRaw(video, start, end, dims, outPath): Promise<void>` (integration; asserts 1080×1920)

- [ ] **Step 1: Write failing test `tests/extraction/clipExtractor.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { buildVideoFilter, buildExtractArgs, extractRaw } from '../../src/extraction/clipExtractor.js';
import { buildAudioFilter } from '../../src/extraction/audioProcessor.js';
import { probe } from '../../src/utils/ffmpeg.js';
import { makeTestAsset } from '../helpers/makeTestAsset.js';
import { join } from 'node:path';

describe('extraction arg builders', () => {
  it('audio filter targets -14 LUFS', () => {
    expect(buildAudioFilter()).toBe('loudnorm=I=-14:TP=-1.5:LRA=11');
  });
  it('landscape source center-crops to 9:16 then scales to 1080x1920', () => {
    const vf = buildVideoFilter(1920, 1080);
    expect(vf).toContain('crop=ih*9/16:ih');
    expect(vf).toContain('scale=1080:1920');
  });
  it('already-vertical source skips crop', () => {
    const vf = buildVideoFilter(1080, 1920);
    expect(vf).not.toContain('crop=');
    expect(vf).toContain('1080:1920');
  });
  it('extract args use input-seek -ss before -i and -t duration', () => {
    const args = buildExtractArgs('in.mp4', 12.5, 40, 'vf', 'af', 'out.mp4');
    const ss = args.indexOf('-ss'); const i = args.indexOf('-i');
    expect(ss).toBeLessThan(i);
    expect(args).toContain('-t');
  });
});

describe('extractRaw (integration)', () => {
  const asset = join('workspace', 'temp', 'test_6s.mp4');
  const out = join('workspace', 'temp', 'clip_raw.mp4');
  beforeAll(async () => { await makeTestAsset(asset); }, 60_000);
  it('produces a 1080x1920 clip', async () => {
    await extractRaw(asset, 1, 5, { width: 1280, height: 720 }, out);
    const p = await probe(out);
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
  }, 60_000);
});
```

- [ ] **Step 2: Run to verify it fails, then write the modules**

Run: `npx vitest run tests/extraction/clipExtractor.test.ts` → FAIL.

`src/extraction/audioProcessor.ts`:
```typescript
export function buildAudioFilter(): string {
  return 'loudnorm=I=-14:TP=-1.5:LRA=11';
}
```

`src/extraction/clipExtractor.ts`:
```typescript
import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { buildAudioFilter } from './audioProcessor.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function buildVideoFilter(width: number, height: number): string {
  const isVertical = width / height <= 9 / 16 + 0.01;
  if (isVertical) {
    // already portrait — fit into 1080x1920, pad if needed
    return 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1';
  }
  return 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1';
}

export function buildExtractArgs(video: string, start: number, dur: number, vf: string, af: string, outPath: string): string[] {
  return [
    '-y', '-ss', String(start), '-i', video, '-t', String(dur),
    '-vf', vf, '-af', af,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', outPath,
  ];
}

export async function extractRaw(
  video: string, start: number, end: number, dims: { width: number; height: number }, outPath: string,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const vf = buildVideoFilter(dims.width, dims.height);
  const args = buildExtractArgs(video, start, end - start, vf, buildAudioFilter(), outPath);
  await withRetry(() => run('ffmpeg', args), { attempts: 3, label: 'ffmpeg-extract' });
}
```

Run: `npx vitest run tests/extraction/clipExtractor.test.ts` → PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add src/extraction/audioProcessor.ts src/extraction/clipExtractor.ts tests/extraction/
git commit -m "feat: clip extractor — 9:16 crop, -14 LUFS, frame-accurate cut"
```

---

### Task 15: Remotion subproject (composition + caption logic)

**Files:**
- Create: `remotion/package.json`, `remotion/remotion.config.ts`, `remotion/tsconfig.json`
- Create: `remotion/src/Root.tsx`, `remotion/src/CaptionedClip.tsx`, `remotion/src/Caption.tsx`, `remotion/src/HookCard.tsx`, `remotion/src/captionLogic.ts`
- Test: `remotion/src/captionLogic.test.ts` (run with the root vitest via include path)

**Interfaces:**
- Produces (pure, testable): in `captionLogic.ts`
  - `groupIntoLines(words: CaptionWord[], maxPerLine: number): CaptionWord[][]`
  - `findActiveIndex(words: CaptionWord[], timeSec: number, leadMs: number): number`
- Composition `CaptionedClip` with `ClipCompositionProps` (Task 1 type), 1080×1920, fps + durationInFrames from props via `calculateMetadata`.

- [ ] **Step 1: Create `remotion/package.json`, `remotion/tsconfig.json`, `remotion/remotion.config.ts`**

`remotion/package.json`:
```json
{
  "name": "clipforge-remotion",
  "version": "0.1.0",
  "private": true,
  "scripts": { "studio": "remotion studio", "render": "remotion render" },
  "dependencies": {
    "@remotion/cli": "^4.0.0",
    "@remotion/google-fonts": "^4.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "remotion": "^4.0.0"
  },
  "devDependencies": { "@types/react": "^18.3.0", "typescript": "^5.6.0" }
}
```

`remotion/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "jsx": "react-jsx", "strict": true, "esModuleInterop": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```

`remotion/remotion.config.ts`:
```typescript
import { Config } from '@remotion/cli/config';
Config.setVideoImageFormat('jpeg');
Config.overrideWebpackConfig((c) => c);
```

- [ ] **Step 2: Write the failing test `remotion/src/captionLogic.test.ts`**

Add `remotion/src/**/*.test.ts` to the root `vitest.config.ts` include array first:
```typescript
include: ['tests/**/*.test.ts', 'remotion/src/**/*.test.ts'],
```

```typescript
import { describe, it, expect } from 'vitest';
import { groupIntoLines, findActiveIndex } from './captionLogic.js';

const words = [
  { text: 'a', start: 0, end: 0.5, emphasized: false },
  { text: 'b', start: 0.5, end: 1, emphasized: false },
  { text: 'c', start: 1, end: 1.5, emphasized: false },
  { text: 'd', start: 1.5, end: 2, emphasized: false },
  { text: 'e', start: 2, end: 2.5, emphasized: false },
];

describe('captionLogic', () => {
  it('groups into lines of <=4 words', () => {
    const lines = groupIntoLines(words, 4);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(4);
  });
  it('finds the active word with 50ms lead', () => {
    expect(findActiveIndex(words, 0.4, 50)).toBe(0);
    expect(findActiveIndex(words, 0.46, 50)).toBe(1); // 0.46+0.05=0.51 -> word b
    expect(findActiveIndex(words, 99, 50)).toBe(-1);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then write `remotion/src/captionLogic.ts`**

Run: `npx vitest run remotion/src/captionLogic.test.ts` → FAIL.

```typescript
export interface CaptionWord { text: string; start: number; end: number; emphasized: boolean; }

export function groupIntoLines(words: CaptionWord[], maxPerLine: number): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  for (let i = 0; i < words.length; i += maxPerLine) lines.push(words.slice(i, i + maxPerLine));
  return lines;
}

export function findActiveIndex(words: CaptionWord[], timeSec: number, leadMs: number): number {
  const t = timeSec + leadMs / 1000;
  return words.findIndex((w) => t >= w.start && t < w.end);
}
```

Run: `npx vitest run remotion/src/captionLogic.test.ts` → PASS (2 tests).

- [ ] **Step 4: Write `remotion/src/Caption.tsx`, `HookCard.tsx`, `CaptionedClip.tsx`, `Root.tsx`**

`remotion/src/Caption.tsx`:
```tsx
import { useCurrentFrame, useVideoConfig, interpolate, AbsoluteFill } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Anton';
import { groupIntoLines, findActiveIndex, type CaptionWord } from './captionLogic.js';

const { fontFamily } = loadFont();

export const CaptionTrack: React.FC<{ words: CaptionWord[]; accentColor: string }> = ({ words, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const active = findActiveIndex(words, t, 50);
  const lines = groupIntoLines(words, 4);

  // which line holds the active word (default to last visible)
  let activeLine = 0; let count = 0;
  for (let i = 0; i < lines.length; i++) { if (active >= count && active < count + lines[i].length) { activeLine = i; break; } count += lines[i].length; }

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '28%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '90%' }}>
        {lines[activeLine]?.map((w, i) => {
          const globalIdx = lines.slice(0, activeLine).reduce((a, l) => a + l.length, 0) + i;
          const isActive = globalIdx === active;
          const scale = isActive ? (w.emphasized ? 1.4 : 1.2) : 1;
          return (
            <span key={i} style={{
              fontFamily, fontSize: w.emphasized ? 84 : 70, color: isActive ? accentColor : 'white',
              transform: `scale(${scale})`, display: 'inline-block', margin: '0 10px',
              textTransform: 'uppercase', letterSpacing: '0.02em',
              textShadow: '0 0 8px rgba(0,0,0,0.9), 3px 3px 6px rgba(0,0,0,1)',
              opacity: interpolate(globalIdx, [active - 1, active], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}>{w.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```

`remotion/src/HookCard.tsx` (present, inert in Slice 1 — rendered only when `showHookCard`):
```tsx
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const HookCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 0.2 * fps, 1.2 * fps, 1.5 * fps], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: '12%', opacity }}>
      <div style={{ fontFamily: 'Anton, Impact, sans-serif', fontSize: 64, color: 'white', textTransform: 'uppercase',
        textAlign: 'center', maxWidth: '85%', textShadow: '0 0 10px rgba(0,0,0,1)' }}>{text}</div>
    </AbsoluteFill>
  );
};
```

`remotion/src/CaptionedClip.tsx`:
```tsx
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { CaptionTrack } from './Caption.js';
import { HookCard } from './HookCard.js';
import type { CaptionWord } from './captionLogic.js';

export interface ClipProps {
  videoPath: string; words: CaptionWord[]; fps: number; durationInFrames: number;
  style: 'minimal' | 'card' | 'bold'; accentColor: string; showHookCard: boolean; hookText: string;
}

export const CaptionedClip: React.FC<ClipProps> = ({ videoPath, words, accentColor, showHookCard, hookText }) => (
  <AbsoluteFill style={{ backgroundColor: 'black' }}>
    <OffthreadVideo src={staticFile(videoPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    {showHookCard && <HookCard text={hookText} />}
    <CaptionTrack words={words} accentColor={accentColor} />
  </AbsoluteFill>
);
```

`remotion/src/Root.tsx`:
```tsx
import { Composition } from 'remotion';
import { CaptionedClip, type ClipProps } from './CaptionedClip.js';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="CaptionedClip"
    component={CaptionedClip}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
    defaultProps={{
      videoPath: '', words: [], fps: 30, durationInFrames: 300,
      style: 'bold', accentColor: '#FFD700', showHookCard: false, hookText: '',
    } as ClipProps}
    calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames, fps: props.fps })}
  />
);
```

Add `remotion/src/index.ts`:
```typescript
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root.js';
registerRoot(RemotionRoot);
```

And `remotion/remotion.config.ts` already set; ensure entry point: add to `remotion.config.ts`:
```typescript
Config.setEntryPoint('./src/index.ts');
```

- [ ] **Step 5: Install remotion deps and verify the composition builds**

Run:
```bash
cd remotion && npm install && npx remotion compositions src/index.ts
```
Expected: lists `CaptionedClip` without error. (Return to repo root afterward: `cd ..`.)

- [ ] **Step 6: Commit**

```bash
git add remotion/package.json remotion/tsconfig.json remotion/remotion.config.ts remotion/src/ vitest.config.ts
git commit -m "feat: Remotion CaptionedClip composition + tested caption logic"
```

---

### Task 16: Remotion renderer bridge

**Files:**
- Create: `src/captions/remotionRenderer.ts`
- Test: `tests/captions/remotionRenderer.test.ts`

**Interfaces:**
- Consumes: `run`, `withRetry`, `probe`, `ClipCompositionProps`.
- Produces:
  - `buildRenderArgs(propsPath: string, outPath: string): string[]`
  - `render(opts: { rawClipPath: string; words: CaptionWord[]; outPath: string; fps: number; accentColor?: string; style?: string }): Promise<void>` — copies the raw clip into `remotion/public/input/<name>.mp4`, writes props JSON, runs `npx remotion render`, cleans up the public copy.

- [ ] **Step 1: Write failing test `tests/captions/remotionRenderer.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildRenderArgs } from '../../src/captions/remotionRenderer.js';

describe('buildRenderArgs', () => {
  it('renders CaptionedClip with h264/crf18/yuv420p and props file', () => {
    const args = buildRenderArgs('/tmp/props.json', '/out/clip_001_final.mp4');
    const j = args.join(' ');
    expect(j).toContain('CaptionedClip');
    expect(j).toContain('--codec=h264');
    expect(j).toContain('--crf=18');
    expect(j).toContain('--pixel-format=yuv420p');
    expect(j).toContain('--props=/tmp/props.json');
    expect(j).toContain('--output=/out/clip_001_final.mp4');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/captions/remotionRenderer.ts`**

Run: `npx vitest run tests/captions/remotionRenderer.test.ts` → FAIL.

```typescript
import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { CaptionWord, ClipCompositionProps } from '../types/index.js';
import { copyFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { probe } from '../utils/ffmpeg.js';

const REMOTION_DIR = resolve('remotion');

export function buildRenderArgs(propsPath: string, outPath: string): string[] {
  return ['remotion', 'render', 'src/index.ts', 'CaptionedClip',
    `--props=${propsPath}`, `--output=${outPath}`,
    '--codec=h264', '--crf=18', '--pixel-format=yuv420p'];
}

export async function render(opts: {
  rawClipPath: string; words: CaptionWord[]; outPath: string; fps: number;
  accentColor?: string; style?: 'minimal' | 'card' | 'bold';
}): Promise<void> {
  const p = await probe(opts.rawClipPath);
  const name = basename(opts.outPath, '.mp4') + '.mp4';
  const publicDir = join(REMOTION_DIR, 'public', 'input');
  await mkdir(publicDir, { recursive: true });
  const publicCopy = join(publicDir, name);
  await copyFile(opts.rawClipPath, publicCopy);

  const props: ClipCompositionProps = {
    videoPath: join('input', name),
    words: opts.words, fps: opts.fps,
    durationInFrames: Math.max(1, Math.round(p.duration * opts.fps)),
    style: opts.style ?? 'bold', accentColor: opts.accentColor ?? '#FFD700',
    showHookCard: false, hookText: '',
  };
  const propsPath = join(REMOTION_DIR, `props_${name}.json`);
  await writeFile(propsPath, JSON.stringify(props));

  try {
    await withRetry(() => run('npx', buildRenderArgs(propsPath, resolve(opts.outPath)), {
      onStdout: (l) => { if (l.includes('Rendered')) logger.info(l.trim()); },
    }).then(() => {
      // run from remotion dir
    }), { attempts: 2, label: 'remotion' });
  } finally {
    await rm(publicCopy, { force: true });
    await rm(propsPath, { force: true });
  }
}
```

Note: `run` must execute inside `remotion/`. Update the call to pass `cwd`. Extend `src/utils/cmd.ts` `run` signature to accept `opts.cwd` (add `cwd?: string` and pass to `spawn(cmd, args, { cwd: opts.cwd, ... })`), then call `run('npx', buildRenderArgs(...), { cwd: REMOTION_DIR })`. Add a test in `tests/utils/cmd.test.ts`:
```typescript
it('runs in a given cwd', async () => {
  const { stdout } = await run('node', ['-e', 'process.stdout.write(process.cwd())'], { cwd: 'remotion' });
  expect(stdout.endsWith('remotion')).toBe(true);
});
```

- [ ] **Step 3: Run unit test, then commit**

Run: `npx vitest run tests/captions/remotionRenderer.test.ts tests/utils/cmd.test.ts` → PASS.

```bash
git add src/captions/remotionRenderer.ts src/utils/cmd.ts tests/captions/remotionRenderer.test.ts tests/utils/cmd.test.ts
git commit -m "feat: remotion renderer bridge (public-dir copy + props + render args + cwd)"
```

---

### Task 17: Exporter (per-clip JSON + manifest)

**Files:**
- Create: `src/export/exporter.ts`
- Test: `tests/export/exporter.test.ts`

**Interfaces:**
- Consumes: `RankedClip`, `VideoMetadata`.
- Produces:
  - `buildClipJson(clip: RankedClip, jobId: string, files: { final: string; raw: string; srt: string }): object`
  - `buildManifest(jobId, source, meta, clips): object`
  - `writeExports(dir, jobId, source, meta, clips, files[]): Promise<void>`

- [ ] **Step 1: Write failing test `tests/export/exporter.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildClipJson, buildManifest } from '../../src/export/exporter.js';
import type { RankedClip, VideoMetadata } from '../../src/types/index.js';

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_001', start: 10, end: 70, duration: 60, composite_score: 8,
  semantic_score: 0, audio_score: 7, visual_score: 0, trigger_score: 9, pacing_score: 0, metadata_score: 0,
  hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 60, reason: 'r', transcript_excerpt: 'e',
};
const meta: VideoMetadata = {
  jobId: 'H14bBuluwB8', title: 'Goggins', duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264',
  chapters: [], description: '',
};

describe('exporter', () => {
  it('clip json includes files block and layer scores', () => {
    const j: any = buildClipJson(clip, 'H14bBuluwB8', { final: 'clip_001_final.mp4', raw: 'clip_001_raw.mp4', srt: 'clip_001.srt' });
    expect(j.clip_id).toBe('clip_001');
    expect(j.source_video).toBe('H14bBuluwB8');
    expect(j.files.final).toBe('clip_001_final.mp4');
    expect(j.layer_scores.trigger).toBe(9);
  });
  it('manifest aggregates clip count and scores', () => {
    const m: any = buildManifest('H14bBuluwB8', 'https://y/watch?v=H14bBuluwB8', meta, [clip]);
    expect(m.clips_generated).toBe(1);
    expect(m.top_score).toBe(8);
    expect(m.title).toBe('Goggins');
    expect(m.clips).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/export/exporter.ts`**

Run: `npx vitest run tests/export/exporter.test.ts` → FAIL.

```typescript
import type { RankedClip, VideoMetadata } from '../types/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function buildClipJson(clip: RankedClip, jobId: string, files: { final: string; raw: string; srt: string }) {
  return {
    clip_id: clip.clip_id, rank: clip.rank, source_video: jobId,
    start: clip.start, end: clip.end, duration: clip.duration,
    composite_score: clip.composite_score,
    layer_scores: {
      semantic: clip.semantic_score, audio: clip.audio_score, visual: clip.visual_score,
      trigger: clip.trigger_score, pacing: clip.pacing_score, metadata: clip.metadata_score,
    },
    hook_moment: clip.hook_moment, clip_titles: clip.clip_titles, is_standalone: clip.is_standalone,
    recommended_duration: clip.recommended_duration, reason: clip.reason,
    transcript_excerpt: clip.transcript_excerpt, files,
  };
}

export function buildManifest(jobId: string, source: string, meta: VideoMetadata, clips: RankedClip[]) {
  const scores = clips.map((c) => c.composite_score);
  return {
    job_id: jobId, source, title: meta.title, processed_at: new Date().toISOString(),
    total_duration: meta.duration, clips_generated: clips.length,
    top_score: scores.length ? Math.max(...scores) : 0,
    avg_score: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0,
    clips,
  };
}

export async function writeExports(
  dir: string, jobId: string, source: string, meta: VideoMetadata, clips: RankedClip[],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const clip of clips) {
    const files = { final: `${clip.clip_id}_final.mp4`, raw: `${clip.clip_id}_raw.mp4`, srt: `${clip.clip_id}.srt` };
    await writeFile(join(dir, `${clip.clip_id}.json`), JSON.stringify(buildClipJson(clip, jobId, files), null, 2));
  }
  await writeFile(join(dir, 'clips_manifest.json'), JSON.stringify(buildManifest(jobId, source, meta, clips), null, 2));
}
```

Run: `npx vitest run tests/export/exporter.test.ts` → PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add src/export/exporter.ts tests/export/exporter.test.ts
git commit -m "feat: exporter — per-clip JSON + clips_manifest.json"
```

---

### Task 18: CLI preflight

**Files:**
- Create: `src/cli/preflight.ts`
- Test: `tests/cli/preflight.test.ts`

**Interfaces:**
- Produces: `checkDependencies(execFn?: (cmd: string) => Promise<unknown>): Promise<{ ok: boolean; missing: { name: string; hint: string }[] }>` — injectable exec for testability; default uses `run`.

- [ ] **Step 1: Write failing test `tests/cli/preflight.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { checkDependencies } from '../../src/cli/preflight.js';

describe('checkDependencies', () => {
  it('reports all present when exec succeeds', async () => {
    const r = await checkDependencies(vi.fn().mockResolvedValue(undefined));
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
  });
  it('reports missing tools with install hints', async () => {
    const exec = vi.fn().mockImplementation((cmd: string) =>
      cmd.startsWith('yt-dlp') ? Promise.reject(new Error('nope')) : Promise.resolve());
    const r = await checkDependencies(exec);
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toEqual({ name: 'yt-dlp', hint: 'brew install yt-dlp' });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/cli/preflight.ts`**

Run: `npx vitest run tests/cli/preflight.test.ts` → FAIL.

```typescript
import { run } from '../utils/cmd.js';

const defaultExec = (cmd: string) => {
  const [bin, ...args] = cmd.split(' ');
  return run(bin, args);
};

export async function checkDependencies(execFn: (cmd: string) => Promise<unknown> = defaultExec) {
  const checks = [
    { cmd: 'yt-dlp --version', name: 'yt-dlp', hint: 'brew install yt-dlp' },
    { cmd: 'ffmpeg -version', name: 'ffmpeg', hint: 'brew install ffmpeg' },
    { cmd: 'ffprobe -version', name: 'ffprobe', hint: 'brew install ffmpeg' },
  ];
  const missing: { name: string; hint: string }[] = [];
  for (const c of checks) {
    try { await execFn(c.cmd); } catch { missing.push({ name: c.name, hint: c.hint }); }
  }
  return { ok: missing.length === 0, missing };
}
```

Run: `npx vitest run tests/cli/preflight.test.ts` → PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add src/cli/preflight.ts tests/cli/preflight.test.ts
git commit -m "feat: CLI dependency preflight (yt-dlp/ffmpeg/ffprobe, injectable)"
```

---

### Task 19: CLI commands + pipeline orchestration

**Files:**
- Create: `src/cli/commands/ingest.ts`, `src/cli/commands/all.ts`, `src/cli/index.ts`
- Test: `tests/cli/jobId.test.ts` (pure helper); full pipeline covered by Task 20 E2E.

**Interfaces:**
- Consumes: every module above.
- Produces:
  - `resolveJobId(url: string): string` (video id or uuid)
  - `runAll(url, opts): Promise<string>` — returns exports dir; orchestrates the full pipeline.
  - commander program with `all` and `ingest`, gated by preflight.

- [ ] **Step 1: Write failing test `tests/cli/jobId.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { resolveJobId } from '../../src/cli/commands/all.js';

describe('resolveJobId', () => {
  it('uses the YouTube video id when present', () => {
    expect(resolveJobId('https://www.youtube.com/watch?v=H14bBuluwB8')).toBe('H14bBuluwB8');
  });
  it('falls back to a uuid for non-YouTube input', () => {
    const id = resolveJobId('https://vimeo.com/123');
    expect(id).toMatch(/[0-9a-f-]{36}/);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/cli/commands/all.ts`**

Run: `npx vitest run tests/cli/jobId.test.ts` → FAIL.

```typescript
import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import ora from 'ora';
import Table from 'cli-table3';
import { parseVideoId, download } from '../../ingest/downloader.js';
import { extractMetadata } from '../../ingest/metadataExtractor.js';
import { getTranscript } from '../../transcript/transcriptManager.js';
import { detectTriggers } from '../../analysis/transcriptTriggers.js';
import { analyzeAudio } from '../../analysis/audioEnergy.js';
import { scoreWindows } from '../../clipDetection/windowScorer.js';
import { buildClips } from '../../clipDetection/merger.js';
import { rank, defaultMinScore } from '../../clipDetection/ranker.js';
import { buildCaptionWords } from '../../captions/captionWords.js';
import { writeSrt } from '../../captions/srtGenerator.js';
import { extractRaw } from '../../extraction/clipExtractor.js';
import { render } from '../../captions/remotionRenderer.js';
import { writeExports } from '../../export/exporter.js';
import { logger } from '../../utils/logger.js';
import type { TranscriptSegment } from '../../types/index.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export function resolveJobId(url: string): string {
  return parseVideoId(url) ?? uuidv4();
}

export interface AllOpts { top: number; minScore?: number; style: 'minimal' | 'card' | 'bold'; accent: string; }

export async function runAll(url: string, opts: AllOpts): Promise<string> {
  const jobId = resolveJobId(url);
  const dirs = {
    downloads: join(WS, 'downloads', jobId),
    transcripts: join(WS, 'transcripts', jobId),
    analysis: join(WS, 'analysis', jobId),
    clips: join(WS, 'clips', jobId),
    exports: join(WS, 'exports', jobId),
  };

  let sp = ora('Ingesting video…').start();
  const dl = await download(url, dirs.downloads);
  const meta = await extractMetadata(dl.videoPath, dl.infoJsonPath, jobId, join(dirs.transcripts, 'metadata.json'));
  sp.succeed(`Downloaded: "${meta.title}" (${Math.round(meta.duration)}s)`);

  sp = ora('Extracting transcript…').start();
  const segments: TranscriptSegment[] = await getTranscript({
    jobId, videoPath: dl.videoPath, subtitlePath: dl.subtitlePath, outPath: join(dirs.transcripts, 'transcript.json'),
  });
  sp.succeed(`Transcript ready — ${segments.reduce((a, s) => a + s.words.length, 0)} words`);

  sp = ora('Analyzing (triggers + audio energy)…').start();
  const triggers = detectTriggers(segments);
  const audio = await analyzeAudio(dl.videoPath);
  sp.succeed(`Analysis done — ${triggers.length} trigger hits`);

  sp = ora('Detecting clips…').start();
  const windows = scoreWindows(meta.duration, triggers, audio);
  const threshold = opts.minScore ?? defaultMinScore(windows);
  const candidates = buildClips(windows, segments, audio, threshold);
  const ranked = rank(candidates, segments, { top: opts.top, minScore: opts.minScore });
  sp.succeed(`Found ${candidates.length} candidates → ${ranked.length} ranked`);

  for (const clip of ranked) {
    const sp2 = ora(`[${clip.clip_id}] extract + caption…`).start();
    const rawPath = join(dirs.clips, `${clip.clip_id}_raw.mp4`);
    await extractRaw(dl.videoPath, clip.start, clip.end, { width: meta.width, height: meta.height }, rawPath);

    const clipWords = segments.flatMap((s) => s.words).filter((w) => w.end > clip.start && w.start < clip.end);
    const captionWords = buildCaptionWords(clipWords, clip.start, triggers.map((t) => t.phrase));
    await writeSrt(captionWords, join(dirs.exports, `${clip.clip_id}.srt`));
    await render({ rawClipPath: rawPath, words: captionWords, outPath: join(dirs.exports, `${clip.clip_id}_final.mp4`), fps: meta.fps, accentColor: opts.accent, style: opts.style });

    // copy raw into exports for completeness
    const { copyFile, mkdir } = await import('node:fs/promises');
    await mkdir(dirs.exports, { recursive: true });
    await copyFile(rawPath, join(dirs.exports, `${clip.clip_id}_raw.mp4`));
    sp2.succeed(`[${clip.clip_id}] done`);
  }

  await writeExports(dirs.exports, jobId, url, meta, ranked);

  const table = new Table({ head: ['Rank', 'Score', 'Dur', 'Excerpt'] });
  ranked.forEach((c) => table.push([c.rank, c.composite_score, `${Math.round(c.duration)}s`, c.transcript_excerpt.slice(0, 40)]));
  logger.info('\n' + table.toString());
  logger.info(`Export complete → ${dirs.exports}`);
  return dirs.exports;
}
```

- [ ] **Step 3: Write `src/cli/commands/ingest.ts`**

```typescript
import { join } from 'node:path';
import ora from 'ora';
import { download } from '../../ingest/downloader.js';
import { extractMetadata } from '../../ingest/metadataExtractor.js';
import { getTranscript } from '../../transcript/transcriptManager.js';
import { resolveJobId } from './all.js';
import { logger } from '../../utils/logger.js';

const WS = process.env.WORKSPACE_DIR ?? './workspace';

export async function runIngest(url: string): Promise<void> {
  const jobId = resolveJobId(url);
  const sp = ora('Ingesting…').start();
  const dl = await download(url, join(WS, 'downloads', jobId));
  const meta = await extractMetadata(dl.videoPath, dl.infoJsonPath, jobId, join(WS, 'transcripts', jobId, 'metadata.json'));
  const segments = await getTranscript({ jobId, videoPath: dl.videoPath, subtitlePath: dl.subtitlePath, outPath: join(WS, 'transcripts', jobId, 'transcript.json') });
  sp.succeed(`Ingested "${meta.title}" — ${segments.length} segments. jobId=${jobId}`);
  logger.info(`Artifacts in ${join(WS, 'downloads', jobId)} and ${join(WS, 'transcripts', jobId)}`);
}
```

- [ ] **Step 4: Write `src/cli/index.ts`**

```typescript
#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { checkDependencies } from './preflight.js';
import { runAll } from './commands/all.js';
import { runIngest } from './commands/ingest.js';
import { logger } from '../utils/logger.js';

async function preflightOrExit() {
  const { ok, missing } = await checkDependencies();
  if (!ok) {
    logger.error('Missing required tools:\n' + missing.map((m) => `  ${chalk.red('✗')} ${m.name} — install: ${chalk.cyan(m.hint)}`).join('\n'));
    process.exit(1);
  }
}

const program = new Command();
program.name('clipforge').description('Local-first viral short-form clip engine').version('0.1.0');

program.command('all').argument('<url>', 'YouTube URL')
  .option('--top <n>', 'max clips to export', (v) => parseInt(v, 10), 3)
  .option('--min-score <x>', 'absolute composite floor', (v) => parseFloat(v))
  .option('--style <s>', 'caption style', 'bold')
  .option('--accent <hex>', 'accent color', '#FFD700')
  .action(async (url, o) => {
    await preflightOrExit();
    try { await runAll(url, { top: o.top, minScore: o.minScore, style: o.style, accent: o.accent }); }
    catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.command('ingest').argument('<url>', 'YouTube URL')
  .action(async (url) => {
    await preflightOrExit();
    try { await runIngest(url); }
    catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });

program.parseAsync();
```

- [ ] **Step 5: Run unit test + typecheck + build**

Run:
```bash
npx vitest run tests/cli/jobId.test.ts
npm run build
```
Expected: test PASS; `tsc` completes with no errors and emits `dist/cli/index.js`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/ tests/cli/jobId.test.ts
git commit -m "feat: CLI commands (all, ingest) + full pipeline orchestration"
```

---

### Task 20: End-to-end validation on the Goggins URL

**Files:**
- Create: `tests/e2e/pipeline.e2e.test.ts` (gated behind `RUN_E2E=1`; needs network + Remotion)
- Create: `README.md`

**Interfaces:**
- Consumes: `runAll`. No new production code — this task wires verification and docs.

- [ ] **Step 1: Write the gated E2E test `tests/e2e/pipeline.e2e.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { runAll } from '../../src/cli/commands/all.js';
import { probe } from '../../src/utils/ffmpeg.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const RUN = process.env.RUN_E2E === '1';
const URL = 'https://www.youtube.com/watch?v=H14bBuluwB8';

describe.skipIf(!RUN)('E2E: Goggins URL → finished clip', () => {
  it('produces a 1080x1920 captioned clip + manifest', async () => {
    const dir = await runAll(URL, { top: 3, style: 'bold', accent: '#FFD700' });
    const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
    expect(manifest.clips_generated).toBeGreaterThanOrEqual(1);

    const c1 = manifest.clips[0];
    expect(c1.duration).toBeGreaterThanOrEqual(30);
    expect(c1.duration).toBeLessThanOrEqual(90);

    const finalPath = join(dir, `${c1.clip_id}_final.mp4`);
    expect(existsSync(finalPath)).toBe(true);
    const p = await probe(finalPath);
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
  }, 600_000);
});
```

- [ ] **Step 2: Run the full automated suite (offline-safe)**

Run: `npm test`
Expected: all unit + ffmpeg-integration tests PASS; the E2E test is **skipped** (no `RUN_E2E`).

- [ ] **Step 3: Run the real end-to-end pipeline**

Run:
```bash
brew install yt-dlp        # satisfies preflight
npm run build
node dist/cli/index.js all "https://www.youtube.com/watch?v=H14bBuluwB8" --top 3
```
Expected (maps to spec §12):
- Preflight passes; download yields `workspace/downloads/H14bBuluwB8/video.mp4` + `.info.json` + `.json3`.
- `workspace/transcripts/H14bBuluwB8/transcript.json` has word-level timings.
- `workspace/exports/H14bBuluwB8/clips_manifest.json` lists ≥1 clip; each 30–90s.
- `clip_001_final.mp4` is 1080×1920 (verify: `ffprobe -v quiet -show_streams clip_001_final.mp4 | grep -E 'width|height'`), plays with karaoke captions opening on speech within 1s.

- [ ] **Step 4: Optionally run the gated E2E test**

Run: `RUN_E2E=1 npx vitest run tests/e2e/pipeline.e2e.test.ts`
Expected: PASS within the 10-min timeout.

- [ ] **Step 5: Write `README.md`**

Cover: what ClipForge is (1 paragraph) · requirements (macOS, Node 24, ffmpeg, yt-dlp; whisper-cpp optional) · install (`npm install`, `cd remotion && npm install`, `brew install yt-dlp`) · quick start (`node dist/cli/index.js all "<url>"`) · the Slice-1 command surface (`all`, `ingest`) · output files (§9) · `.env` config · FAQ ("Why no Python in Slice 1?", "Where do later features live?" → reference the slice roadmap) · the ASCII pipeline diagram from the spec · MIT license.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/pipeline.e2e.test.ts README.md
git commit -m "test: gated E2E on Goggins URL + README"
```

---

## Self-Review

**1. Spec coverage** (spec §-by-§ → task):
- §2 input (YouTube URL) → T7. §4.1 yt-dlp args → T7. §4.3 metadata → T8.
- §5 transcript waterfall (json3 → whisper.cpp) → T5, T6. Word-level timing → T5/T6.
- §6.2 audio energy (RMS + silence subset) → T4 (laughter/music explicitly Slice 3).
- §6.4 trigger tiers + structural → T9.
- §7.1 sliding window + composite → T10. §7.2 boundary expansion/snap/cold-open/90s cap → T11. §7.3 merge/dedup + §7.4 ranking/RankedClip → T11/T12.
- §8.1 cold open → T11 (`coldOpenTrim`). §8.3 karaoke (≤4 words, active scale, accent, emphasis) → T13/T15. §8.5 loudnorm −14 LUFS + silence trim → T14/T11.
- §9 Remotion composition → T15; render command → T16.
- §10 hook prompt → deferred (Slice 2); HookCard present inert → T15.
- §11 CLI (`all`, `ingest`) + preflight → T18, T19. Progress/table → T19.
- §16 output files (final/raw/srt/json/manifest) → T17/T19.
- Global preflight requirement (user) → T18. astats dual-key (user) → T4.
- **Gaps (intentional, documented in spec §4 deferred):** Gemini, hook generation, librosa/OpenCV/pacing/metadata layers, MediaPipe, diarization, job/resume, batch, profanity, smart-cut, bonus. No accidental gaps found.

**2. Placeholder scan:** No "TBD"/"implement later"/"add error handling" placeholders. README content in T20 is specified by required sections (acceptable — it's prose, not code). Every code step shows complete code.

**3. Type consistency:** `TranscriptSegment`, `TranscriptWord`, `TriggerHit`, `AudioEnergyLayer`/`RmsPoint`/`SilenceRegion`, `WindowScore`, `ClipCandidate`, `RankedClip`, `CaptionWord`, `ClipCompositionProps` defined in T1 and used unchanged downstream. Function names consistent: `scoreWindows`/`buildClips`/`rank`/`buildCaptionWords`/`writeSrt`/`extractRaw`/`render`/`writeExports`/`checkDependencies`/`runAll`/`resolveJobId`. `run` gains an optional `cwd` in T16 (additive, back-compatible with T2 callers). Remotion's `captionLogic.ts` redefines a local `CaptionWord` (separate tsconfig/bundler boundary) structurally identical to the shared type — intentional, since the remotion package does not import from `src/`.

Fixed inline during review: none required.
