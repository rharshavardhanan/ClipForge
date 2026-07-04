'use client';

import { useState } from 'react';
import { Badge, Button, Card, Field, inputCls } from './ui';
import { Icon } from './icons';
import type { ExportJob } from '@/lib/workspace';

function sentimentTone(s?: string): 'zinc' | 'gold' | 'green' | 'red' {
  if (s === 'funny') return 'green';
  if (s === 'serious' || s === 'intense') return 'red';
  return 'zinc';
}

interface Channel { id: string; title: string; }

interface PublishState {
  job: string; clip: string; title: string; description: string; privacy: string;
  channels: Channel[]; channel: string;
  busy: boolean; result?: string; error?: string;
}

export function ClipsTab({ jobs, onRefresh }: { jobs: ExportJob[]; onRefresh: () => void }) {
  const [open, setOpen] = useState<string | null>(jobs[0]?.id ?? null);
  const [pub, setPub] = useState<PublishState | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function openPublish(jobId: string, c: ExportJob['clips'][number]) {
    let seo: { title?: string; description?: string } = {};
    let channels: Channel[] = [];
    try {
      const [clipRes, chRes] = await Promise.all([
        fetch(`/api/video?job=${encodeURIComponent(jobId)}&file=${encodeURIComponent(c.files.json)}`),
        fetch('/api/channels'),
      ]);
      seo = (await clipRes.json())?.seo ?? {};
      channels = (await chRes.json())?.channels ?? [];
    } catch { /* dialog still opens with fallbacks */ }
    setPub({
      job: jobId, clip: c.clipId, privacy: 'public', busy: false,
      channels, channel: channels[0]?.id ?? '',
      title: seo.title ?? c.title ?? c.clipId, description: seo.description ?? '',
    });
  }

  async function copyCaption(jobId: string, clipId: string) {
    const r = await fetch(`/api/video?job=${encodeURIComponent(jobId)}&file=${encodeURIComponent(`${clipId}_description.txt`)}`);
    await navigator.clipboard.writeText(await r.text());
    setCopied(`${jobId}/${clipId}`);
    setTimeout(() => setCopied(null), 1500);
  }

  async function doPublish() {
    if (!pub || pub.busy) return;
    setPub({ ...pub, busy: true, error: undefined, result: undefined });
    try {
      const r = await fetch('/api/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: pub.job, clip: pub.clip, title: pub.title, description: pub.description, privacy: pub.privacy, channel: pub.channel }),
      });
      const j = await r.json();
      if (j.ok) {
        setPub({ ...pub, busy: false, result: j.result.locked
          ? `Uploaded — YouTube locked it private (unverified Cloud app). Publish it in Studio: ${j.result.url}`
          : `Live (${j.result.privacyStatus}): ${j.result.url}` });
      } else {
        setPub({ ...pub, busy: false, error: j.error ?? 'upload failed' });
      }
    } catch (e) {
      setPub({ ...pub, busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

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
              {job.belowRetentionCount > 0 && (
                <Badge tone="red">+{job.belowRetentionCount} below retention floor</Badge>
              )}
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
                      {c.predictedRetention !== undefined && (
                        <Badge tone={c.belowRetentionFloor ? 'red' : 'zinc'}>~{Math.round(c.predictedRetention * 100)}% ret</Badge>
                      )}
                      {c.belowRetentionFloor && <Badge tone="red">below floor</Badge>}
                      {c.arcComplete !== undefined && <Badge tone={c.arcComplete ? 'green' : 'amber'}>{c.arcComplete ? 'story ✓' : 'partial'}</Badge>}
                    </div>
                    {c.title && <p className="text-sm font-semibold leading-snug text-zinc-100">{c.title}</p>}
                    {c.hook && <p className="line-clamp-2 text-xs italic text-zinc-400">“{c.hook}”</p>}
                    <div className="mt-auto flex flex-wrap gap-3 pt-1 text-xs">
                      <a className="font-medium text-zinc-400 hover:text-gold" href={`/api/video?job=${job.id}&file=${c.files.srt}`} download>.srt</a>
                      <a className="font-medium text-zinc-400 hover:text-gold" href={`/api/video?job=${job.id}&file=${c.files.json}`} target="_blank">.json</a>
                      <a className="font-medium text-zinc-400 hover:text-gold" href={`/api/video?job=${job.id}&file=${c.files.raw}`} download>raw</a>
                      {c.belowRetentionFloor ? (
                        <span className="text-zinc-600" title="Below the retention floor — the CLI upload command only reads the top exports tier. Re-run with a lower --min-retention to promote it, or upload manually.">▶ YouTube (n/a)</span>
                      ) : (
                        <button className="font-semibold text-zinc-300 hover:text-gold" onClick={() => openPublish(job.id, c)}>▶ YouTube</button>
                      )}
                      <button className="font-medium text-zinc-400 hover:text-gold" onClick={() => copyCaption(job.id, c.clipId)}>
                        {copied === `${job.id}/${c.clipId}` ? '✓ copied' : 'IG caption'}
                      </button>
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

      {pub && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => !pub.busy && setPub(null)}>
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <Card className="flex flex-col gap-4">
              <p className="font-display text-base font-semibold text-zinc-100">Upload {pub.clip} to YouTube</p>
              <Field label="Title" hint={`${pub.title.length}/100`}>
                <input className={inputCls} value={pub.title} maxLength={100}
                  onChange={(e) => setPub({ ...pub, title: e.target.value })} />
              </Field>
              <Field label="Description">
                <textarea className={`${inputCls} h-32 resize-y`} value={pub.description}
                  onChange={(e) => setPub({ ...pub, description: e.target.value })} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                {pub.channels.length > 0 ? (
                  <Field label="Channel">
                    <select className={inputCls} value={pub.channel} disabled={pub.busy}
                      onChange={(e) => setPub({ ...pub, channel: e.target.value })}>
                      {pub.channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.title}</option>)}
                    </select>
                  </Field>
                ) : (
                  <span className="text-xs text-amber-400">No channel connected — run `./start.sh auth youtube`</span>
                )}
                <select className={inputCls} value={pub.privacy} disabled={pub.busy}
                  onChange={(e) => setPub({ ...pub, privacy: e.target.value })}>
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </select>
                <Badge>Not made for kids</Badge>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPub(null)} disabled={pub.busy}>Close</Button>
                  <Button size="sm" onClick={doPublish} disabled={pub.busy || !pub.title.trim()}>
                    {pub.busy ? 'Uploading…' : 'Upload'}
                  </Button>
                </div>
              </div>
              {pub.result && <p className="break-all text-xs text-green-400">{pub.result}</p>}
              {pub.error && (
                <p className="break-all text-xs text-red-400">
                  {pub.error}
                  {/auth|YT_CLIENT/i.test(pub.error) ? ' — set YT_CLIENT_ID/SECRET in .env, then run `./start.sh auth youtube` in a terminal.' : ''}
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
