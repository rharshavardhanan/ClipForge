# YouTube Publish + Instagram Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1-click YouTube upload of exported clips (SEO metadata prefilled, not-made-for-kids, public by default) via the user's own OAuth'd channel, plus an Instagram caption-copy assist in the GUI.

**Architecture:** Plain-`fetch` REST client for YouTube Data API v3 (OAuth Desktop-app loopback flow → refresh token in `workspace/.auth/youtube.json`; resumable `videos.insert` + `thumbnails/set`). New `clipforge auth youtube` + `clipforge upload <exportsDir>` CLI commands; GUI adds an Upload dialog per clip (shells the CLI with `--json`) and a Copy-caption button.

**Tech Stack:** TypeScript ESM Node 20 (global fetch), vitest, commander, Next.js 14 GUI.

## Global Constraints

- No new npm dependencies (no `googleapis` SDK).
- Env: `YT_CLIENT_ID`, `YT_CLIENT_SECRET` (user's own Google Cloud Desktop-app OAuth client).
- Token file: `workspace/.auth/youtube.json` — workspace/ is already gitignored.
- Defaults: `privacyStatus: 'public'`, `selfDeclaredMadeForKids: false`.
- Per-clip upload failures must not stop the batch; a failed upload never modifies local files.
- Effectful HTTP goes through an injectable `fetchFn` parameter (default `globalThis.fetch`) so tests never hit the network.
- Gates: `npx vitest run`, root `npx tsc --noEmit`, `cd ui && npx next build`.

---

### Task 1: OAuth module (`youtubeAuth.ts`)

**Files:**
- Create: `src/publish/youtubeAuth.ts`
- Test: `tests/publish/youtubeAuth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function buildAuthUrl(clientId: string, redirectUri: string): string;
  export interface YtAuth { client_id: string; refresh_token: string; }
  export function authFilePath(): string; // <WORKSPACE_DIR>/.auth/youtube.json
  export function saveAuth(auth: YtAuth): Promise<void>;
  export function loadAuth(): Promise<YtAuth | null>;
  export function getAccessToken(fetchFn?: typeof fetch): Promise<string>; // refresh-token exchange, cached until expiry-60s
  export function authYoutube(fetchFn?: typeof fetch): Promise<void>;     // loopback browser flow, saves auth
  ```

- [ ] **Step 1: Failing tests** (`tests/publish/youtubeAuth.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { buildAuthUrl, getAccessToken, saveAuth } from '../../src/publish/youtubeAuth.js';

describe('buildAuthUrl', () => {
  it('carries client id, loopback redirect, upload scope, offline access', () => {
    const u = new URL(buildAuthUrl('CID', 'http://127.0.0.1:9999'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9999');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.upload');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('response_type')).toBe('code');
  });
});

describe('getAccessToken', () => {
  it('exchanges the saved refresh token and caches until expiry', async () => {
    process.env.YT_CLIENT_ID = 'CID';
    process.env.YT_CLIENT_SECRET = 'SEC';
    process.env.WORKSPACE_DIR = await (await import('node:fs/promises')).mkdtemp(
      (await import('node:path')).join((await import('node:os')).tmpdir(), 'yt-'));
    await saveAuth({ client_id: 'CID', refresh_token: 'RT' });
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    expect(await getAccessToken(fakeFetch)).toBe('AT');
    expect(await getAccessToken(fakeFetch)).toBe('AT'); // cached
    expect(calls).toBe(1);
  });
  it('invalid_grant → clear re-auth error', async () => {
    const { _clearTokenCache } = await import('../../src/publish/youtubeAuth.js');
    _clearTokenCache();
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch;
    await expect(getAccessToken(fakeFetch)).rejects.toThrow(/clipforge auth youtube/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/publish/youtubeAuth.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/publish/youtubeAuth.ts`**

```ts
/**
 * YouTube OAuth (Desktop-app loopback flow). One-time `clipforge auth youtube` opens the
 * browser for consent and stores the refresh token locally; getAccessToken() exchanges it
 * per run. Plain fetch — no googleapis SDK.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface YtAuth { client_id: string; refresh_token: string; }

export function buildAuthUrl(clientId: string, redirectUri: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

export function authFilePath(): string {
  return join(process.env.WORKSPACE_DIR ?? './workspace', '.auth', 'youtube.json');
}

export async function saveAuth(auth: YtAuth): Promise<void> {
  await mkdir(join(authFilePath(), '..'), { recursive: true });
  await writeFile(authFilePath(), JSON.stringify(auth, null, 2));
}

export async function loadAuth(): Promise<YtAuth | null> {
  try { return JSON.parse(await readFile(authFilePath(), 'utf8')); } catch { return null; }
}

function requireClient(): { id: string; secret: string } {
  const id = process.env.YT_CLIENT_ID;
  const secret = process.env.YT_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'YT_CLIENT_ID / YT_CLIENT_SECRET missing. Create a free "Desktop app" OAuth client at ' +
      'https://console.cloud.google.com/apis/credentials (enable "YouTube Data API v3" first) and add both to .env.',
    );
  }
  return { id, secret };
}

let cached: { token: string; expiresAt: number } | null = null;
/** Test hook — resets the in-memory access-token cache. */
export function _clearTokenCache(): void { cached = null; }

export async function getAccessToken(fetchFn: typeof fetch = fetch): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const { id, secret } = requireClient();
  const auth = await loadAuth();
  if (!auth) throw new Error('Not authenticated with YouTube — run: clipforge auth youtube');
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id, client_secret: secret,
      refresh_token: auth.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const j: any = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error(`YouTube token refresh failed (${j.error ?? res.status}) — run: clipforge auth youtube`);
  }
  cached = { token: j.access_token, expiresAt: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000 };
  return cached.token;
}

/** One-time interactive consent: loopback server + browser, then save the refresh token. */
export async function authYoutube(fetchFn: typeof fetch = fetch): Promise<void> {
  const { id, secret } = requireClient();

  const code = await new Promise<string>((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(c ? '<h2>ClipForge is connected — you can close this tab.</h2>' : `<h2>Auth failed: ${err ?? 'no code'}</h2>`);
      server.close();
      if (c) resolveCode(c); else reject(new Error(`OAuth consent failed: ${err ?? 'no code returned'}`));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const redirect = `http://127.0.0.1:${port}`;
      const url = buildAuthUrl(id, redirect);
      (server as any)._redirect = redirect;
      logger.info(`Opening browser for YouTube consent…\nIf it does not open, visit:\n${url}`);
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
    });
    setTimeout(() => { server.close(); reject(new Error('OAuth consent timed out after 5 minutes')); }, 300_000).unref();
  }).then(async (c) => c);

  // The redirect URI must match the one used in the consent URL — recover it from the server scope.
  // (We re-derive it by storing it during listen; see closure above.)
  // Exchange code → tokens.
  const redirectUri = (globalThis as any).__cfRedirect ?? '';
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: id, client_secret: secret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const j: any = await res.json();
  if (!res.ok || !j.refresh_token) {
    throw new Error(`Token exchange failed: ${j.error_description ?? j.error ?? res.status}`);
  }
  await saveAuth({ client_id: id, refresh_token: j.refresh_token });
  logger.info(`YouTube connected — token saved to ${authFilePath()}`);
}
```

**NOTE (implementer):** the redirect-URI plumbing through the promise above is awkward as sketched — restructure `authYoutube` so `redirect` is a variable in the outer function scope assigned inside `listen()` before the browser opens, and used directly in the exchange (no `globalThis`). Keep behavior identical to the tests.

- [ ] **Step 4: Run tests** — `npx vitest run tests/publish/youtubeAuth.test.ts` → PASS. (The interactive `authYoutube` path is exercised live in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/publish/youtubeAuth.ts tests/publish/youtubeAuth.test.ts
git commit -m "feat: YouTube OAuth — desktop loopback consent + refresh-token store"
```

