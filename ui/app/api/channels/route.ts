import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { WORKSPACE_DIR } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** Connected YouTube channels (never exposes refresh tokens). */
export async function GET() {
  try {
    const raw = JSON.parse(await readFile(join(WORKSPACE_DIR, '.auth', 'youtube.json'), 'utf8'));
    const channels = Array.isArray(raw?.channels)
      ? raw.channels.map((c: any) => ({ id: c.channel_id, title: c.title }))
      : typeof raw?.refresh_token === 'string'
        ? [{ id: 'default', title: 'default' }]
        : [];
    return NextResponse.json({ channels });
  } catch {
    return NextResponse.json({ channels: [] });
  }
}
