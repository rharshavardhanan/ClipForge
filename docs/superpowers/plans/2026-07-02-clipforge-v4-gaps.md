# ClipForge v4 Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining v4 master-spec gaps: adaptive clip length (15–60s), per-clip SEO output files, ranking text outputs, thumbnail.png per clip, and an SFX sound-design layer mapped to zooms/hooks.

**Architecture:** All five features are additive layers on the existing pipeline (`analyzeVideo → rankAndExport`). SEO + thumbnails are pure functions over data the ranker already produces (`clip_titles`, `hook_moment`, `sentiment`, RMS curve) — no new LLM calls. SFX mirrors the music engine's folder-library + ffmpeg-post-mix pattern, timed off the same emphasized-word events the Remotion punch-zoom uses. Adaptive length is a dual-threshold change in the merger: floor-level heat expands to 30s (soft cap), peak-level heat may extend to 60s (hard cap).

**Tech Stack:** TypeScript (ESM, Node 20), vitest, ffmpeg (frame grab, drawtext, adelay/amix), commander.

## Global Constraints

- No new LLM calls: SEO/thumbnail text derive from existing `RankedClip` + `VideoMetadata` fields (semantic layer already produced them).
- No new runtime dependencies.
- Missing assets degrade silently: no `./sfx` library → no SFX; no usable font → plain thumbnail frame (log once, never fail a clip).
- Per-clip failures must not kill the batch (keep the existing try/catch-per-clip contract in `rankAndExport`).
- Determinism: same inputs → identical exports (seeded picks, pure builders).
- Output filenames are `<clip_id>_`-prefixed because all clips share one exports dir: `clip_001_title.txt`, `clip_001_thumbnail.png`, etc.
- Gates: `npx vitest run` green; `npx tsc --noEmit` clean in repo root and `remotion/`.

---

### Task 1: Adaptive clip length (15–60s, dual-threshold expansion)

**Files:**
- Modify: `src/clipDetection/merger.ts`
- Modify: `src/clipDetection/ranker.ts:73`
- Test: `tests/clipDetection/merger.test.ts`

**Interfaces:**
- Produces: `SOFT_CAP_SEC = 30`, `MAX_CLIP_SEC = 60`, `MIN_CLIP_SEC = 15` (exported consts); `buildClips` signature unchanged.

- [ ] **Step 1: Update/add failing tests**

In `tests/clipDetection/merger.test.ts`, replace the `clampDuration hard-caps at 30s` test and add extension tests:

```ts
it('clampDuration hard-caps at 60s (extended ceiling)', () => {
  expect(clampDuration(0, 200)).toEqual({ start: 0, end: 60 });
});

it('expansion past 30s requires peak-level neighbors (soft cap)', () => {
  // floor-level heat only → capped at soft 30s
  const floorWindows = [
    { start: 0, end: 15, triggerScore: 0, audioScore: 6, composite: 6 },
    { start: 15, end: 30, triggerScore: 0, audioScore: 9, composite: 9 }, // peak
    { start: 30, end: 45, triggerScore: 0, audioScore: 6, composite: 6 },
  ];
  const segs = [{ id: 0, start: 0, end: 45, text: 'a b c', words: [] }];
  const clips = buildClips(floorWindows, [], { rms_curve: [], silence_regions: [] }, 8);
  for (const c of clips) expect(c.end - c.start).toBeLessThanOrEqual(30);
});

it('sustained peak-level heat extends to 60s max', () => {
  const hotWindows = Array.from({ length: 5 }, (_, k) => (
    { start: k * 15, end: (k + 1) * 15, triggerScore: 9, audioScore: 9, composite: 9 }
  ));
  const clips = buildClips(hotWindows, [], { rms_curve: [], silence_regions: [] }, 8);
  expect(clips.length).toBeGreaterThan(0);
  expect(clips[0].end - clips[0].start).toBeGreaterThan(30);
  for (const c of clips) expect(c.end - c.start).toBeLessThanOrEqual(60);
});
```

Also update the two existing assertions `toBeLessThanOrEqual(30)` in the low-heat tests only if they now legitimately extend — they use composite 1/8-9 mixes; re-run to see. Low-heat windows stay ≤30 by design.

- [ ] **Step 2: Run tests, verify new ones fail**

Run: `npx vitest run tests/clipDetection/merger.test.ts`
Expected: FAIL — `clampDuration(0,200)` returns `end: 30`; extension test gets ≤30.

- [ ] **Step 3: Implement dual-threshold expansion**

In `src/clipDetection/merger.ts` replace the cap consts + expansion + clamp:

