/**
 * YouTube OAuth (Desktop-app loopback flow). One-time `clipforge auth youtube` opens the
 * browser for consent and stores the refresh token locally; getAccessToken() exchanges it
 * per run. Plain fetch — no googleapis SDK.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface YtAuth { client_id: string; refresh_token: string; }

/** PURE: Google consent URL for the loopback flow. */
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
  await mkdir(dirname(authFilePath()), { recursive: true });
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

/** Refresh-token → access-token exchange, cached in-memory until ~expiry. */
export async function getAccessToken(fetchFn: typeof fetch = fetch): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const { id, secret } = requireClient();
  const auth = await loadAuth();
  if (!auth) throw new Error('Not authenticated with YouTube — run: ./start.sh auth youtube');
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
    throw new Error(`YouTube token refresh failed (${j.error ?? res.status}) — run: ./start.sh auth youtube`);
  }
  cached = { token: j.access_token, expiresAt: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000 };
  return cached.token;
}

/** One-time interactive consent: loopback server + browser, then save the refresh token. */
export async function authYoutube(fetchFn: typeof fetch = fetch): Promise<void> {
  const { id, secret } = requireClient();

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirect = '';
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname === '/favicon.ico') { res.writeHead(404); res.end(); return; }
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(c
        ? '<h2 style="font-family:sans-serif">✅ ClipForge is connected — you can close this tab.</h2>'
        : `<h2 style="font-family:sans-serif">Auth failed: ${err ?? 'no code'}</h2>`);
      server.close();
      if (c) resolve({ code: c, redirectUri: redirect });
      else reject(new Error(`OAuth consent failed: ${err ?? 'no code returned'}`));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      redirect = `http://127.0.0.1:${port}`;
      const url = buildAuthUrl(id, redirect);
      logger.info(`Opening browser for YouTube consent…\nIf it does not open, visit:\n${url}`);
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
    });
    setTimeout(() => { server.close(); reject(new Error('OAuth consent timed out after 5 minutes')); }, 300_000).unref();
  });

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
