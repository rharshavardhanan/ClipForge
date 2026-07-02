import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const has = (v?: string) => Boolean(v && v.trim());

/** Which semantic provider will be used, from the env passed through by `clipforge ui`. */
export async function GET() {
  const forced = (process.env.SEMANTIC_PROVIDER ?? '').trim().toLowerCase();
  const claude = has(process.env.ANTHROPIC_API_KEY) || has(process.env.ANTHROPIC_AUTH_TOKEN);
  const gemini = has(process.env.GEMINI_API_KEY) || has(process.env.GEMINI_API_KEYS);

  let provider: 'claude' | 'gemini' | 'none' = 'none';
  if (forced === 'gemini') provider = gemini ? 'gemini' : 'none';
  else if (forced === 'claude') provider = claude ? 'claude' : 'none';
  else if (forced === 'none') provider = 'none';
  else if (claude) provider = 'claude';
  else if (gemini) provider = 'gemini';

  return NextResponse.json({ provider });
}