```ts
// Adaptive length (v4): most clips stay punchy under the 30s soft cap; a clip may extend
// toward 60s ONLY while its neighboring windows hold peak-level (>= threshold) heat —
// "if the clip needs more context, expand; never cut payoff."
export const MIN_CLIP_SEC = 15;
export const SOFT_CAP_SEC = 30;
export const MAX_CLIP_SEC = 60;

function spanAllowed(span: number, composite: number, threshold: number): boolean {
  if (span <= SOFT_CAP_SEC) return true;
  return composite >= threshold && span <= MAX_CLIP_SEC;
}

export function clampDuration(start: number, end: number): { start: number; end: number } {
  let e = end;
  if (e - start > MAX_CLIP_SEC) e = start + MAX_CLIP_SEC;  // hard cap
  if (e - start < MIN_CLIP_SEC) e = start + MIN_CLIP_SEC;  // pull up very short clips
  return { start, end: e };
}
```

And in `buildClips`, the two while-loops become:

```ts
let i = pi;
while (i - 1 >= 0 && sorted[i - 1].composite >= floor
  && spanAllowed(end - sorted[i - 1].start, sorted[i - 1].composite, threshold)) {
  i--;
  start = sorted[i].start;
}
let j = pi;
while (j + 1 < sorted.length && sorted[j + 1].composite >= floor
  && spanAllowed(sorted[j + 1].end - start, sorted[j + 1].composite, threshold)) {
  j++;
  end = sorted[j].end;
}
```

In `src/clipDetection/ranker.ts:73` change `Math.min(30, sw.recommended_duration)` → `Math.min(60, sw.recommended_duration)`.

- [ ] **Step 4: Run full suite**

Run: `npx vitest run`
Expected: PASS (fix any test that hard-coded the 30 cap where windows are genuinely peak-hot).

- [ ] **Step 5: Commit**

```bash
git add src/clipDetection/merger.ts src/clipDetection/ranker.ts tests/clipDetection/merger.test.ts
git commit -m "feat: adaptive clip length — 30s soft cap, 60s max on sustained peak heat"
```

---

### Task 2: SEO metadata engine (title/description/hashtags/hook per clip)

**Files:**
- Create: `src/export/seo.ts`
- Modify: `src/export/exporter.ts`
- Test: `tests/export/seo.test.ts`, `tests/export/exporter.test.ts`

**Interfaces:**
- Consumes: `RankedClip`, `VideoMetadata` from `src/types/index.js`.
- Produces:
  ```ts
  export interface SeoPack { title: string; description: string; hashtags: string[]; hookText: string; thumbnailText: string; }
  export function buildSeoPack(clip: RankedClip, meta: VideoMetadata): SeoPack;
  export function writeSeoFiles(dir: string, clipId: string, pack: SeoPack): Promise<void>;
  ```
  `writeExports` gains optional `packs?: Map<string, SeoPack>` (keyed by clip_id; absent → build from the meta arg). `buildClipJson` gains a `seo` field + files entries.

- [ ] **Step 1: Write failing tests** (`tests/export/seo.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { buildSeoPack } from '../../src/export/seo.js';
import type { RankedClip, VideoMetadata } from '../../src/types/index.js';

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_001', start: 10, end: 40, duration: 30,
  composite_score: 9, semantic_score: 8, audio_score: 7, visual_score: 0,
  trigger_score: 6, pacing_score: 0, metadata_score: 0,
  hook_moment: 'he actually jumped off the roof into the pool',
  clip_titles: ['He Actually Did It'], is_standalone: true,
  recommended_duration: 30, reason: 'big payoff', transcript_excerpt: 'watch this he actually jumped',
  sentiment: 'intense',
};
const meta: VideoMetadata = {
  jobId: 'j1', title: 'CRAZY 24 Hour Challenge', duration: 1200, width: 1920, height: 1080,
  fps: 30, codec: 'h264', chapters: [], description: '',
  channelName: 'IShowSpeed', tags: ['speed', 'challenge', 'funny moments'],
};

describe('buildSeoPack', () => {
  it('title = clip title + creator/shorts tags', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.title).toContain('He Actually Did It');
    expect(p.title).toContain('#ishowspeed');
    expect(p.title).toContain('#shorts');
  });
  it('hashtags are lowercase, deduped, #-prefixed, capped at 15', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.hashtags.length).toBeLessThanOrEqual(15);
    expect(new Set(p.hashtags).size).toBe(p.hashtags.length);
    for (const h of p.hashtags) expect(h).toMatch(/^#[a-z0-9]+$/);
    expect(p.hashtags).toContain('#ishowspeed');   // creator
    expect(p.hashtags).toContain('#shorts');       // viral
    expect(p.hashtags).toContain('#challenge');    // niche (from meta.tags)
  });
  it('description credits the source video and embeds hashtags', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.description).toContain('CRAZY 24 Hour Challenge');
    expect(p.description).toContain('#shorts');
  });
  it('hookText is uppercase, <= 8 words', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.hookText).toBe(p.hookText.toUpperCase());
    expect(p.hookText.split(/\s+/).length).toBeLessThanOrEqual(8);
  });
  it('thumbnailText is uppercase, <= 4 words, no trailing punctuation', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.thumbnailText).toBe(p.thumbnailText.toUpperCase());
    expect(p.thumbnailText.split(/\s+/).length).toBeLessThanOrEqual(4);
  });
  it('falls back gracefully with no semantic titles / channel', () => {
    const bare = { ...clip, clip_titles: [], hook_moment: '' };
    const bareMeta = { ...meta, channelName: undefined, tags: undefined };
    const p = buildSeoPack(bare, bareMeta);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.hookText.length).toBeGreaterThan(0);
    expect(p.hashtags).toContain('#shorts');
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/export/seo.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/export/seo.ts`**

```ts
/**
 * SEO pack per clip — click title, SEO description, hashtag set, hook text, thumbnail text.
 * Pure derivation from the ranked clip + source metadata (the semantic layer already produced
 * clip_titles / hook_moment); no LLM calls, fully deterministic.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RankedClip, VideoMetadata } from '../types/index.js';

export interface SeoPack {
  title: string; description: string; hashtags: string[];
  hookText: string; thumbnailText: string;
}

/** '#kaicenat' from 'Kai Cenat' — lowercase alphanumerics only; null when nothing survives. */
export function slugTag(s: string): string | null {
  const slug = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug ? `#${slug}` : null;
}

