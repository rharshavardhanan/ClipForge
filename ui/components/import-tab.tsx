'use client';

import { useRef, useState } from 'react';
import { Button, Card, Field, Stepper, inputCls } from './ui';
import { RunLog } from './run-log';
import type { StyleConfig } from './style-tab';

export function ImportTab({ style, onFinished }: { style: StyleConfig; onFinished: () => void }) {
  const [inputsText, setInputsText] = useState('');
  const [top, setTop] = useState(3);
  const [ranking, setRanking] = useState(false);
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
          inputs, top,
          style: style.preset, accent: style.accent, music: style.music, zooms: style.zooms,
          font: style.font, fontSize: style.fontSize, position: style.position,
          stroke: style.stroke, captionColor: style.captionColor,
          ranking,
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

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Import &amp; run</h2>
      <p className="mb-4 text-sm text-zinc-500">
        One input per line: YouTube URLs and/or local video file paths. Multiple lines run as a cross-ranked batch.
      </p>

      <textarea
        value={inputsText}
        onChange={(e) => setInputsText(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
        placeholder={'https://www.youtube.com/watch?v=…\n/path/to/local/video.mp4   (or drag a video file here)'}
        rows={4}
        className={`${inputCls} w-full font-mono`}
      />
      <div className="mt-2 flex items-center gap-3">
        <input
          ref={fileRef} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" multiple hidden
          onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ''; }}
        />
        <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => fileRef.current?.click()} disabled={Boolean(uploading)}>
          + Add local video
        </Button>
        {uploading && <span className="text-xs text-amber-300">Uploading {uploading}…</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <Field label="Max clips">
          <Stepper value={top} onChange={setTop} min={1} max={20} />
        </Field>
        <label className={`flex items-center gap-2 text-sm ${inputs.length > 1 ? 'text-zinc-300' : 'text-zinc-600'}`}>
          <input type="checkbox" checked={ranking} disabled={inputs.length < 2} onChange={(e) => setRanking(e.target.checked)} className="accent-amber-400" />
          Render #N→#1 ranking video (batch only)
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            preset <span className="text-amber-300">{style.preset}</span> · music {style.music ? 'auto' : 'off'} · zooms {style.zooms ? 'on' : 'off'}
          </span>
          <Button onClick={start} disabled={inputs.length === 0 || starting || (runId !== null && !error)}>
            {starting ? 'Starting…' : 'Run pipeline'}
          </Button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {runId && <RunLog runId={runId} onDone={() => { setRunId(null); onFinished(); }} />}
    </Card>
  );
}
