import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAuthUrl, getAccessToken, saveAuthFile, loadAuthFile, pickChannel, _clearTokenCache,
  authFilePath, type YtChannel,
} from '../../src/publish/youtubeAuth.js';

const ch = (id: string, title: string): YtChannel => ({ channel_id: id, title, refresh_token: `rt_${id}` });

describe('buildAuthUrl', () => {
  it('carries client id, loopback redirect, upload+readonly scopes, offline access', () => {
    const u = new URL(buildAuthUrl('CID', 'http://127.0.0.1:9999'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9999');
    expect(u.searchParams.get('scope')).toContain('youtube.upload');
    expect(u.searchParams.get('scope')).toContain('youtube.readonly');
    expect(u.searchParams.get('scope')).toContain('yt-analytics.readonly');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
  });
});

describe('pickChannel', () => {
  const channels = [ch('UC1', 'Main Channel'), ch('UC2', 'Clips Channel')];
  it('single channel auto-picked without a query', () => {
    expect(pickChannel([channels[0]]).channel_id).toBe('UC1');
  });
  it('multiple channels without a query → error naming them', () => {
    expect(() => pickChannel(channels)).toThrow(/Main Channel, Clips Channel/);
  });
  it('matches by exact id, then case-insensitive title', () => {
    expect(pickChannel(channels, 'UC2').title).toBe('Clips Channel');
    expect(pickChannel(channels, 'main channel').channel_id).toBe('UC1');
  });
  it('no channels / unknown query → clear errors', () => {
    expect(() => pickChannel([])).toThrow(/auth youtube/);
    expect(() => pickChannel(channels, 'nope')).toThrow(/No connected channel/);
  });
});

describe('loadAuthFile migration', () => {
  it('migrates the old single-token shape to a default channel', async () => {
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), 'yt-mig-'));
    await mkdir(join(process.env.WORKSPACE_DIR, '.auth'), { recursive: true });
    await writeFile(authFilePath(), JSON.stringify({ client_id: 'CID', refresh_token: 'OLD_RT' }));
    const auth = await loadAuthFile();
    expect(auth.channels).toEqual([{ channel_id: 'default', title: 'default', refresh_token: 'OLD_RT' }]);
  });
  it('missing file → empty channels', async () => {
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), 'yt-empty-'));
    expect(await loadAuthFile()).toEqual({ channels: [] });
  });
});

describe('getAccessToken', () => {
  it('exchanges the chosen channel refresh token and caches per channel', async () => {
    process.env.YT_CLIENT_ID = 'CID';
    process.env.YT_CLIENT_SECRET = 'SEC';
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), 'yt-'));
    _clearTokenCache();
    await saveAuthFile({ channels: [ch('UC1', 'Main'), ch('UC2', 'Second')] });
    const bodies: string[] = [];
    const fakeFetch = (async (_url: any, init: any) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ access_token: `AT_${bodies.length}`, expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    expect(await getAccessToken('Main', fakeFetch)).toBe('AT_1');
    expect(await getAccessToken('Main', fakeFetch)).toBe('AT_1');   // cached
    expect(await getAccessToken('Second', fakeFetch)).toBe('AT_2'); // separate channel, separate token
    expect(bodies[0]).toContain('rt_UC1');
    expect(bodies[1]).toContain('rt_UC2');
  });

  it('invalid_grant → clear re-auth error', async () => {
    _clearTokenCache();
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch;
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), 'yt-bad-'));
    await saveAuthFile({ channels: [ch('UC1', 'Main')] });
    await expect(getAccessToken('Main', fakeFetch)).rejects.toThrow(/auth youtube/);
  });
});