const VIRAL_TAGS = ['#shorts', '#viral', '#fyp', '#trending', '#clips'];

function sentimentTags(sentiment?: string): string[] {
  switch (sentiment) {
    case 'funny': return ['#funny', '#comedy', '#lol'];
    case 'intense': return ['#insane', '#crazy', '#epic'];
    case 'serious': return ['#motivation', '#mindset'];
    default: return [];
  }
}

function firstWords(s: string, n: number): string {
  return s.trim().split(/\s+/).filter(Boolean).slice(0, n).join(' ');
}

function baseTitle(clip: RankedClip): string {
  if (clip.clip_titles[0]) return clip.clip_titles[0];
  if (clip.hook_moment) return firstWords(clip.hook_moment, 8);
  return firstWords(clip.transcript_excerpt, 6) + '…';
}

export function buildSeoPack(clip: RankedClip, meta: VideoMetadata): SeoPack {
  const creatorTag = meta.channelName ? slugTag(meta.channelName) : null;
  const nicheTags = (meta.tags ?? []).map(slugTag).filter((t): t is string => t !== null).slice(0, 5);

  const hashtags = [...new Set([
    ...(creatorTag ? [creatorTag] : []),
    ...VIRAL_TAGS,
    ...sentimentTags(clip.sentiment),
    ...nicheTags,
  ])].slice(0, 15);

  const title = [baseTitle(clip), creatorTag, '#shorts'].filter(Boolean).join(' ');

  const hookSrc = clip.hook_moment || clip.transcript_excerpt || 'wait for it';
  const hookWords = hookSrc.trim().split(/\s+/).filter(Boolean);
  const hookText = (hookWords.length <= 8 ? hookWords.join(' ') : hookWords.slice(0, 7).join(' ') + '…').toUpperCase();

  const thumbnailText = firstWords(baseTitle(clip), 4).replace(/[^\w\s]/g, '').trim().toUpperCase() || 'WAIT FOR IT';

  const credit = `From: ${meta.title}${clip.source_url ? ` — ${clip.source_url}` : ''}`;
  const description = [
    `${hookSrc.trim()} 🔥`, '', credit,
    clip.reason && !clip.reason.startsWith('trigger=') ? `Why it slaps: ${clip.reason}` : '',
    '', hashtags.join(' '),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  return { title, description, hashtags, hookText, thumbnailText };
}

/** Write the four per-clip SEO text files next to the clip. */
export async function writeSeoFiles(dir: string, clipId: string, pack: SeoPack): Promise<void> {
  await Promise.all([
    writeFile(join(dir, `${clipId}_title.txt`), pack.title + '\n'),
    writeFile(join(dir, `${clipId}_description.txt`), pack.description + '\n'),
    writeFile(join(dir, `${clipId}_hashtags.txt`), pack.hashtags.join('\n') + '\n'),
    writeFile(join(dir, `${clipId}_hook.txt`), pack.hookText + '\n'),
  ]);
}
```

- [ ] **Step 4: Run seo tests** — `npx vitest run tests/export/seo.test.ts` → PASS.

- [ ] **Step 5: Wire into exporter (test first)**

Add to `tests/export/exporter.test.ts`: writeExports to a tmp dir with one clip → assert `clip_001_title.txt`, `clip_001_description.txt`, `clip_001_hashtags.txt`, `clip_001_hook.txt` exist and `clip_001.json` has a `seo.title`. Then in `src/export/exporter.ts`:

```ts
import { buildSeoPack, writeSeoFiles, type SeoPack } from './seo.js';

export function buildClipJson(clip: RankedClip, jobId: string,
  files: { final: string; raw: string; srt: string; thumbnail?: string }, seo?: SeoPack) {
  return { /* existing fields */, seo, files };
}

export async function writeExports(
  dir: string, jobId: string, source: string, meta: VideoMetadata, clips: RankedClip[],
  packs?: Map<string, SeoPack>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const clip of clips) {
    const pack = packs?.get(clip.clip_id) ?? buildSeoPack(clip, meta);
    await writeSeoFiles(dir, clip.clip_id, pack);
    const files = { final: `${clip.clip_id}_final.mp4`, raw: `${clip.clip_id}_raw.mp4`, srt: `${clip.clip_id}.srt` };
    await writeFile(join(dir, `${clip.clip_id}.json`), JSON.stringify(buildClipJson(clip, jobId, files, pack), null, 2));
  }
  // manifest write unchanged
}
```

In `src/cli/commands/all.ts` `rankAndExport`, build each pack with the clip's OWN source meta (correct creator tags in batch runs) and pass the map:

```ts
const packs = new Map<string, SeoPack>();
// inside the per-clip try block, near the top:
const pack = buildSeoPack(clip, source.meta);
packs.set(clip.clip_id, pack);
// …
await writeExports(exportsDir, id, primary.url, primary.meta, ranked, packs);
```

- [ ] **Step 6: Full suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add src/export/seo.ts src/export/exporter.ts src/cli/commands/all.ts tests/export/
git commit -m "feat: SEO engine — per-clip title/description/hashtags/hook files + seo block in clip.json"
```

