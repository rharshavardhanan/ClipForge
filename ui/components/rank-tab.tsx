'use client';

import { useState } from 'react';
import { Badge, Button, Card } from './ui';
import { RunLog } from './run-log';
import type { ExportJob } from '@/lib/workspace';

export function RankTab({ jobs, accent, onFinished }: { jobs: ExportJob[]; accent: string; onFinished: () => void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const candidates = jobs.filter((j) => j.clipCount >= 2);

  const render = async (jobId: string) => {
    setBusyJob(jobId);
    const res = await fetch('/api/rank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: jobId, accent }),
    });
    const body = await res.json();
    if (res.ok) setRunId(body.id);
    else setBusyJob(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-1 text-lg font-bold">Ranking videos</h2>
        <p className="text-sm text-zinc-500">
          Stitch an export&apos;s clips into one #N→#1 countdown video with rank cards and badges. Clips play worst-to-best.
        </p>
      </Card>

      {candidates.length === 0 && (
        <Card><p className="text-sm text-zinc-500">No exports with 2+ clips yet.</p></Card>
      )}

      {candidates.map((job) => (
        <Card key={job.id}>
          <div className="flex items-center gap-3">
            <span className="font-bold">{job.title}</span>
            <Badge>{job.clipCount} clips</Badge>
            {job.hasRanking && <Badge tone="green">rendered</Badge>}
            <div className="ml-auto">
              <Button
                variant={job.hasRanking ? 'outline' : 'default'}
                disabled={busyJob !== null}
                onClick={() => render(job.id)}
              >
                {job.hasRanking ? 'Re-render' : 'Render ranking video'}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...job.clips].sort((a, b) => b.rank - a.rank).map((c) => (
              <Badge key={c.clipId} tone="zinc">#{c.rank} · {c.title || c.clipId} · {c.score}</Badge>
            ))}
          </div>
          {busyJob === job.id && runId && (
            <RunLog runId={runId} onDone={() => { setRunId(null); setBusyJob(null); onFinished(); }} />
          )}
        </Card>
      ))}
    </div>
  );
}
