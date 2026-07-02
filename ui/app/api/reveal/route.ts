import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { WORKSPACE_DIR } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** Open an export folder in Finder (macOS) / file manager (Linux). Body: { job }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const raw = typeof body?.job === 'string' ? body.job : '';
  const job = raw.replace(/[^A-Za-z0-9_-]/g, '');
  if (!job || job !== raw) return NextResponse.json({ error: 'invalid job id' }, { status: 400 });

  const dir = join(WORKSPACE_DIR, 'exports', job);
  const exists = await stat(dir).then((s) => s.isDirectory()).catch(() => false);
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref();
  return NextResponse.json({ ok: true });
}