---

### Task 3: Ranking text outputs (ranking_titles.txt, ranking_description.txt)

**Files:**
- Modify: `src/cli/commands/rank.ts`
- Test: `tests/cli/rank.test.ts` (extend existing)

**Interfaces:**
- Consumes: the manifest shape `{ title: string, clips: [{ rank, clip_id, clip_titles, transcript_excerpt? }] }` already read by `runRankingRender`.
- Produces: `buildRankingTexts(manifest): { titles: string; description: string }`.

- [ ] **Step 1: Failing test** (extend `tests/cli/rank.test.ts`)

```ts
import { buildRankingTexts } from '../../src/cli/commands/rank.js';

it('buildRankingTexts: countdown titles + SEO description', () => {
  const manifest = {
    title: 'Speed Marathon', clips: [
      { clip_id: 'clip_001', rank: 1, clip_titles: ['The Backflip'], transcript_excerpt: 'x' },
      { clip_id: 'clip_002', rank: 2, clip_titles: [], transcript_excerpt: 'he screamed so loud' },
    ],
  };
  const t = buildRankingTexts(manifest as any);
  expect(t.titles).toContain('Top 2');
  expect(t.titles).toContain('#1: The Backflip');
  expect(t.titles).toContain('#2: he screamed so loud');
  expect(t.description).toContain('#shorts');
  expect(t.description).toContain('Speed Marathon');
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/cli/rank.test.ts` → FAIL.

- [ ] **Step 3: Implement in `src/cli/commands/rank.ts`**

```ts
interface ManifestClip { clip_id: string; rank: number; clip_titles: string[]; transcript_excerpt?: string; }

/** PURE: countdown title options + per-rank lines + SEO description for the ranking video. */
export function buildRankingTexts(manifest: { title: string; clips: ManifestClip[] }): { titles: string; description: string } {
  const n = manifest.clips.length;
  const line = (c: ManifestClip) =>
    `#${c.rank}: ${c.clip_titles[0] ?? (c.transcript_excerpt ?? '').split(/\s+/).slice(0, 6).join(' ')}`;
  const lines = [...manifest.clips].sort((a, b) => a.rank - b.rank).map(line);
  const titles = [
    `Top ${n} Wildest Moments 🔥 #shorts`,
    `Ranking the ${n} Craziest Moments`,
    `#1 Will Shock You — Top ${n} Moments`,
    '', ...lines,
  ].join('\n');
  const description = [
    `The definitive top ${n} countdown. Which one is YOUR #1?`, '',
    ...lines, '', `From: ${manifest.title}`, '',
    ['#shorts', '#viral', '#ranking', `#top${n}`, '#fyp', '#trending'].join(' '),
  ].join('\n');
  return { titles, description };
}
```

In `runRankingRender`, after the render succeeds:

```ts
const texts = buildRankingTexts(manifest);
await writeFile(join(dir, 'ranking_titles.txt'), texts.titles + '\n');
await writeFile(join(dir, 'ranking_description.txt'), texts.description + '\n');
```

(add `writeFile` to the fs import).

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/cli` → PASS.

```bash
git add src/cli/commands/rank.ts tests/cli/rank.test.ts
git commit -m "feat: ranking_titles.txt + ranking_description.txt alongside ranking_final.mp4"
```

