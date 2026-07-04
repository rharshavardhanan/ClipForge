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
  it('missing frame file (even with valid keys) → null, never throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'payoff-'));
    const fetchFn = (async () => new Response(JSON.stringify(goodBody), { status: 200 })) as typeof fetch;
    await expect(
      generatePayoffImage(join(dir, 'does-not-exist.jpg'), dir, { GEMINI_API_KEYS: 'k1' } as never, fetchFn),
    ).resolves.toBeNull();
  });
  it('second call for the same frame hits the cache and never calls fetch again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'payoff-'));
    const frame = join(dir, 'f.jpg');
    await writeFile(frame, Buffer.from('jpegbytes'));
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify(goodBody), { status: 200 });
    }) as typeof fetch;
    const first = await generatePayoffImage(frame, dir, { GEMINI_API_KEYS: 'k1' } as never, fetchFn);
    expect(calls).toBe(1);
    const second = await generatePayoffImage(frame, dir, { GEMINI_API_KEYS: 'k1' } as never, fetchFn);
    expect(second).toBe(first);
    expect(calls).toBe(1); // cache hit — fetchFn was NOT invoked a second time
  });
  it('key rotation stops at the first success — later keys are never called', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'payoff-'));
    const frame = join(dir, 'f.jpg');
    await writeFile(frame, Buffer.from('jpegbytes'));
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify(goodBody), { status: 200 });
    }) as typeof fetch;
    const out = await generatePayoffImage(frame, dir, { GEMINI_API_KEYS: 'k1,k2,k3' } as never, fetchFn);
    expect(out).not.toBeNull();
    expect(calls).toBe(1); // first key already succeeded — k2/k3 must never be tried
  });
});
