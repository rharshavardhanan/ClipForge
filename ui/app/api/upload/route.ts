import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { WORKSPACE_DIR } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.m4v']);

/**
 * Streaming video upload: POST /api/upload?name=<filename> with the raw file as body.
 * Streams to workspace/uploads/ (no in-memory buffering — files can be GBs) and returns
 * the absolute path, which the Import tab feeds to the pipeline as a local input.
 */
export async function POST(req: NextRequest) {
  const name = basename(req.nextUrl.searchParams.get('name') ?? '');
  const ext = extname(name).toLowerCase();
  if (!name || !VIDEO_EXTS.has(ext)) {
    return NextResponse.json({ error: `unsupported file type (need ${Array.from(VIDEO_EXTS).join(' ')})` }, { status: 400 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty body' }, { status: 400 });

  const dir = join(WORKSPACE_DIR, 'uploads');
  await mkdir(dir, { recursive: true });
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, '_');
  const dest = join(dir, `${Date.now()}_${safe}`);

  await pipeline(Readable.fromWeb(req.body as import('stream/web').ReadableStream), createWriteStream(dest));
  return NextResponse.json({ path: dest });
}