---

### Task 4: Thumbnail engine (best frame + MrBeast-style text → thumbnail.png)

**Files:**
- Create: `src/export/thumbnail.ts`
- Modify: `src/cli/commands/all.ts` (per-clip wiring)
- Test: `tests/export/thumbnail.test.ts`

**Interfaces:**
- Consumes: `RmsPoint[]` (`source.audio.rms_curve`), the full-frame extract path, `SeoPack.thumbnailText` from Task 2.
- Produces:
  ```ts
  export function pickThumbnailTime(clip: { start: number; end: number }, rms: RmsPoint[]): number; // absolute source secs
  export function escapeDrawtext(s: string): string;
  export function buildThumbnailArgs(videoPath: string, timeSec: number, outPath: string, text?: string, fontFile?: string): string[];
  export function findThumbnailFont(): Promise<string | null>;
  export function generateThumbnail(videoPath: string, timeSec: number, text: string, outPath: string): Promise<void>;
  ```

- [ ] **Step 1: Failing tests** (`tests/export/thumbnail.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { pickThumbnailTime, buildThumbnailArgs, escapeDrawtext } from '../../src/export/thumbnail.js';

describe('pickThumbnailTime', () => {
  it('picks the loudest RMS point inside the clip (0.5s margins)', () => {
    const rms = [
      { time: 10.2, rms: 3 }, { time: 15, rms: 9 }, { time: 29.8, rms: 8 }, { time: 40, rms: 10 },
    ];
    expect(pickThumbnailTime({ start: 10, end: 30 }, rms)).toBe(15);
  });
  it('falls back to the clip midpoint with no usable RMS', () => {
    expect(pickThumbnailTime({ start: 10, end: 30 }, [])).toBe(20);
  });
});

describe('buildThumbnailArgs', () => {
  it('grabs one frame at t with contrast pop', () => {
    const args = buildThumbnailArgs('in.mp4', 5, 'out.png');
    expect(args).toContain('-ss');
    expect(args).toContain('5');
    expect(args.join(' ')).toContain('-frames:v 1');
    expect(args.join(' ')).toContain('eq=contrast');
    expect(args.join(' ')).not.toContain('drawtext'); // no font → plain frame
  });
  it('adds bold bordered drawtext when font+text given', () => {
    const s = buildThumbnailArgs('in.mp4', 5, 'out.png', 'HE DID IT', '/f/Impact.ttf').join(' ');
    expect(s).toContain('drawtext');
    expect(s).toContain('bordercolor=black');
  });
});

it('escapeDrawtext escapes ffmpeg specials', () => {
  expect(escapeDrawtext("IT'S 100%: WOW")).toBe("IT\\'S 100\\%\\: WOW");
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/export/thumbnail.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/export/thumbnail.ts`**

```ts
/**
 * Thumbnail engine: grab the clip's loudest frame (shock face / action peak correlates with
 * audio energy), pop contrast/saturation, and stamp large bordered MrBeast-style text.
 * No usable system font → plain frame (never fails the clip).
 */
import { stat } from 'node:fs/promises';
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import type { RmsPoint } from '../types/index.js';

/** PURE: loudest RMS time within [start+0.5, end-0.5]; midpoint fallback. Absolute source secs. */
export function pickThumbnailTime(clip: { start: number; end: number }, rms: RmsPoint[]): number {
  const usable = rms.filter((p) => p.time >= clip.start + 0.5 && p.time <= clip.end - 0.5);
  if (!usable.length) return (clip.start + clip.end) / 2;
  return usable.reduce((best, p) => (p.rms > best.rms ? p : best)).time;
}

/** PURE: escape \\ ' : % for an ffmpeg drawtext value. */
export function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

/** PURE: ffmpeg args — seek, grab 1 frame, contrast/saturation pop, optional drawtext. */
export function buildThumbnailArgs(
  videoPath: string, timeSec: number, outPath: string, text?: string, fontFile?: string,
): string[] {
  const filters = ['scale=1280:-2', 'eq=contrast=1.12:saturation=1.35'];
  if (text && fontFile) {
    filters.push(
      `drawtext=fontfile=${fontFile}:text='${escapeDrawtext(text)}':fontcolor=white:fontsize=110` +
      `:borderw=10:bordercolor=black:x=(w-text_w)/2:y=h*0.07`,
    );
  }
  return ['-ss', String(timeSec), '-i', videoPath, '-frames:v', '1', '-vf', filters.join(','), '-y', outPath];
}

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Impact.ttf',
  '/System/Library/Fonts/Supplemental/Arial Black.ttf',
  '/Library/Fonts/Impact.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  'C:\\Windows\\Fonts\\impact.ttf',
];

let cachedFont: string | null | undefined;
export async function findThumbnailFont(): Promise<string | null> {
  if (cachedFont !== undefined) return cachedFont;
  for (const f of FONT_CANDIDATES) {
    try { await stat(f); cachedFont = f; return f; } catch { /* next */ }
  }
  cachedFont = null;
  logger.warn('thumbnail: no bold system font found — rendering plain frames (no text overlay)');
  return null;
}

/** Grab + stamp the thumbnail. timeSec is relative to videoPath (the clip extract). */
export async function generateThumbnail(videoPath: string, timeSec: number, text: string, outPath: string): Promise<void> {
  const font = await findThumbnailFont();
  await run('ffmpeg', buildThumbnailArgs(videoPath, timeSec, outPath, text || undefined, font ?? undefined));
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/export/thumbnail.test.ts` → PASS.

- [ ] **Step 5: Wire into `rankAndExport` (all.ts)**

Inside the per-clip try block, right after `planFraming` (fullPath exists, before render so a render failure doesn't cost the thumb… actually AFTER render + music, right before the raw copy — a skipped clip must not leave orphan thumbnails):

```ts
const thumbRel = Math.max(0, pickThumbnailTime(clip, source.audio.rms_curve) - clip.start);
await generateThumbnail(fullPath, thumbRel, pack.thumbnailText, join(exportsDir, `${clip.clip_id}_thumbnail.png`));
```

with imports `import { pickThumbnailTime, generateThumbnail } from '../../export/thumbnail.js';`. Add `thumbnail: `${clip.clip_id}_thumbnail.png`` to the `files` object passed to `buildClipJson` in the exporter (Task 2 already made `files.thumbnail` optional).

- [ ] **Step 6: Full suite, e2e smoke, commit**

Run: `npx vitest run` → PASS. Manual smoke (if a cached workspace video exists): `node dist/cli/index.js process <small local file> --top 1` after `npm run build` → confirm `clip_001_thumbnail.png` appears.

```bash
git add src/export/thumbnail.ts src/cli/commands/all.ts src/export/exporter.ts tests/export/thumbnail.test.ts
git commit -m "feat: thumbnail engine — loudest-frame grab + bold bordered text per clip"
```

---

### Task 5: SFX sound-design engine (whoosh on zooms, impact under hook)

**Files:**
- Create: `src/sfx/library.ts`, `src/sfx/events.ts`, `src/sfx/mixer.ts`
- Modify: `src/cli/commands/all.ts`, `src/cli/index.ts`, `.env.example`
- Test: `tests/sfx/library.test.ts`, `tests/sfx/events.test.ts`, `tests/sfx/mixer.test.ts`

**Interfaces:**
- Consumes: `CaptionWord[]` (clip-relative, `emphasized` flags) from `buildCaptionWords`.
- Produces:
  ```ts
  export type SfxKind = 'whoosh' | 'impact' | 'pop' | 'riser' | 'bass';
  export function scanSfxLibrary(root: string): Promise<Partial<Record<SfxKind, string[]>>>;
  export function pickSfx(lib, kind: SfxKind, seed: string): string | null;
  export interface SfxEvent { time: number; path: string; }
  export function planSfx(words: CaptionWord[], lib, opts: { hasHook: boolean; zooms: boolean; seed: string }): SfxEvent[];
  export function buildSfxMixArgs(videoPath: string, events: SfxEvent[], outPath: string, opts: { sfxVolume: number }): string[];
  export function mixSfx(videoPath: string, events: SfxEvent[], outPath: string, opts?: { sfxVolume?: number }): Promise<void>;
  ```
  `AllOpts` gains `sfx?: boolean; sfxVolume?: number; sfxDir?: string`.

- [ ] **Step 1: Failing tests**

`tests/sfx/library.test.ts` — mirror `tests/music/library.test.ts`: tmp dir with `whoosh/a.mp3`, `impact_hit.wav` → scan finds both kinds; `pickSfx` deterministic for same seed; empty/missing root → `{}` and `null` picks.

`tests/sfx/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planSfx, buildZoomSfxTimes } from '../../src/sfx/events.js';

const w = (start: number, emphasized: boolean) => ({ text: 'x', start, end: start + 0.3, emphasized });

describe('buildZoomSfxTimes (mirrors remotion punchZoom)', () => {
  it('skips first second, enforces 2.5s min gap, caps at 4', () => {
    const words = [w(0.5, true), w(1.2, true), w(2.0, true), w(4.0, true), w(7.0, true), w(10, true), w(13, true)];
    expect(buildZoomSfxTimes(words)).toEqual([1.2, 4.0, 7.0, 10]);
  });
});

describe('planSfx', () => {
  const lib = { whoosh: ['/s/w.mp3'], impact: ['/s/i.mp3'] };
  it('impact at hook + whoosh per zoom event', () => {
    const events = planSfx([w(2, true), w(6, true)], lib, { hasHook: true, zooms: true, seed: 'a' });
    expect(events[0]).toEqual({ time: 0.05, path: '/s/i.mp3' });
    expect(events.filter((e) => e.path === '/s/w.mp3').map((e) => e.time)).toEqual([2, 6]);
  });
  it('no zooms flag → no whooshes; empty lib → no events', () => {
    expect(planSfx([w(2, true)], lib, { hasHook: false, zooms: false, seed: 'a' })).toEqual([]);
    expect(planSfx([w(2, true)], {}, { hasHook: true, zooms: true, seed: 'a' })).toEqual([]);
  });
});
```

`tests/sfx/mixer.test.ts`:

```ts
import { buildSfxMixArgs } from '../../src/sfx/mixer.js';
it('one adelay chain per event, video stream-copied', () => {
  const args = buildSfxMixArgs('v.mp4', [{ time: 1.5, path: 'w.mp3' }, { time: 4, path: 'i.mp3' }], 'o.mp4', { sfxVolume: 0.6 });
  const s = args.join(' ');
  expect(s).toContain('adelay=1500|1500');
  expect(s).toContain('adelay=4000|4000');
  expect(s).toContain('amix=inputs=3');
  expect(s).toContain('-c:v copy');
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/sfx` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/sfx/library.ts` — copy the music library pattern with kinds instead of moods:

```ts
/** Local SFX library (./sfx). Same convention as ./music: sfx/whoosh/*.mp3 or sfx/whoosh_*.mp3. */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export type SfxKind = 'whoosh' | 'impact' | 'pop' | 'riser' | 'bass';
const KINDS: SfxKind[] = ['whoosh', 'impact', 'pop', 'riser', 'bass'];
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg']);

export async function scanSfxLibrary(root: string): Promise<Partial<Record<SfxKind, string[]>>> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return {}; }
  const lib: Partial<Record<SfxKind, string[]>> = {};
  const add = (k: SfxKind, p: string) => { (lib[k] ??= []).push(p); };
  for (const e of entries) {
    if (e.isDirectory() && KINDS.includes(e.name as SfxKind)) {
      for (const f of (await readdir(join(root, e.name))).sort()) {
        if (AUDIO_EXTS.has(extname(f).toLowerCase())) add(e.name as SfxKind, join(root, e.name, f));
      }
    } else if (e.isFile() && AUDIO_EXTS.has(extname(e.name).toLowerCase())) {
      const k = KINDS.find((m) => e.name.toLowerCase().startsWith(`${m}_`));
      if (k) add(k, join(root, e.name));
    }
  }
  return lib;
}

