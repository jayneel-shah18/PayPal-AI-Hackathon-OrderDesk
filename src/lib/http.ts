import { NextResponse } from 'next/server';
import { HttpError } from './orders';

export function fail(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 });
}

export type RouteCtx = { params: Promise<{ id: string }> };