---

### Task 2: Upload module (`youtubeUpload.ts`)

**Files:**
- Create: `src/publish/youtubeUpload.ts`
- Test: `tests/publish/youtubeUpload.test.ts`

**Interfaces:**
- Consumes: `SeoPack` from `src/export/seo.js`, `getAccessToken` from Task 1.
- Produces:
  ```ts
  export type YtPrivacy = 'public' | 'unlisted' | 'private';
  export interface UploadMeta { snippet: { title: string; description: string; tags: string[]; categoryId: string }; status: { privacyStatus: YtPrivacy; selfDeclaredMadeForKids: false } }
  export function seoToUploadMeta(seo: { title: string; description: string; hashtags: string[] }, opts: { privacy: YtPrivacy; titleOverride?: string; descriptionOverride?: string }): UploadMeta;
  export interface UploadResult { videoId: string; url: string; privacyStatus: string; }
  export function uploadVideo(videoPath: string, meta: UploadMeta, accessToken: string, fetchFn?: typeof fetch): Promise<UploadResult>;
  export function setThumbnail(videoId: string, pngPath: string, accessToken: string, fetchFn?: typeof fetch): Promise<boolean>; // false = skipped (403 not verified)
  ```

- [ ] **Step 1: Failing tests** (`tests/publish/youtubeUpload.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { seoToUploadMeta, uploadVideo } from '../../src/publish/youtubeUpload.js';

const seo = {
  title: 'He Actually Did It #ishowspeed #shorts',
  description: 'desc line\n\n#shorts #viral',
  hashtags: ['#ishowspeed', '#shorts', '#viral', '#fyp'],
};

describe('seoToUploadMeta', () => {
  it('maps SEO pack → snippet/status with not-made-for-kids', () => {
    const m = seoToUploadMeta(seo, { privacy: 'public' });
    expect(m.snippet.title).toBe('He Actually Did It #ishowspeed #shorts');
    expect(m.snippet.tags).toEqual(['ishowspeed', 'shorts', 'viral', 'fyp']);
    expect(m.status).toEqual({ privacyStatus: 'public', selfDeclaredMadeForKids: false });
  });
  it('clamps title to 100 chars and strips <>', () => {
    const m = seoToUploadMeta({ ...seo, title: '<' + 'x'.repeat(150) + '>' }, { privacy: 'public' });
    expect(m.snippet.title.length).toBeLessThanOrEqual(100);
    expect(m.snippet.title).not.toMatch(/[<>]/);
  });
  it('caps total tag characters at 450', () => {
    const long = Array.from({ length: 60 }, (_, i) => `#tagtagtag${i}`);
    const m = seoToUploadMeta({ ...seo, hashtags: long }, { privacy: 'public' });
    expect(m.snippet.tags.join('').length).toBeLessThanOrEqual(450);
  });
  it('applies title/description overrides (GUI review dialog)', () => {
    const m = seoToUploadMeta(seo, { privacy: 'unlisted', titleOverride: 'My Title', descriptionOverride: 'D' });
    expect(m.snippet.title).toBe('My Title');
    expect(m.snippet.description).toBe('D');
    expect(m.status.privacyStatus).toBe('unlisted');
  });
});

