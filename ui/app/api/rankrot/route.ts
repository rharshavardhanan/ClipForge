import { NextRequest, NextResponse } from 'next/server';
import { startRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

/** MIRROR of src/rankrot/pipeline.ts topicSlug — keep in sync (names the exports dir). */
function topicSlug(topic: string): string {
  const s = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `rankrot_${s || 'topic'}`;
}

/** Start a RankRot run. Body: { topic, top?, accent?, sfx?, replays? }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const topic: string = typeof body?.topic === 'string' ? body.topic.trim() : '';
  if (topic.length < 3) return NextResponse.json({ error: 'topic required (e.g. "best basketball dunks")' }, { status: 400 });

  const args = ['rankrot', topic];
  const top = Number(body.top);
  if (Number.isFinite(top) && top >= 2 && top <= 10) args.push('--top', String(Math.round(top)));
  if (typeof body.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent)) args.push('--accent', body.accent);
  if (body.sfx === false) args.push('--no-sfx');
  if (body.replays === false) args.push('--no-replays');

  const run = startRun(args);
  return NextResponse.json({ id: run.id, args: run.args, slug: topicSlug(topic) });
}
