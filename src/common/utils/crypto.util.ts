import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
} from 'node:crypto';

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). `key` is base64 of 32 bytes. */
export function encryptSecret(plain: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new Error('Unsupported encrypted payload');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyBase64, 'base64'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Uniformly random numeric code (CSPRNG), e.g. a 6-digit OTP. */
export function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}