describe('uploadVideo', () => {
  it('resumable init → PUT bytes → parses id + privacyStatus', async () => {
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'up-'));
    const vid = join(dir, 'v.mp4');
    await writeFile(vid, Buffer.from('fakevideo'));

    const calls: { url: string; method?: string }[] = [];
    const fakeFetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), method: init?.method });
      if (String(url).includes('uploadType=resumable')) {
        return new Response(null, { status: 200, headers: { location: 'https://upload.example/session1' } });
      }
      return new Response(JSON.stringify({ id: 'VID123', status: { privacyStatus: 'private' } }), { status: 200 });
    }) as typeof fetch;

    const meta = seoToUploadMeta(seo, { privacy: 'public' });
    const r = await uploadVideo(vid, meta, 'AT', fakeFetch);
    expect(r.videoId).toBe('VID123');
    expect(r.url).toBe('https://youtu.be/VID123');
    expect(r.privacyStatus).toBe('private'); // caller detects the downgrade
    expect(calls[0].method).toBe('POST');
    expect(calls[1].url).toBe('https://upload.example/session1');
    expect(calls[1].method).toBe('PUT');
  });
  it('quotaExceeded → friendly error', async () => {
    const fakeFetch = (async () => new Response(
      JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 },
    )) as typeof fetch;
    const meta = seoToUploadMeta(seo, { privacy: 'public' });
    await expect(uploadVideo('/nope.mp4', meta, 'AT', fakeFetch)).rejects.toThrow(/quota/i);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/publish/youtubeUpload.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/publish/youtubeUpload.ts`**

```ts
/**
 * YouTube Data API v3 upload: resumable videos.insert + thumbnails.set, plain fetch.
 * Clips are 20–80 MB so the file is buffered (no streaming needed).
 */
import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';

export type YtPrivacy = 'public' | 'unlisted' | 'private';

export interface UploadMeta {
  snippet: { title: string; description: string; tags: string[]; categoryId: string };
  status: { privacyStatus: YtPrivacy; selfDeclaredMadeForKids: false };
}

const TITLE_MAX = 100;
const DESC_MAX = 5000;
const TAGS_CHAR_BUDGET = 450; // API limit is 500 incl. overhead — stay under

export function seoToUploadMeta(
  seo: { title: string; description: string; hashtags: string[] },
  opts: { privacy: YtPrivacy; titleOverride?: string; descriptionOverride?: string },
): UploadMeta {
  const title = (opts.titleOverride ?? seo.title).replace(/[<>]/g, '').slice(0, TITLE_MAX);
  const description = (opts.descriptionOverride ?? seo.description).replace(/[<>]/g, '').slice(0, DESC_MAX);
  const tags: string[] = [];
  let budget = TAGS_CHAR_BUDGET;
  for (const h of seo.hashtags) {
    const t = h.replace(/^#/, '');
    if (t.length > budget) break;
    tags.push(t);
    budget -= t.length;
  }
  return {
    snippet: { title, description, tags, categoryId: '24' /* Entertainment */ },
    status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false },
  };
}

export interface UploadResult { videoId: string; url: string; privacyStatus: string; }

async function apiError(res: Response, what: string): Promise<Error> {
  const j: any = await res.json().catch(() => ({}));
  const reason = j?.error?.errors?.[0]?.reason ?? '';
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new Error('YouTube API quota exceeded — the default quota allows ~6 uploads/day (resets midnight Pacific).');
  }
  return new Error(`${what} failed (${res.status} ${reason || j?.error?.message || ''})`);
}

