'use client';

import * as Tabs from '@radix-ui/react-tabs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExportJob } from '@/lib/workspace';
import { Icon } from '@/components/icons';
import { ImportTab } from '@/components/import-tab';
import { ClipsTab } from '@/components/clips-tab';
import { StyleTab, type StyleConfig, DEFAULT_STYLE_CONFIG } from '@/components/style-tab';
import { RankTab } from '@/components/rank-tab';
import { RankRotTab } from '@/components/rankrot-tab';
import { ExportTab } from '@/components/export-tab';

const NAV = [
  { id: 'Import', label: 'Import', sub: 'Add videos and run the pipeline', icon: 'import' },
  { id: 'Clips', label: 'Clips', sub: 'Preview and download your exports', icon: 'clips' },
  { id: 'Style', label: 'Style', sub: 'Caption presets, fonts, music, motion', icon: 'style' },
  { id: 'Rank', label: 'Rank', sub: 'Build #N → #1 countdown videos', icon: 'rank' },
  { id: 'RankRot', label: 'RankRot', sub: 'Topic → internet Top-5 brainrot Short', icon: 'rank' },
  { id: 'Export', label: 'Export', sub: 'Manage exported files on disk', icon: 'export' },
] as const;

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

const PROVIDER_LABEL: Record<string, { text: string; tone: string }> = {
  claude: { text: 'Claude', tone: 'text-gold' },
  gemini: { text: 'Gemini (free)', tone: 'text-green-300' },
  none: { text: 'offline scoring', tone: 'text-zinc-500' },
};

export default function Home() {
  const [tab, setTab] = useState<string>('Import');
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [style, setStyle] = useState<StyleConfig>(DEFAULT_STYLE_CONFIG);
  const [provider, setProvider] = useState<string>('none');

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' });
      if (res.ok) setJobs(await res.json());
    } catch { /* server restarting — keep stale list */ }
  }, []);

  useEffect(() => {
    refreshJobs();
    fetch('/api/status').then((r) => r.json()).then((d) => setProvider(d.provider)).catch(() => {});
  }, [refreshJobs]);

  // Newest export's first clip (RAW — no burned captions) plays behind the Style-tab caption preview.
  const previewSrc = useMemo(() => {
    const withClips = jobs.find((j) => j.clips.length > 0);
    if (!withClips) return null;
    const c = withClips.clips[0];
    return `/api/video?job=${encodeURIComponent(withClips.id)}&file=${encodeURIComponent(c.files.raw)}`;
  }, [jobs]);

  const totalBytes = jobs.reduce((a, j) => a + j.sizeBytes, 0);
  const active = NAV.find((n) => n.id === tab) ?? NAV[0];
  const prov = PROVIDER_LABEL[provider] ?? PROVIDER_LABEL.none;

  return (
    <Tabs.Root value={tab} onValueChange={setTab} orientation="vertical" className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-r border-line bg-ink-900/80 px-4 py-5 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gold text-ink-900 shadow-pop">
            <Icon name="bolt" className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold tracking-tight text-zinc-50">ClipForge</div>
            <div className="text-[11px] font-medium text-zinc-500">local clip studio</div>
          </div>
        </div>

        <Tabs.List className="mt-7 flex flex-col gap-1" aria-label="Sections">
          {NAV.map((n) => (
            <Tabs.Trigger
              key={n.id}
              value={n.id}
              className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 outline-none transition-colors hover:bg-ink-700/70 hover:text-zinc-100 data-[state=active]:bg-gold-soft data-[state=active]:text-gold"
            >
              <Icon name={n.icon} className="h-[18px] w-[18px] opacity-90" />
              {n.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="mt-auto space-y-2 border-t border-line pt-4">
          <div className="flex items-center justify-between px-2 text-xs">
            <span className="text-zinc-500">AI scoring</span>
            <span className={`font-semibold ${prov.tone}`}>{prov.text}</span>
          </div>
          <div className="flex items-center justify-between px-2 text-xs">
            <span className="text-zinc-500">On disk</span>
            <span className="font-mono text-zinc-400">{fmtBytes(totalBytes)}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-ink-900/70 px-8 py-5 backdrop-blur-xl">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-50">{active.label}</h1>
            <p className="text-sm text-zinc-500">{active.sub}</p>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-line bg-ink-800/70 px-3 py-1.5 text-xs text-zinc-400 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_8px_2px_rgba(74,222,128,0.5)]" />
            running locally
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-8">
          {/* forceMount keeps tabs mounted so in-progress state (pasted URLs, live logs) survives switching. */}
          <Tabs.Content value="Import" forceMount className="animate-fade-up outline-none data-[state=inactive]:hidden"><ImportTab style={style} onFinished={refreshJobs} /></Tabs.Content>
          <Tabs.Content value="Clips" forceMount className="animate-fade-up outline-none data-[state=inactive]:hidden"><ClipsTab jobs={jobs} onRefresh={refreshJobs} /></Tabs.Content>
          <Tabs.Content value="Style" forceMount className="animate-fade-up outline-none data-[state=inactive]:hidden"><StyleTab style={style} onChange={setStyle} previewSrc={previewSrc} /></Tabs.Content>
          <Tabs.Content value="Rank" forceMount className="animate-fade-up outline-none data-[state=inactive]:hidden"><RankTab jobs={jobs} accent={style.accent} onFinished={refreshJobs} /></Tabs.Content>
          <Tabs.Content value="RankRot" forceMount className="animate-fade-up outline-none data-[state=inactive]:hidden"><RankRotTab accent={style.accent} /></Tabs.Content>
          <Tabs.Content value="Export" forceMount className="animate-fade-up outline-none data-[state=inactive]:hidden"><ExportTab jobs={jobs} onChanged={refreshJobs} /></Tabs.Content>
        </main>
      </div>
    </Tabs.Root>
  );
}
