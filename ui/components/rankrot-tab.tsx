'use client';

import { useState } from 'react';
import { Button, Card, Field, SectionHead, inputCls } from './ui';
import { Icon } from './icons';
import { RunLog } from './run-log';

const EXAMPLES = ['best basketball dunks', 'craziest ankle breakers', 'funniest football fails', 'best streamer rage moments'];

export function RankRotTab({ accent }: { accent: string }) {
  const [topic, setTopic] = useState('');
  const [top, setTop] = useState(5);
  const [runId, setRunId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [doneSlug, setDoneSlug] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setError('');
    setDoneSlug(null);
    setStarting(true);
    try {
      const res = await fetch('/api/rankrot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, top, accent }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed to start');
      setRunId(body.id);
      setSlug(body.slug);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card accent>
        <SectionHead
          title="RankRot — Top-N countdown from the internet"
          subtitle="Type a topic. The engine searches YouTube, harvests the clips, isolates each one's strongest 3-8s, ranks them (motion + audio + reaction + Gemini + novelty), and renders a 5→1 brainrot countdown Short."
        />
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-72 flex-1">
            <Field label="Topic" hint='e.g. "best basketball dunks"'>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && topic.trim().length >= 3) start(); }}
                placeholder="best basketball dunks"
                className={`${inputCls} w-full`}
              />
            </Field>
          </div>
          <Field label="Countdown size">
            <select className={inputCls} value={String(top)} onChange={(e) => setTop(parseInt(e.target.value, 10))}>
              {[3, 5, 7].map((n) => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </Field>
          <Button onClick={start} disabled={topic.trim().length < 3 || starting || (runId !== null && doneSlug === null && !error)}>
            <Icon name="rank" className="h-4 w-4" />
            {starting ? 'Starting…' : 'Build ranking'}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setTopic(ex)} className="rounded-full border border-line px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200">
              {ex}
            </button>
          ))}
        </div>
        {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">{error}</p>}
        {runId && <RunLog runId={runId} onDone={(code) => { if (code === 0) setDoneSlug(slug); setRunId(null); }} />}
      </Card>

      {doneSlug && (
        <Card>
          <SectionHead title="Result" subtitle={`workspace/exports/${doneSlug}/ — ranking_final.mp4 + title/description/hashtags + thumbnail`} />
          <div className="flex flex-wrap items-start gap-6">
            <video
              key={doneSlug}
              src={`/api/video?job=${encodeURIComponent(doneSlug)}&file=ranking_final.mp4`}
              controls
              className="h-[480px] w-[270px] rounded-2xl border border-line bg-black object-contain"
            />
            <div className="flex flex-col gap-2 text-sm">
              {['title.txt', 'description.txt', 'hashtags.txt', 'thumbnail.png', 'rankrot_manifest.json'].map((f) => (
                <a key={f} className="font-mono text-zinc-400 hover:text-gold" href={`/api/video?job=${encodeURIComponent(doneSlug)}&file=${f}`} download>
                  {f}
                </a>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