export async function uploadVideo(
  videoPath: string, meta: UploadMeta, accessToken: string, fetchFn: typeof fetch = fetch,
): Promise<UploadResult> {
  const init = await fetchFn(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    },
  );
  if (!init.ok) throw await apiError(init, 'Upload session init');
  const session = init.headers.get('location');
  if (!session) throw new Error('Upload session init returned no location header');

  const bytes = await readFile(videoPath);
  const put = await fetchFn(session, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/mp4' },
    body: bytes,
  });
  if (!put.ok) throw await apiError(put, 'Video upload');
  const j: any = await put.json();
  if (!j.id) throw new Error('Upload response missing video id');
  return { videoId: j.id, url: `https://youtu.be/${j.id}`, privacyStatus: j.status?.privacyStatus ?? 'unknown' };
}

/** Set the custom thumbnail; returns false (and warns) when the channel isn't allowed to. */
export async function setThumbnail(
  videoId: string, pngPath: string, accessToken: string, fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const png = await readFile(pngPath);
  const res = await fetchFn(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' }, body: png },
  );
  if (res.status === 403) {
    logger.warn('thumbnail: channel not enabled for custom thumbnails (verify phone at youtube.com/verify) — skipped');
    return false;
  }
  if (!res.ok) throw await apiError(res, 'Thumbnail set');
  return true;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/publish/youtubeUpload.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/publish/youtubeUpload.ts tests/publish/youtubeUpload.test.ts
git commit -m "feat: YouTube resumable upload + thumbnail set (plain fetch, SEO-pack metadata)"
```

---

### Task 3: CLI commands (`auth`, `upload`)

**Files:**
- Create: `src/cli/commands/publish.ts`
- Modify: `src/cli/index.ts` (register both commands)
- Test: `tests/cli/publish.test.ts`

**Interfaces:**
- Consumes: Task 1 `authYoutube/getAccessToken`, Task 2 `seoToUploadMeta/uploadVideo/setThumbnail`.
- Produces:
  ```ts
  export interface UploadOpts { clips?: string; privacy: YtPrivacy; dryRun?: boolean; force?: boolean; json?: boolean; title?: string; description?: string; }
  export function selectClips(manifestClips: { clip_id: string }[], clipsCsv?: string): string[];
  export function runUpload(exportsDir: string, opts: UploadOpts): Promise<void>;
  ```
  CLI output with `--json`: single line `JSON.stringify({ results: [{ clip: string, videoId?: string, url?: string, privacyStatus?: string, locked?: boolean, error?: string, skipped?: boolean }] })` printed to stdout as the LAST line.

- [ ] **Step 1: Failing test** (`tests/cli/publish.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { selectClips } from '../../src/cli/commands/publish.js';

describe('selectClips', () => {
  const clips = [{ clip_id: 'clip_001' }, { clip_id: 'clip_002' }, { clip_id: 'clip_003' }];
  it('no filter → all clips in order', () => {
    expect(selectClips(clips)).toEqual(['clip_001', 'clip_002', 'clip_003']);
  });
  it('csv filter keeps manifest order, ignores unknown ids', () => {
    expect(selectClips(clips, 'clip_003,clip_001,clip_999')).toEqual(['clip_001', 'clip_003']);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/cli/publish.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/cli/commands/publish.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ora from 'ora';
import { authYoutube, getAccessToken } from '../../publish/youtubeAuth.js';
import { seoToUploadMeta, uploadVideo, setThumbnail, type YtPrivacy } from '../../publish/youtubeUpload.js';
import { logger } from '../../utils/logger.js';

export async function runAuthYoutube(): Promise<void> {
  await authYoutube();
}

export interface UploadOpts {
  clips?: string; privacy: YtPrivacy; dryRun?: boolean; force?: boolean; json?: boolean;
  title?: string; description?: string;
}

/** PURE: manifest clips → clip ids to upload, in manifest order, optionally CSV-filtered. */
export function selectClips(manifestClips: { clip_id: string }[], clipsCsv?: string): string[] {
  const all = manifestClips.map((c) => c.clip_id);
  if (!clipsCsv) return all;
  const want = new Set(clipsCsv.split(',').map((s) => s.trim()).filter(Boolean));
  return all.filter((id) => want.has(id));
}

interface UploadOutcome {
  clip: string; videoId?: string; url?: string; privacyStatus?: string;
  locked?: boolean; error?: string; skipped?: boolean;
}

export async function runUpload(exportsDir: string, opts: UploadOpts): Promise<void> {
  const dir = resolve(exportsDir);
  const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
  const ids = selectClips(manifest.clips ?? [], opts.clips);
  if (ids.length === 0) throw new Error(`No matching clips in ${dir}`);

  const results: UploadOutcome[] = [];
  for (const id of ids) {
    const jsonPath = join(dir, `${id}.json`);
    const clipJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    if (clipJson.youtube?.videoId && !opts.force) {
      logger.info(`[${id}] already uploaded → ${clipJson.youtube.url} (use --force to re-upload)`);
      results.push({ clip: id, ...clipJson.youtube, skipped: true });
      continue;
    }
    if (!clipJson.seo) {
      results.push({ clip: id, error: 'clip.json has no seo block (re-export with current ClipForge)' });
      continue;
    }
    const meta = seoToUploadMeta(clipJson.seo, {
      privacy: opts.privacy, titleOverride: opts.title, descriptionOverride: opts.description,
    });
    if (opts.dryRun) {
      logger.info(`[${id}] DRY RUN would upload ${clipJson.files.final} as:\n` + JSON.stringify(meta, null, 2));
      results.push({ clip: id, skipped: true });
      continue;
    }

    const sp = ora(`[${id}] uploading to YouTube…`).start();
    try {
      const token = await getAccessToken();
      const r = await uploadVideo(join(dir, clipJson.files.final), meta, token);
      const locked = r.privacyStatus !== opts.privacy;
      try {
        if (clipJson.files.thumbnail) await setThumbnail(r.videoId, join(dir, clipJson.files.thumbnail), token);
      } catch (e) {
        logger.warn(`[${id}] thumbnail: ${e instanceof Error ? e.message : e}`);
      }
      const record = { videoId: r.videoId, url: r.url, privacyStatus: r.privacyStatus, uploadedAt: new Date().toISOString() };
      await writeFile(jsonPath, JSON.stringify({ ...clipJson, youtube: record }, null, 2));
      results.push({ clip: id, ...record, locked });
      sp.succeed(locked
        ? `[${id}] uploaded ${r.url} — YouTube locked it PRIVATE (unverified Cloud app). Publish: https://studio.youtube.com/video/${r.videoId}/edit`
        : `[${id}] LIVE (${r.privacyStatus}) → ${r.url}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ clip: id, error: msg });
      sp.fail(`[${id}] ${msg}`);
    }
  }

  const ok = results.filter((r) => r.url && !r.skipped).length;
  logger.info(`\nUpload done: ${ok} uploaded, ${results.filter((r) => r.skipped).length} skipped, ${results.filter((r) => r.error).length} failed.`);
  if (opts.json) console.log(JSON.stringify({ results }));
}
```

- [ ] **Step 4: Register in `src/cli/index.ts`** (after the `rank` command):

```ts
import { runAuthYoutube, runUpload } from './commands/publish.js';

program.command('auth')
  .description('Connect an account for direct publishing')
  .argument('<service>', 'youtube')
  .action(async (service) => {
    try {
      if (service !== 'youtube') throw new Error(`Unknown service "${service}" — supported: youtube`);
      await runAuthYoutube();
    } catch (e) { logger.error((e as Error).message); process.exit(1); }
  });

program.command('upload')
  .description('Upload exported clips to YouTube (title/description/tags/thumbnail from the SEO pack)')
  .argument('<exportsDir>', 'a workspace/exports/<id> directory containing clips_manifest.json')
  .option('--clips <ids>', 'comma-separated clip ids (default: all)')
  .option('--privacy <p>', 'public|unlisted|private', 'public')
  .option('--title <t>', 'override title (single-clip use)')
  .option('--description <d>', 'override description (single-clip use)')
  .option('--dry-run', 'print what would be uploaded without uploading')
  .option('--force', 're-upload clips already marked uploaded')
  .option('--json', 'print machine-readable results as the last stdout line')
  .action(async (dir, o) => {
    try {
      if (!['public', 'unlisted', 'private'].includes(o.privacy)) throw new Error('--privacy must be public|unlisted|private');
      await runUpload(dir, { clips: o.clips, privacy: o.privacy, dryRun: o.dryRun, force: o.force, json: o.json, title: o.title, description: o.description });
    } catch (e) { logger.error((e as Error).stack ?? String(e)); process.exit(1); }
  });
```

- [ ] **Step 5: Run** — `npx vitest run tests/cli/publish.test.ts` → PASS; `npx tsc --noEmit` clean; `npm run build && node dist/cli/index.js upload --help` shows the flags.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/publish.ts src/cli/index.ts tests/cli/publish.test.ts
git commit -m "feat: clipforge auth youtube + clipforge upload — 1-command publish from an exports dir"
```

---

### Task 4: GUI — Upload dialog + Copy caption

**Files:**
- Create: `ui/app/api/publish/route.ts`
- Modify: `ui/components/clips-tab.tsx`

**Interfaces:**
- Consumes: CLI `upload` with `--json` (Task 3); existing `/api/video?job=&file=` route for fetching `clip.json` / `*_description.txt`; `REPO_ROOT`, `WORKSPACE_DIR` from `ui/lib/workspace`.
- Produces: POST `/api/publish` body `{ job: string, clip: string, title?: string, description?: string, privacy?: 'public'|'unlisted'|'private' }` → `{ ok: true, result: { url, privacyStatus, locked } }` or `{ error: string }` (status 400/500).

- [ ] **Step 1: Implement `ui/app/api/publish/route.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { REPO_ROOT, WORKSPACE_DIR } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
const pexec = promisify(execFile);
const ID = /^[A-Za-z0-9_-]+$/;

/** Upload one clip to YouTube via the CLI. Body: { job, clip, title?, description?, privacy? }. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const job = typeof b?.job === 'string' && ID.test(b.job) ? b.job : '';
  const clip = typeof b?.clip === 'string' && ID.test(b.clip) ? b.clip : '';
  if (!job || !clip) return NextResponse.json({ error: 'invalid job/clip' }, { status: 400 });
  const privacy = ['public', 'unlisted', 'private'].includes(b.privacy) ? b.privacy : 'public';

  const args = ['dist/cli/index.js', 'upload', join(WORKSPACE_DIR, 'exports', job), '--clips', clip, '--privacy', privacy, '--json', '--force'];
  if (typeof b.title === 'string' && b.title.trim()) args.push('--title', b.title.trim());
  if (typeof b.description === 'string' && b.description.trim()) args.push('--description', b.description);

  try {
    const { stdout } = await pexec('node', args, { cwd: REPO_ROOT, timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
    const last = stdout.trim().split('\n').at(-1) ?? '{}';
    const parsed = JSON.parse(last);
    const result = parsed.results?.[0];
    if (!result || result.error) return NextResponse.json({ error: result?.error ?? 'upload failed' }, { status: 500 });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(-500) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add Upload dialog + Copy caption to `ui/components/clips-tab.tsx`**

Add inside the per-clip card's action row (`<div className="mt-auto flex gap-3 pt-1 text-xs">`), following the existing Button/Badge component idioms:

```tsx
// state at ClipsTab top-level:
const [pub, setPub] = useState<{ job: string; clip: string; title: string; description: string; privacy: string; busy: boolean; result?: string; error?: string } | null>(null);

// per-clip buttons (inside the action row):
<button className="font-medium text-zinc-400 hover:text-gold" onClick={() => openPublish(job.id, c)}>▶ YouTube</button>
<button className="font-medium text-zinc-400 hover:text-gold" onClick={() => copyCaption(job.id, c.clipId)}>IG caption</button>

// helpers in the component:
async function openPublish(jobId: string, c: ExportJob['clips'][number]) {
  const r = await fetch(`/api/video?job=${encodeURIComponent(jobId)}&file=${encodeURIComponent(c.files.json)}`);
  const j = await r.json().catch(() => null);
  setPub({
    job: jobId, clip: c.clipId, privacy: 'public', busy: false,
    title: j?.seo?.title ?? c.title ?? '', description: j?.seo?.description ?? '',
  });
}
async function copyCaption(jobId: string, clipId: string) {
  const r = await fetch(`/api/video?job=${encodeURIComponent(jobId)}&file=${encodeURIComponent(`${clipId}_description.txt`)}`);
  await navigator.clipboard.writeText(await r.text());
}
async function doPublish() {
  if (!pub) return;
  setPub({ ...pub, busy: true, error: undefined });
  const r = await fetch('/api/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: pub.job, clip: pub.clip, title: pub.title, description: pub.description, privacy: pub.privacy }),
  });
  const j = await r.json();
  if (j.ok) setPub({ ...pub, busy: false, result: j.result.locked
    ? `Uploaded (locked private by YouTube — publish in Studio): ${j.result.url}`
    : `Live: ${j.result.url}` });
  else setPub({ ...pub, busy: false, error: j.error });
}

// modal JSX at the end of the component's return (before closing </div>):
{pub && (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => !pub.busy && setPub(null)}>
    <Card className="w-full max-w-lg flex flex-col gap-3" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
      <p className="font-display text-base font-semibold text-zinc-100">Upload {pub.clip} to YouTube</p>
      <label className="text-xs text-zinc-500">Title
        <input className="mt-1 w-full rounded-lg border border-line bg-ink-900 px-3 py-2 text-sm text-zinc-100" value={pub.title} maxLength={100} onChange={(e) => setPub({ ...pub, title: e.target.value })} />
      </label>
      <label className="text-xs text-zinc-500">Description
        <textarea className="mt-1 h-32 w-full rounded-lg border border-line bg-ink-900 px-3 py-2 text-sm text-zinc-100" value={pub.description} onChange={(e) => setPub({ ...pub, description: e.target.value })} />
      </label>
      <div className="flex items-center gap-3">
        <select className="rounded-lg border border-line bg-ink-900 px-2 py-1.5 text-sm text-zinc-100" value={pub.privacy} onChange={(e) => setPub({ ...pub, privacy: e.target.value })}>
          <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option>
        </select>
        <Badge>Not made for kids</Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPub(null)} disabled={pub.busy}>Cancel</Button>
          <Button size="sm" onClick={doPublish} disabled={pub.busy || !pub.title.trim()}>{pub.busy ? 'Uploading…' : 'Upload'}</Button>
        </div>
      </div>
      {pub.result && <p className="text-xs text-green-400 break-all">{pub.result}</p>}
      {pub.error && <p className="text-xs text-red-400 break-all">{pub.error}{pub.error.includes('auth') ? ' — run `clipforge auth youtube` in a terminal first.' : ''}</p>}
    </Card>
  </div>
)}
```

**NOTE (implementer):** match the actual `Card`/`Button` prop signatures in `ui/components/ui.tsx` (Card may not accept onClick — wrap in a div if needed). Keep Tailwind tokens (`ink-900`, `line`, `gold`) consistent with the file's existing classes.

- [ ] **Step 3: Gate** — `cd ui && npx next build` → compiles clean.

- [ ] **Step 4: Commit**

```bash
git add ui/app/api/publish/route.ts ui/components/clips-tab.tsx
git commit -m "feat(ui): 1-click YouTube upload dialog (prefilled SEO, privacy select) + IG caption copy"
```

---

### Task 5: Docs + live verification

**Files:**
- Modify: `README.md`, `.env.example`

- [ ] **Step 1: `.env.example`** — add under the API-keys section:

```
# === YouTube publishing (clipforge auth youtube / clipforge upload) ===
# Create a FREE "Desktop app" OAuth client: console.cloud.google.com/apis/credentials
# (first enable "YouTube Data API v3" in that project's API Library).
# Note: until you "Publish app" + verify it, uploads are locked private by YouTube.
YT_CLIENT_ID=
YT_CLIENT_SECRET=
```

- [ ] **Step 2: README** — add a "Publish to YouTube" section after the GUI section: setup steps (Cloud project → enable API → Desktop-app OAuth client → .env → `clipforge auth youtube`), usage (`clipforge upload workspace/exports/<id> [--clips ...] [--privacy ...] [--dry-run]`), the GUI button, the two caveats (unverified app → private lock + Studio link; ~6 uploads/day default quota), and the Instagram note (drag `_final.mp4` into IG, caption = `_description.txt` / "IG caption" button).

- [ ] **Step 3: Full gates**

```bash
npx vitest run && npx tsc --noEmit && (cd ui && npx next build)
```

- [ ] **Step 4: Live verification (needs user's YT_CLIENT_ID/SECRET in .env)**

```bash
npm run build
node dist/cli/index.js upload workspace/exports/<some-id> --dry-run   # metadata preview, no network
# then with the user present: node dist/cli/index.js auth youtube && upload --clips clip_001 --privacy unlisted
```

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example
git commit -m "docs: YouTube publish setup + usage, Instagram manual flow"
```

---

## Self-Review

- **Spec coverage:** auth flow → Task 1; upload+thumbnail+downgrade detection → Tasks 2–3; skip-already-uploaded + `--force`, `--dry-run`, per-clip isolation, clip.json youtube record → Task 3; GUI dialog + caption copy → Task 4; quota/setup errors → Tasks 2–3; docs → Task 5. Out-of-scope items untouched.
- **Type consistency:** `YtPrivacy`, `UploadMeta`, `UploadResult`, `UploadOpts`, `--json` result shape used identically across Tasks 2–4.
- **Placeholders:** two explicit implementer NOTEs (auth redirect-URI restructure; ui.tsx prop check) — intentional adaptation points with behavior pinned by tests, not gaps.
