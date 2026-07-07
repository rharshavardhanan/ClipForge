import { NextRequest } from 'next/server';
import { getRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

/** SSE stream of a run's log lines; closes when the run finishes. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  // Unknown run (e.g. a persisted id reconnecting after the dev server restarted and lost the
  // in-memory registry): emit an immediate `done` so the client clears its saved run id and
  // returns to a runnable state, instead of a 404 that would leave the UI stuck on a dead run.
  if (!run) {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode('event: done\ndata: -1\n\n'));
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } },
    );
  }

  // Hoisted so both start() and cancel() share them: the client can disconnect
  // (tab closed) before the run ends, which fires cancel() — the interval must stop
  // or the next enqueue throws ERR_INVALID_STATE on a closed controller.
  let closed = false;
  let tick: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let sent = 0;
      tick = setInterval(() => {
        if (closed) return;
        try {
          while (sent < run.logs.length) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(run.logs[sent])}\n\n`));
            sent++;
          }
          if (run.done) {
            controller.enqueue(enc.encode(`event: done\ndata: ${run.code}\n\n`));
            closed = true;
            clearInterval(tick);
            controller.close();
          }
        } catch {
          closed = true;
          clearInterval(tick);
        }
      }, 500);
    },
    cancel() {
      closed = true;
      clearInterval(tick);
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