export function pickSfx(lib: Partial<Record<SfxKind, string[]>>, kind: SfxKind, seed: string): string | null {
  const xs = lib[kind];
  if (!xs?.length) return null;
  const n = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
  return xs[n % xs.length];
}
```

`src/sfx/events.ts`:

```ts
/**
 * SFX timing plan. buildZoomSfxTimes MUST mirror remotion/src/punchZoom.ts buildZoomEvents
 * (min gap 2.5s, max 4 events, nothing in the first second) so sounds land exactly on the
 * visual punch-zooms.
 */
import type { CaptionWord } from '../types/index.js';
import { pickSfx, type SfxKind } from './library.js';

export function buildZoomSfxTimes(words: CaptionWord[], opts: { minGapSec?: number; maxEvents?: number } = {}): number[] {
  const minGap = opts.minGapSec ?? 2.5;
  const maxEvents = opts.maxEvents ?? 4;
  const events: number[] = [];
  for (const w of words) {
    if (!w.emphasized || w.start < 1) continue;
    if (events.length > 0 && w.start - events[events.length - 1] < minGap) continue;
    events.push(w.start);
    if (events.length >= maxEvents) break;
  }
  return events;
}

export interface SfxEvent { time: number; path: string; }

export function planSfx(
  words: CaptionWord[],
  lib: Partial<Record<SfxKind, string[]>>,
  opts: { hasHook: boolean; zooms: boolean; seed: string },
): SfxEvent[] {
  const events: SfxEvent[] = [];
  if (opts.hasHook) {
    const impact = pickSfx(lib, 'impact', `${opts.seed}_hook`);
    if (impact) events.push({ time: 0.05, path: impact });
  }
  if (opts.zooms) {
    for (const [i, t] of buildZoomSfxTimes(words).entries()) {
      const whoosh = pickSfx(lib, 'whoosh', `${opts.seed}_zoom_${i}`);
      if (whoosh) events.push({ time: t, path: whoosh });
    }
  }
  return events;
}
```

`src/sfx/mixer.ts`:

```ts
/** Post-render SFX mix: delay each one-shot to its event time and mix under the clip audio. */
import { run } from '../utils/cmd.js';
import type { SfxEvent } from './events.js';

