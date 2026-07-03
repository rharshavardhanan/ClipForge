/**
 * YouTube OAuth (Desktop-app loopback flow), multi-channel. Run `clipforge auth youtube`
 * once per channel — Google's account picker is where you choose the channel/brand account;
 * each consent stores a refresh token labeled with the channel's name. Uploads pick a
 * channel by name/id. Plain fetch — no googleapis SDK.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

// yt-analytics.readonly powers `clipforge stats` (retention/completion/shares).
// Tokens minted before it was added still upload fine but produce partial stats —
// re-run `clipforge auth youtube` to grant it.
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface YtChannel { channel_id: string; title: string; refresh_token: string; }
export interface YtAuthFile { channels: YtChannel[]; }

/** PURE: Google consent URL for the loopback flow. */
export function buildAuthUrl(clientId: string, redirectUri: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

export function authFilePath(): string {
  return join(process.env.WORKSPACE_DIR ?? './workspace', '.auth', 'youtube.json');
}

export async function saveAuthFile(auth: YtAuthFile): Promise<void> {
  await mkdir(dirname(authFilePath()), { recursive: true });
  await writeFile(authFilePath(), JSON.stringify(auth, null, 2));
}

/** Load the channel store; silently migrates the pre-multichannel single-token shape. */
export async function loadAuthFile(): Promise<YtAuthFile> {
  let raw: any;
  try { raw = JSON.parse(await readFile(authFilePath(), 'utf8')); } catch { return { channels: [] }; }
  if (Array.isArray(raw?.channels)) return raw as YtAuthFile;
  if (typeof raw?.refresh_token === 'string') {
    return { channels: [{ channel_id: 'default', title: 'default', refresh_token: raw.refresh_token }] };
  }
  return { channels: [] };
}

/**
 * PURE: resolve which channel to use. Exact channel_id match wins, else case-insensitive
 * title match. No query: a single connected channel is auto-picked; multiple → error
 * naming them (the caller should pass --channel / a dialog selection).
 */
export function pickChannel(channels: YtChannel[], query?: string): YtChannel {
  if (channels.length === 0) throw new Error('Not authenticated with YouTube — run: ./start.sh auth youtube');
  if (!query) {
    if (channels.length === 1) return channels[0];
    throw new Error(`Multiple YouTube channels connected — pass --channel. Available: ${channels.map((c) => c.title).join(', ')}`);
  }
  const byId = channels.find((c) => c.channel_id === query);
  if (byId) return byId;
  const byTitle = channels.find((c) => c.title.toLowerCase() === query.toLowerCase());
  if (byTitle) return byTitle;
  throw new Error(`No connected channel matches "${query}". Available: ${channels.map((c) => c.title).join(', ')}`);
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

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** Test hook — resets the in-memory access-token cache. */
export function _clearTokenCache(): void { tokenCache.clear(); }

/** Refresh-token → access-token for the resolved channel, cached in-memory until ~expiry. */
export async function getAccessToken(channel?: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const auth = await loadAuthFile();
  const ch = pickChannel(auth.channels, channel);
  const cached = tokenCache.get(ch.channel_id);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const { id, secret } = requireClient();
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id, client_secret: secret,
      refresh_token: ch.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const j: any = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error(`YouTube token refresh failed for "${ch.title}" (${j.error ?? res.status}) — run: ./start.sh auth youtube`);
  }
  tokenCache.set(ch.channel_id, {
    token: j.access_token,
    expiresAt: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000,
  });
  return j.access_token;
}

/** Fetch the authorized channel's id+title with a fresh access token. */
async function fetchChannelInfo(accessToken: string, fetchFn: typeof fetch): Promise<{ channel_id: string; title: string }> {
  const res = await fetchFn('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j: any = await res.json();
  const item = j?.items?.[0];
  if (!res.ok || !item) return { channel_id: `unknown_${Date.now()}`, title: 'unnamed channel' };
  return { channel_id: item.id, title: item.snippet?.title ?? item.id };
}

/** One-time interactive consent per channel: loopback server + browser, then upsert the channel. */
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

  const info = await fetchChannelInfo(j.access_token, fetchFn);
  const auth = await loadAuthFile();
  const others = auth.channels.filter((c) => c.channel_id !== info.channel_id && c.channel_id !== 'default');
  await saveAuthFile({ channels: [...others, { ...info, refresh_token: j.refresh_token }] });
  logger.info(`YouTube connected: "${info.title}" — token saved to ${authFilePath()}`);
  logger.info('Run `./start.sh auth youtube` again with another Google account/brand channel to add more channels.');
}
