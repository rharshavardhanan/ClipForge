import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(m.snippet.description).toBe('desc line\n\n#shorts #viral');
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
