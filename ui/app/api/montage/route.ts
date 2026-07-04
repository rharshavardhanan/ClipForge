import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { startRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

/** MIRROR of src/montage/pipeline.ts montageSlug — keep in sync (names the exports dir). */
function montageSlug(inputs: string[]): string {
  return 'montage_' + createHash('sha1').update(inputs.join('|')).digest('hex').slice(0, 10);
}

/** Start a Montage run. Body: { inputs, music?, duration?, counters?, payoffImage? }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const inputs: string[] = Array.isArray(body?.inputs)
    ? body.inputs.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0).map((s: string) => s.trim())
    : [];
  if (inputs.length === 0) return NextResponse.json({ error: 'at least one URL or file path required' }, { status: 400 });

  const args = ['montage', ...inputs];
  if (typeof body.music === 'string' && body.music.trim()) args.push('--music', body.music.trim());
  const duration = Number(body.duration);
  if (Number.isFinite(duration) && duration >= 15 && duration <= 45) args.push('--duration', String(duration));
  if (body.counters === false) args.push('--no-counters');
  if (body.payoffImage === false) args.push('--no-payoff-image');

  const run = startRun(args);
  return NextResponse.json({ id: run.id, args: run.args, slug: montageSlug(inputs) });
}
