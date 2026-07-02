import { NextResponse } from 'next/server';
import { listExports } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listExports());
}
