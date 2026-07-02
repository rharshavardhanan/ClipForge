import { NextRequest, NextResponse } from 'next/server';
import { startRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

const PRESETS = new Set(['mrbeast', 'hormozi', 'gadzhi', 'gaming', 'podcast', 'cinematic', 'minimal', 'card', 'bold']);

/** Start a pipeline run. Body: { inputs: string[], top, style, accent, music, zooms, ranking }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const inputs: string[] = Array.isArray(body?.inputs) ? body.inputs.filter((s: unknown) => typeof s === 'string' && s.trim()) : [];
  if (inputs.length === 0) return NextResponse.json({ error: 'inputs required' }, { status: 400 });

  const args: string[] = inputs.length > 1 ? ['batch', ...inputs] : [inputs[0].endsWith('.mp4') || inputs[0].endsWith('.mov') || inputs[0].endsWith('.mkv') || inputs[0].endsWith('.webm') ? 'process' : 'all', inputs[0]];
  const top = Number(body.top);
  if (Number.isFinite(top) && top > 0) args.push('--top', String(Math.min(20, Math.round(top))));
  // v6 content mode + contextual B-roll (tri-state: on / off / mode default)
  if (body.mode === 'clippies' || body.mode === 'mindcuts') args.push('--mode', body.mode);
  if (body.broll === true) args.push('--broll');
  if (body.broll === false) args.push('--no-broll');
  if (PRESETS.has(body.style)) args.push('--style', body.style);
  if (typeof body.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent)) args.push('--accent', body.accent);
  // caption fine-tuning overrides (empty/0/-1 = keep preset value)
  const FONTS = new Set(['anton', 'bangers', 'archivo', 'montserrat', 'poppins', 'inter']);
  if (FONTS.has(body.font)) args.push('--font', body.font);
  const fontSize = Number(body.fontSize);
  if (Number.isFinite(fontSize) && fontSize >= 20 && fontSize <= 160) args.push('--font-size', String(Math.round(fontSize)));
  if (body.position === 'bottom' || body.position === 'center') args.push('--position', body.position);
  const stroke = Number(body.stroke);
  if (Number.isFinite(stroke) && stroke >= 0 && stroke <= 30) args.push('--stroke', String(Math.round(stroke)));
  if (typeof body.captionColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.captionColor)) args.push('--caption-color', body.captionColor);
  if (body.music === false) args.push('--no-music');
  if (body.zooms === false) args.push('--no-zooms');
  if (body.deleteSource === true) args.push('--delete-source');
  if (body.ranking === true && inputs.length > 1) args.push('--ranking');

  const run = startRun(args);
  return NextResponse.json({ id: run.id, args: run.args });
}