export function buildSfxMixArgs(videoPath: string, events: SfxEvent[], outPath: string, opts: { sfxVolume: number }): string[] {
  const inputs = events.flatMap((e) => ['-i', e.path]);
  const chains = events.map((e, i) => {
    const ms = Math.round(e.time * 1000);
    return `[${i + 1}:a]adelay=${ms}|${ms},volume=${opts.sfxVolume}[s${i}]`;
  });
  const mixIn = `[0:a]${events.map((_, i) => `[s${i}]`).join('')}`;
  const filter = [...chains, `${mixIn}amix=inputs=${events.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`].join(';');
  return ['-i', videoPath, ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-y', outPath];
}

export async function mixSfx(videoPath: string, events: SfxEvent[], outPath: string, opts: { sfxVolume?: number } = {}): Promise<void> {
  if (!events.length) return;
  await run('ffmpeg', buildSfxMixArgs(videoPath, events, outPath, { sfxVolume: opts.sfxVolume ?? 0.6 }));
}
```

- [ ] **Step 4: Run sfx tests** — `npx vitest run tests/sfx` → PASS.

- [ ] **Step 5: Wire into pipeline + CLI**

`all.ts`: add to `AllOpts`: `sfx?: boolean; sfxVolume?: number; sfxDir?: string;`. In `rankAndExport`, scan once next to music:

```ts
const sfxLib = opts.sfx === false ? {} : await scanSfxLibrary(opts.sfxDir ?? process.env.SFX_DIR ?? './sfx');
```

In the per-clip try block, right after `render(...)` and before the music mix:

```ts
const sfxEvents = planSfx(captionWords, sfxLib, {
  hasHook: Boolean(hookText), zooms: opts.zooms !== false, seed: `${source.jobId}_${clip.clip_id}`,
});
if (sfxEvents.length) {
  const tmpSfx = finalPath.replace(/\.mp4$/, '.sfx.mp4');
  await mixSfx(finalPath, sfxEvents, tmpSfx, { sfxVolume: opts.sfxVolume ?? 0.6 });
  await rename(tmpSfx, finalPath);
  logger.info(`[${clip.clip_id}] sfx: ${sfxEvents.length} event(s)`);
}
```

`src/cli/index.ts` `addRenderOptions`, after the music flags:

```ts
.option('--no-sfx', 'disable sound-design SFX (whoosh on zooms, impact under hook)')
.option('--sfx-volume <v>', 'SFX one-shot level 0-1', (v) => parseFloat(v), 0.6)
.option('--sfx-dir <p>', 'SFX library folder', process.env.SFX_DIR ?? './sfx')
```

and in `renderOpts`: `sfx: o.sfx, sfxVolume: o.sfxVolume, sfxDir: o.sfxDir,`.

`.env.example`: add `# SFX_DIR=./sfx  — sound-design one-shots: sfx/whoosh/*.mp3, sfx/impact/*.mp3 (or whoosh_*.mp3 prefixes)`.

Create `sfx/.gitkeep` so the default folder exists.

- [ ] **Step 6: Full suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add src/sfx tests/sfx src/cli/commands/all.ts src/cli/index.ts .env.example sfx/.gitkeep
git commit -m "feat: SFX engine — whoosh on punch zooms, impact under hook card (./sfx library)"
```

---

### Task 6: Docs + gates

**Files:**
- Modify: `README.md` (outputs list, new flags, ./sfx convention, adaptive length note)

- [ ] **Step 1: Update README** — outputs section now lists per clip: `_final.mp4`, `_raw.mp4`, `.srt`, `.json`, `_thumbnail.png`, `_title.txt`, `_description.txt`, `_hashtags.txt`, `_hook.txt`; ranking adds `ranking_titles.txt` + `ranking_description.txt`; document `--no-sfx/--sfx-volume/--sfx-dir` and the `./sfx` folder convention; note adaptive 15–60s length.

- [ ] **Step 2: Run all gates**

```bash
npx vitest run && npx tsc --noEmit && (cd remotion && npx tsc --noEmit)
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v4 outputs — SEO files, thumbnails, ranking texts, SFX library, adaptive length"
```

---

## Self-Review

- **Spec coverage:** adaptive length → Task 1; SEO engine (title/desc/hashtags/hook/thumbnail-text) → Task 2; ranking outputs → Task 3; thumbnail engine (best frame + text) → Task 4; sound design → Task 5; docs → Task 6. Split-frame Mode C, replay-graph, BullMQ remain intentionally deferred (recorded in memory + completion plan).
- **Type consistency:** `SeoPack` produced in Task 2, consumed by Task 4 (`pack.thumbnailText`) and exporter; `SfxEvent`/`planSfx` names match between events.ts/mixer.ts/all.ts; `CaptionWord` import path is `../types/index.js` (types/index.ts already exports it).
- **Placeholder scan:** none — every step has full code.
