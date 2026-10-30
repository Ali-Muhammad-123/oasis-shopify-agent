import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { clearSession } from '@/lib/session';

export async function POST() {
  await clearSession();
  return NextResponse.redirect(new URL('/', env.APP_URL), 303);
}
