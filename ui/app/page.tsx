'use client';

import * as Tabs from '@radix-ui/react-tabs';
import { useCallback, useEffect, useState } from 'react';
import type { ExportJob } from '@/lib/workspace';
import { ImportTab } from '@/components/import-tab';
import { ClipsTab } from '@/components/clips-tab';
import { StyleTab, type StyleConfig, DEFAULT_STYLE_CONFIG } from '@/components/style-tab';
import { RankTab } from '@/components/rank-tab';
import { ExportTab } from '@/components/export-tab';

const TABS = ['Import', 'Clips', 'Style', 'Rank', 'Export'] as const;

export default function Home() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [style, setStyle] = useState<StyleConfig>(DEFAULT_STYLE_CONFIG);

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' });
      if (res.ok) setJobs(await res.json());
    } catch {
      // server restarting mid-run — keep the stale list
    }
  }, []);

  useEffect(() => { refreshJobs(); }, [refreshJobs]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-baseline gap-4">
        <h1 className="text-3xl font-black tracking-tight">
          Clip<span className="text-amber-400">Forge</span>
        </h1>
        <p className="text-sm text-zinc-500">local-first AI short-form editor</p>
      </header>

      <Tabs.Root defaultValue="Import">
        <Tabs.List className="mb-6 flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              className="flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-zinc-400 transition-colors hover:text-zinc-200 data-[state=active]:bg-zinc-800 data-[state=active]:text-amber-300"
            >
              {t}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* forceMount keeps tabs mounted when inactive — otherwise Radix unmounts them and
            you lose in-progress state (pasted URLs, live run logs) on every tab switch. */}
        <Tabs.Content value="Import" forceMount className="data-[state=inactive]:hidden"><ImportTab style={style} onFinished={refreshJobs} /></Tabs.Content>
        <Tabs.Content value="Clips" forceMount className="data-[state=inactive]:hidden"><ClipsTab jobs={jobs} onRefresh={refreshJobs} /></Tabs.Content>
        <Tabs.Content value="Style" forceMount className="data-[state=inactive]:hidden"><StyleTab style={style} onChange={setStyle} /></Tabs.Content>
        <Tabs.Content value="Rank" forceMount className="data-[state=inactive]:hidden"><RankTab jobs={jobs} accent={style.accent} onFinished={refreshJobs} /></Tabs.Content>
        <Tabs.Content value="Export" forceMount className="data-[state=inactive]:hidden"><ExportTab jobs={jobs} onChanged={refreshJobs} /></Tabs.Content>
      </Tabs.Root>
    </main>
  );
}
