import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from '../../common/utils/timing-safe-equal.util';

/** RFC 4648 base32 + RFC 6238 TOTP (SHA-1, 30 s, 6 digits), implemented with node:crypto only. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit random secret, base32 encoded (what authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const totpStep = (nowMs: number = Date.now()): number =>
  Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);

/** HOTP (RFC 4226) for a given counter. */
export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(message)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Returns the time-step that matched (within +/- `window` steps), or null.
 * The caller must persist the step and reject anything at or below it (replay protection).
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number = Date.now(),
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  let matched: number | null = null;
  // Check every step (no early exit) so timing does not reveal which one matched.
  for (let step = current - window; step <= current + window; step++) {
    if (safeEqual(hotp(secret, step), code) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(params: {
  secret: string;
  issuer: string;
  account: string;
}): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
