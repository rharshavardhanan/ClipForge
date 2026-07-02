'use client';

import { useState } from 'react';
import { Badge, Button, Card } from './ui';
import { Icon } from './icons';
import type { ExportJob } from '@/lib/workspace';

function sentimentTone(s?: string): 'zinc' | 'gold' | 'green' | 'red' {
  if (s === 'funny') return 'green';
  if (s === 'serious' || s === 'intense') return 'red';
  return 'zinc';
}

export function ClipsTab({ jobs, onRefresh }: { jobs: ExportJob[]; onRefresh: () => void }) {
  const [open, setOpen] = useState<string | null>(jobs[0]?.id ?? null);

  if (jobs.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-700 text-zinc-500">
          <Icon name="clips" className="h-7 w-7" />
        </div>
        <p className="text-sm text-zinc-400">No exports yet.</p>
        <p className="text-xs text-zinc-600">Head to <span className="font-semibold text-gold">Import</span> and run a video to see clips here.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onRefresh}><Icon name="refresh" className="h-4 w-4" /> Refresh</Button>
      </div>

      {jobs.map((job) => {
        const isOpen = open === job.id;
        return (
          <Card key={job.id} className="!p-0 overflow-hidden">
            <button
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-ink-700/40"
              onClick={() => setOpen(isOpen ? null : job.id)}
            >
              <Icon name="clips" className="h-5 w-5 shrink-0 text-zinc-500" />
              <span className="truncate font-display text-base font-semibold text-zinc-100">{job.title}</span>
              <Badge>{job.clipCount} clips</Badge>
              {job.hasRanking && <Badge tone="gold">ranking</Badge>}
              <span className="ml-auto font-mono text-xs text-zinc-600">{job.id}</span>
              <Icon name="import" className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="grid grid-cols-1 gap-4 border-t border-line p-5 sm:grid-cols-2 lg:grid-cols-3">
                {job.clips.map((c) => (
                  <div key={c.clipId} className="group flex flex-col gap-2.5 rounded-xl border border-line bg-ink-900/50 p-3 transition-colors hover:border-zinc-700">
                    <div className="overflow-hidden rounded-lg bg-black">
                      <video
                        controls preload="metadata"
                        className="aspect-[9/16] w-full"
                        src={`/api/video?job=${encodeURIComponent(job.id)}&file=${encodeURIComponent(c.files.final)}`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="gold">#{c.rank}</Badge>
                      <Badge>{c.score.toFixed(1)}</Badge>
                      <Badge>{Math.round(c.duration)}s</Badge>
                      {c.sentiment && <Badge tone={sentimentTone(c.sentiment)}>{c.sentiment}</Badge>}
                    </div>
                    {c.title && <p className="text-sm font-semibold leading-snug text-zinc-100">{c.title}</p>}
                    {c.hook && <p className="line-clamp-2 text-xs italic text-zinc-400">“{c.hook}”</p>}
                    <div className="mt-auto flex gap-3 pt-1 text-xs">
                      <a className="font-medium text-zinc-400 hover:text-gold" href={`/api/video?job=${job.id}&file=${c.files.srt}`} download>.srt</a>
                      <a className="font-medium text-zinc-400 hover:text-gold" href={`/api/video?job=${job.id}&file=${c.files.json}`} target="_blank">.json</a>
                      <a className="font-medium text-zinc-400 hover:text-gold" href={`/api/video?job=${job.id}&file=${c.files.raw}`} download>raw</a>
                    </div>
                  </div>
                ))}

                {job.hasRanking && (
                  <div className="flex flex-col gap-2.5 rounded-xl border border-gold/40 bg-gold-soft/40 p-3">
                    <div className="overflow-hidden rounded-lg bg-black">
                      <video
                        controls preload="metadata"
                        className="aspect-[9/16] w-full"
                        src={`/api/video?job=${encodeURIComponent(job.id)}&file=ranking_final.mp4`}
                      />
                    </div>
                    <Badge tone="gold">ranking_final.mp4</Badge>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
