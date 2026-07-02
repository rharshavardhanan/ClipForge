'use client';

import { useState } from 'react';
import { Badge, Card } from './ui';
import type { ExportJob } from '@/lib/workspace';

export function ExportTab({ jobs }: { jobs: ExportJob[] }) {
  const [copied, setCopied] = useState('');

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(''), 1200);
  };

  if (jobs.length === 0) {
    return <Card><p className="text-sm text-zinc-500">Nothing exported yet.</p></Card>;
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Export locations</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
            <th className="py-2 pr-4">Job</th>
            <th className="py-2 pr-4">Files</th>
            <th className="py-2">Path</th>
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
                    <Badge>srt</Badge>
                    <Badge>json</Badge>
                    {job.hasRanking && <Badge tone="amber">ranking_final.mp4</Badge>}
                  </div>
                </td>
                <td className="py-3">
                  <button
                    onClick={() => copy(path)}
                    className="rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
                    title="Copy path"
                  >
                    {copied === path ? 'copied!' : path}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
