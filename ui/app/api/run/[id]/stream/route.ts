import { NextRequest } from 'next/server';
import { getRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

/** SSE stream of a run's log lines; closes when the run finishes. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) return new Response('unknown run', { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let sent = 0;
      const tick = setInterval(() => {
        while (sent < run.logs.length) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(run.logs[sent])}\n\n`));
          sent++;
        }
        if (run.done) {
          controller.enqueue(enc.encode(`event: done\ndata: ${run.code}\n\n`));
          clearInterval(tick);
          controller.close();
        }
      }, 500);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
