import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { REPO_ROOT, WORKSPACE_DIR } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
const pexec = promisify(execFile);
const ID = /^[A-Za-z0-9_-]+$/;

/**
 * Upload one clip to YouTube via the CLI (`upload --json`).
 * Body: { job, clip, title?, description?, privacy? } → { ok, result: { url, privacyStatus, locked } }.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const job = typeof b?.job === 'string' && ID.test(b.job) ? b.job : '';
  const clip = typeof b?.clip === 'string' && ID.test(b.clip) ? b.clip : '';
  if (!job || !clip) return NextResponse.json({ error: 'invalid job/clip' }, { status: 400 });
  const privacy = ['public', 'unlisted', 'private'].includes(b.privacy) ? b.privacy : 'public';

  const args = ['dist/cli/index.js', 'upload', join(WORKSPACE_DIR, 'exports', job),
    '--clips', clip, '--privacy', privacy, '--json', '--force'];
  if (typeof b.channel === 'string' && b.channel.trim()) args.push('--channel', b.channel.trim());
  if (typeof b.title === 'string' && b.title.trim()) args.push('--title', b.title.trim());
  if (typeof b.description === 'string' && b.description.trim()) args.push('--description', b.description);

  try {
    const { stdout } = await pexec('node', args, { cwd: REPO_ROOT, timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
    const last = stdout.trim().split('\n').at(-1) ?? '{}';
    const parsed = JSON.parse(last);
    const result = parsed.results?.[0];
    if (!result || result.error) return NextResponse.json({ error: result?.error ?? 'upload failed' }, { status: 500 });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(-500) }, { status: 500 });
  }
}
