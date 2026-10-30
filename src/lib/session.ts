import 'server-only';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { sign, unsign } from './crypto';
import { db, schema } from './db';

export const SESSION_COOKIE = 'oasis_shop';
const MAX_AGE = 60 * 60 * 24 * 30;

export async function setSessionShop(shop: string) {
  (await cookies()).set(SESSION_COOKIE, sign(shop), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The installed shop for the current request, or null when signed out or uninstalled. */
export async function getSessionShop() {
  const domain = unsign((await cookies()).get(SESSION_COOKIE)?.value);
  if (!domain) return null;
  return (await db.query.shops.findFirst({ where: eq(schema.shops.domain, domain) })) ?? null;
}

export type SessionShop = NonNullable<Awaited<ReturnType<typeof getSessionShop>>>;
