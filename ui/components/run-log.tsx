'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Ordered pipeline stages → rough progress %. Matched case-insensitively against the log lines;
 * progress is monotonic (we take the furthest stage any line has reached), so the bar never jumps
 * backward. This is a heuristic, not exact instrumentation — its job is to show the run is alive
 * and roughly where it is, especially during long silent phases (transcript, rendering).
 */
const STAGES: { re: RegExp; label: string; pct: number }[] = [
  { re: /ingest|downloading|reusing cached download/i, label: 'Downloading source', pct: 10 },
  { re: /downloaded:/i, label: 'Source ready', pct: 20 },
  { re: /transcript/i, label: 'Transcribing', pct: 30 },
  { re: /perception/i, label: 'Perceiving (audio + scenes)', pct: 36 },
  { re: /triggers|analysis done|audio energy/i, label: 'Analyzing audio', pct: 44 },
  { re: /semantic/i, label: 'Scoring semantics', pct: 54 },
  { re: /detecting clips|found \d+ candidate/i, label: 'Detecting clips', pct: 64 },
  { re: /mining|arc/i, label: 'Building story arcs', pct: 70 },
  { re: /extract|caption/i, label: 'Extracting + captions', pct: 80 },
  { re: /render|remotion/i, label: 'Rendering video', pct: 90 },
  { re: /export complete|run complete/i, label: 'Exporting', pct: 97 },
];

function stageFor(lines: string[]): { label: string; pct: number } {
  let best = -1;
  for (const l of lines) {
    for (let i = STAGES.length - 1; i > best; i--) {
      if (STAGES[i].re.test(l)) { best = i; break; }
    }
  }
  if (best < 0) return { label: 'Starting…', pct: 4 };
  return { label: STAGES[best].label, pct: STAGES[best].pct };
}

/** Live log pane + progress bar for a run id: consumes the SSE stream until the run finishes. */
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

  const running = done === null;
  const stage = useMemo(() => stageFor(lines), [lines]);
  const pct = running ? stage.pct : done === 0 ? 100 : stage.pct;
  const label = running ? stage.label : done === 0 ? 'Done' : `Failed (exit ${done})`;
  const labelColor = running ? 'text-gold' : done === 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="mt-4">
      {/* Progress / loading bar — always visible so a run never looks frozen. */}
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className={`flex items-center gap-2 ${labelColor}`}>
          {running && <span className="h-2 w-2 animate-pulse rounded-full bg-gold" aria-hidden />}
          {label}
        </span>
        <span className="tabular-nums text-zinc-500">{Math.round(pct)}%</span>
      </div>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink-600"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${running || done === 0 ? 'bg-gold' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
        {/* Sliding highlight over the filled portion — shows activity during long silent stages. */}
        {running && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] bg-[length:200%_100%] animate-shimmer"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      {/* Full log pane. */}
      <div
        ref={boxRef}
        className="mt-3 h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-5 text-zinc-300"
      >
        {lines.map((l, i) => <div key={i}>{l}</div>)}
        {done !== null && (
          <div className={done === 0 ? 'text-green-400' : 'text-red-400'}>
            {done === 0 ? 'Done.' : `Exited with code ${done}.`}
          </div>
        )}
      </div>
    </div>
  );
}
