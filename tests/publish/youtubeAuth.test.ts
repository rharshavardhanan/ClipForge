import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAuthUrl, getAccessToken, saveAuth, _clearTokenCache } from '../../src/publish/youtubeAuth.js';

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
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), 'yt-'));
    _clearTokenCache();
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
    _clearTokenCache();
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch;
    await expect(getAccessToken(fakeFetch)).rejects.toThrow(/auth youtube/);
  });

  it('errors when no auth file exists', async () => {
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), 'yt-empty-'));
    _clearTokenCache();
    const fakeFetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    await expect(getAccessToken(fakeFetch)).rejects.toThrow(/auth youtube/);
  });
});
