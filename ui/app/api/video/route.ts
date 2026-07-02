import { createReadStream, statSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { exportFilePath } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

/** Range-aware file streamer for export artifacts: /api/video?job=<id>&file=<name>. */
export async function GET(req: NextRequest) {
  const job = req.nextUrl.searchParams.get('job') ?? '';
  const file = req.nextUrl.searchParams.get('file') ?? '';
  if (!job || !file) return new Response('job and file required', { status: 400 });

  const path = exportFilePath(job, file);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response('not found', { status: 404 });
  }

  const ext = file.slice(file.lastIndexOf('.'));
  const type = TYPES[ext] ?? 'application/octet-stream';
  const range = req.headers.get('range');

  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, {
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  });
}
