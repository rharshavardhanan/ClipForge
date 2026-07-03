'use client';

import { useRef, useState } from 'react';
import { Button, Card, Field, SectionHead, Stepper, inputCls } from './ui';
import { Icon } from './icons';
import { RunLog } from './run-log';
import type { StyleConfig } from './style-tab';

export function ImportTab({ style, onFinished }: { style: StyleConfig; onFinished: () => void }) {
  const [inputsText, setInputsText] = useState('');
  const [top, setTop] = useState(3);
  const [mode, setMode] = useState('auto');
  const [framing, setFraming] = useState('auto');
  const [broll, setBroll] = useState('auto');
  const [ranking, setRanking] = useState(false);
  const [deleteSource, setDeleteSource] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const inputs = inputsText.split('\n').map((l) => l.trim()).filter(Boolean);

  const uploadFiles = async (files: FileList | File[]) => {
    setError('');
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try {
        const res = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'upload failed');
        setInputsText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${body.path}` : body.path));
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploading('');
  };

  const start = async () => {
    setError('');
    setStarting(true);
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs, top, mode,
          framing: framing === 'auto' ? undefined : framing,
          broll: broll === 'auto' ? undefined : broll === 'on',
          style: style.preset, accent: style.accent, music: style.music, zooms: style.zooms,
          font: style.font, fontSize: style.fontSize, position: style.position,
          stroke: style.stroke, captionColor: style.captionColor,
          ranking, deleteSource,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed to start');
      setRunId(body.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const canRun = inputs.length > 0 && !starting && !(runId !== null && !error);

  return (
    <div className="flex flex-col gap-5">
      <Card accent>
        <SectionHead
          title="Import & run"
          subtitle="One input per line — YouTube URLs and/or local files. Two or more lines run as a cross-ranked batch."
        />

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); }}
          className="relative"
        >
          <textarea
            value={inputsText}
            onChange={(e) => setInputsText(e.target.value)}
            placeholder={'https://www.youtube.com/watch?v=…\n/path/to/local/video.mp4\n\n…or drag a video file anywhere in this box'}
            rows={5}
            className={`${inputCls} w-full resize-y font-mono leading-relaxed`}
          />
          {inputs.length > 0 && (
            <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-ink-600 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
              {inputs.length} input{inputs.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <input
            ref={fileRef} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" multiple hidden
            onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ''; }}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={Boolean(uploading)}>
            <Icon name="upload" className="h-4 w-4" /> Add local video
          </Button>
          {uploading && <span className="animate-pulse text-xs text-gold">Uploading {uploading}…</span>}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end gap-6">
          <Field label="Max clips" hint="Best moments to export">
            <Stepper value={top} onChange={setTop} min={1} max={20} />
          </Field>

          <Field label="Mode" hint="Editing grammar per video">
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
              <option value="auto">Auto-detect</option>
              <option value="clippies">Clippies — high-energy</option>
              <option value="mindcuts">MindCuts — story-first</option>
            </select>
          </Field>

          <Field label="Framing" hint="Full-screen or blurred bars">
            <select value={framing} onChange={(e) => setFraming(e.target.value)} className={inputCls}>
              <option value="auto">Auto per clip</option>
              <option value="crop">Full-screen 9:16 — follows the speaker</option>
              <option value="blur">Blurred backdrop (16:9 kept whole)</option>
            </select>
          </Field>

          <Field label="B-roll" hint="Contextual narrative overlays">
            <select value={broll} onChange={(e) => setBroll(e.target.value)} className={inputCls}>
              <option value="auto">Mode default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Field>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-sm text-zinc-200 transition-colors hover:border-zinc-600" title="Counts down the exported clips #N → #1 in one video — works for a single source too.">
            <input type="checkbox" checked={ranking} onChange={(e) => setRanking(e.target.checked)} className="h-4 w-4 accent-gold" />
            Render #N → #1 ranking video
          </label>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-sm text-zinc-200 transition-colors hover:border-zinc-600" title="Removes the multi-GB source download and intermediate extracts once clips are exported.">
            <input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} className="h-4 w-4 accent-gold" />
            Delete source after export
          </label>

          <div className="ml-auto flex items-center gap-4">
            <div className="text-right text-xs text-zinc-500">
              <div>preset <span className="font-semibold text-gold">{style.preset}</span></div>
              <div>music {style.music ? 'auto' : 'off'} · zooms {style.zooms ? 'on' : 'off'}</div>
            </div>
            <Button onClick={start} disabled={!canRun}>
              <Icon name="play" className="h-4 w-4" />
              {starting ? 'Starting…' : 'Run pipeline'}
            </Button>
          </div>
        </div>

        {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">{error}</p>}
        {runId && <RunLog runId={runId} onDone={() => { setRunId(null); onFinished(); }} />}
      </Card>
    </div>
  );
}
