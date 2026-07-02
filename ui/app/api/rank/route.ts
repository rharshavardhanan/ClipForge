import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { startRun } from '@/lib/runs';
import { WORKSPACE_DIR } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** Render a ranking video for an existing export. Body: { job: string, accent?: string }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const job = typeof body?.job === 'string' ? body.job.replace(/[^A-Za-z0-9_-]/g, '') : '';
  if (!job) return NextResponse.json({ error: 'job required' }, { status: 400 });

  const args = ['rank', join(WORKSPACE_DIR, 'exports', job)];
  if (typeof body.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent)) args.push('--accent', body.accent);

  const run = startRun(args);
  return NextResponse.json({ id: run.id });
}
