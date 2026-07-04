'use client';

import { useState } from 'react';
import { Button, Card, Field, SectionHead, Stepper, inputCls } from './ui';
import { Icon } from './icons';
import { RunLog } from './run-log';

export function MontageTab() {
  const [inputsText, setInputsText] = useState('');
  const [music, setMusic] = useState('');
  const [duration, setDuration] = useState(25);
  const [counters, setCounters] = useState(true);
  const [payoffImage, setPayoffImage] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [doneSlug, setDoneSlug] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const inputs = inputsText.split('\n').map((s) => s.trim()).filter(Boolean);

  const start = async () => {
    setError('');
    setDoneSlug(null);
    setStarting(true);
    try {
      const res = await fetch('/api/montage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, music, duration, counters, payoffImage }),
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
          title="Montage — video + music → beat-synced edit"
          subtitle="Paste one or more video URLs or local file paths (one per line). The engine harvests each video's hardest moments, syncs the cuts to the music's beat grid and drops, and renders one montagem Short."
        />
        <div className="flex flex-col gap-4">
          <Field label="Videos" hint="One URL or local file path per line">
            <textarea
              value={inputsText}
              onChange={(e) => setInputsText(e.target.value)}
              placeholder={'https://youtube.com/watch?v=...\n./footage/clip2.mp4'}
              rows={4}
              className={`${inputCls} w-full resize-y font-mono text-xs`}
            />
          </Field>

          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-72 flex-1">
              <Field label="Music track (optional)" hint="Leave blank to auto-pick from ./music/montagem/">
                <input
                  value={music}
                  onChange={(e) => setMusic(e.target.value)}
                  placeholder="./music/montagem/track.mp3"
                  className={`${inputCls} w-full`}
                />
              </Field>
            </div>
            <Field label="Duration" hint="15-45s">
              <Stepper value={duration} onChange={setDuration} min={15} max={45} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3">
            <label
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-sm text-zinc-200 transition-colors hover:border-zinc-600"
              title="Overlays a rep/cycle counter when a moment has confidently-labeled repeated motion."
            >
              <input type="checkbox" checked={counters} onChange={(e) => setCounters(e.target.checked)} className="h-4 w-4 accent-gold" />
              Counter overlay
            </label>
            <label
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-sm text-zinc-200 transition-colors hover:border-zinc-600"
              title="Generates an AI-stylized freeze frame for the payoff moment (falls back to the real frame when unavailable)."
            >
              <input type="checkbox" checked={payoffImage} onChange={(e) => setPayoffImage(e.target.checked)} className="h-4 w-4 accent-gold" />
              AI payoff frame
            </label>

            <Button
              className="ml-auto"
              onClick={start}
              disabled={inputs.length === 0 || starting || (runId !== null && doneSlug === null && !error)}
            >
              <Icon name="rank" className="h-4 w-4" />
              {starting ? 'Starting…' : 'Build montage'}
            </Button>
          </div>
        </div>

        {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">{error}</p>}
        {runId && <RunLog runId={runId} onDone={(code) => { if (code === 0) setDoneSlug(slug); setRunId(null); }} />}
      </Card>

      {doneSlug && (
        <Card>
          <SectionHead title="Result" subtitle={`workspace/exports/${doneSlug}/ — montage_final.mp4 + title/description/hashtags + thumbnail`} />
          <div className="flex flex-wrap items-start gap-6">
            <video
              key={doneSlug}
              src={`/api/video?job=${encodeURIComponent(doneSlug)}&file=montage_final.mp4`}
              controls
              className="h-[480px] w-[270px] rounded-2xl border border-line bg-black object-contain"
            />
            <div className="flex flex-col gap-2 text-sm">
              {['title.txt', 'description.txt', 'hashtags.txt', 'thumbnail.png', 'montage_manifest.json'].map((f) => (
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
