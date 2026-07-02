'use client';

import { useState } from 'react';
import { Badge, Button, Card } from './ui';
import type { ExportJob } from '@/lib/workspace';

function sentimentTone(s?: string): 'zinc' | 'amber' | 'green' | 'red' {
  if (s === 'funny') return 'green';
  if (s === 'serious' || s === 'intense') return 'red';
  return 'zinc';
}

export function ClipsTab({ jobs, onRefresh }: { jobs: ExportJob[]; onRefresh: () => void }) {
  const [open, setOpen] = useState<string | null>(jobs[0]?.id ?? null);

  if (jobs.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">No exports yet — run a video from the Import tab.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" onClick={onRefresh}>Refresh</Button>
      </div>
      {jobs.map((job) => (
        <Card key={job.id}>
          <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === job.id ? null : job.id)}>
            <span className="text-base font-bold">{job.title}</span>
            <Badge>{job.clipCount} clips</Badge>
            {job.hasRanking && <Badge tone="amber">ranking video</Badge>}
            <span className="ml-auto text-xs text-zinc-500">{job.id}</span>
          </button>

          {open === job.id && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {job.clips.map((c) => (
                <div key={c.clipId} className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <video
                    controls
                    preload="metadata"
                    className="aspect-[9/16] w-full rounded-md bg-black"
                    src={`/api/video?job=${encodeURIComponent(job.id)}&file=${encodeURIComponent(c.files.final)}`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="amber">#{c.rank}</Badge>
                    <Badge>score {c.score}</Badge>
                    <Badge>{Math.round(c.duration)}s</Badge>
                    {c.sentiment && <Badge tone={sentimentTone(c.sentiment)}>{c.sentiment}</Badge>}
                    {c.sourceVideo && <Badge>{c.sourceVideo}</Badge>}
                  </div>
                  {c.title && <p className="text-sm font-semibold text-zinc-200">{c.title}</p>}
                  {c.hook && <p className="text-xs italic text-zinc-400">“{c.hook}”</p>}
                  <p className="line-clamp-2 text-xs text-zinc-500">{c.excerpt}</p>
                  <div className="mt-auto flex gap-3 text-xs">
                    <a className="text-amber-300 hover:underline" href={`/api/video?job=${job.id}&file=${c.files.srt}`} download>.srt</a>
                    <a className="text-amber-300 hover:underline" href={`/api/video?job=${job.id}&file=${c.files.json}`} target="_blank">.json</a>
                    <a className="text-amber-300 hover:underline" href={`/api/video?job=${job.id}&file=${c.files.raw}`} download>raw</a>
                  </div>
                </div>
              ))}

              {job.hasRanking && (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-zinc-950/60 p-3">
                  <video
                    controls
                    preload="metadata"
                    className="aspect-[9/16] w-full rounded-md bg-black"
                    src={`/api/video?job=${encodeURIComponent(job.id)}&file=ranking_final.mp4`}
                  />
                  <Badge tone="amber">ranking_final.mp4</Badge>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
