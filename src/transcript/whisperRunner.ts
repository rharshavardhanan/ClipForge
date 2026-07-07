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
      .filter((t) => { const txt = t.text.trim(); return txt && !txt.startsWith('['); }) // drop specials like ' [_BEG_]'/' [_TT_n]'
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
  // -ojf (full JSON), NOT -oj: only the full output includes per-segment `tokens` — plain -oj
  // has no tokens at all, which mapWhisperJson turns into a 0-word transcript (live-debugged
  // 2026-07-07). No -ml 1: it split segments into sub-word fragments; natural segments give
  // phrase-level captions while tokens still carry the word timings.
  await run('whisper-cli', ['-m', model, '-f', wav, '-ojf', '-of', outBase]);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(`${outBase}.json`, 'utf8'));
  } catch {
    throw new Error(`whisper-cli ran but no JSON output was found at ${outBase}.json — check your whisper-cli version`);
  }
  return mapWhisperJson(json);
}
