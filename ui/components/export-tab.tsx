'use client';

import { useState } from 'react';
import { Badge, Button, Card } from './ui';
import type { ExportJob } from '@/lib/workspace';

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function ExportTab({ jobs, onChanged }: { jobs: ExportJob[]; onChanged: () => void }) {
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState('');

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(''), 1200);
  };

  const reveal = async (job: string) => {
    await fetch('/api/reveal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job }),
    });
  };

  const remove = async (job: string, title: string) => {
    if (!window.confirm(`Delete export "${title}" (${job})?\nThis removes the clips from disk and cannot be undone.`)) return;
    setBusy(job);
    await fetch(`/api/jobs?job=${encodeURIComponent(job)}`, { method: 'DELETE' });
    setBusy('');
    onChanged();
  };

  if (jobs.length === 0) {
    return <Card><p className="text-sm text-zinc-500">Nothing exported yet.</p></Card>;
  }

  const total = jobs.reduce((a, j) => a + j.sizeBytes, 0);

  return (
    <Card>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-lg font-bold">Export locations</h2>
        <span className="text-xs text-zinc-500">{jobs.length} exports · {formatBytes(total)} on disk</span>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
            <th className="py-2 pr-4">Job</th>
            <th className="py-2 pr-4">Files</th>
            <th className="py-2 pr-4">Path</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const path = `workspace/exports/${job.id}`;
            return (
              <tr key={job.id} className="border-b border-zinc-900 align-top">
                <td className="py-3 pr-4">
                  <div className="font-semibold">{job.title}</div>
                  <div className="text-xs text-zinc-500">{job.processedAt}</div>
                </td>
                <td className="py-3 pr-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{job.clipCount}× final.mp4</Badge>
                    <Badge tone="amber">{formatBytes(job.sizeBytes)}</Badge>
                    {job.hasRanking && <Badge tone="green">ranking_final.mp4</Badge>}
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <button
                    onClick={() => copy(path)}
                    className="rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
                    title="Copy path"
                  >
                    {copied === path ? 'copied!' : path}
                  </button>
                </td>
                <td className="py-3">
                  <div className="flex gap-2">
                    <Button variant="outline" className="!px-3 !py-1 text-xs" onClick={() => reveal(job.id)}>
                      Reveal in Finder
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-3 !py-1 text-xs !text-red-400 hover:!bg-red-950/40"
                      disabled={busy === job.id}
                      onClick={() => remove(job.id, job.title)}
                    >
                      {busy === job.id ? 'Deleting…' : 'Delete'}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
