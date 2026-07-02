'use client';

import { useEffect, useRef, useState } from 'react';

/** Live log pane for a run id: consumes the SSE stream until the run finishes. */
export function RunLog({ runId, onDone }: { runId: string; onDone?: (code: number) => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    setLines([]);
    setDone(null);
    const es = new EventSource(`/api/run/${runId}/stream`);
    es.onmessage = (e) => setLines((prev) => [...prev, JSON.parse(e.data)]);
    es.addEventListener('done', (e) => {
      const code = Number((e as MessageEvent).data);
      setDone(code);
      es.close();
      onDoneRef.current?.(code);
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [lines]);

  return (
    <div
      ref={boxRef}
      className="mt-4 h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-5 text-zinc-300"
    >
      {lines.map((l, i) => <div key={i}>{l}</div>)}
      {done !== null && (
        <div className={done === 0 ? 'text-green-400' : 'text-red-400'}>
          {done === 0 ? 'Done.' : `Exited with code ${done}.`}
        </div>
      )}
    </div>
  );
}
