import { createReadStream, statSync } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { NextRequest } from 'next/server';
import { exportFilePath } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.srt': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

/**
 * Wrap an fs ReadStream in a web ReadableStream with abort-safe plumbing.
 * `<video>` elements constantly open and abort range requests while seeking/buffering;
 * Node's built-in Readable.toWeb() throws an *uncatchable* ERR_INVALID_STATE when it
 * enqueues into a controller the browser already cancelled, which crashes the dev server.
 * Here every enqueue is guarded and cancel() destroys the fs stream so it stops emitting.
 */
function fsToWeb(fsStream: ReadStream): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream({
    start(controller) {
      fsStream.on('data', (chunk) => {
        if (cancelled) return;
        try {
          controller.enqueue(chunk as Uint8Array);
        } catch {
          cancelled = true;
          fsStream.destroy();
        }
      });
      fsStream.on('end', () => {
        if (cancelled) return;
        try { controller.close(); } catch { /* already closed */ }
      });
      fsStream.on('error', () => {
        if (cancelled) return;
        cancelled = true;
        try { controller.error(); } catch { /* already errored */ }
      });
    },
    cancel() {
      cancelled = true;
      fsStream.destroy();
    },
  });
}

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
    return new Response(fsToWeb(createReadStream(path, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  return new Response(fsToWeb(createReadStream(path)), {
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  });
}
