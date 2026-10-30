import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

const encKey = Buffer.from(env.ENCRYPTION_KEY, 'hex');
const sigKey = Buffer.from(env.SESSION_SECRET, 'hex');

/** AES-256-GCM, encoded as base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encKey, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Signs a value as `value.signature` for cookies. */
export function sign(value: string): string {
  return `${value}.${createHmac('sha256', sigKey).update(value).digest('base64url')}`;
}

export function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  return safeEqual(sign(value), signed) ? value : null;
}
