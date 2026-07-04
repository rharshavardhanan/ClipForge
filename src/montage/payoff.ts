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
