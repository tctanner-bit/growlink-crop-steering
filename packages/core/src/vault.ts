import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for tenant Growlink API keys. The master key lives only in the
 * server environment (VAULT_MASTER_KEY, 32 bytes base64). Keys never reach the browser
 * after onboarding; the UI shows only the last four characters.
 */
export interface Sealed { ciphertext: string; iv: string; tag: string; last4: string }

function masterKey(raw = process.env.VAULT_MASTER_KEY): Buffer {
  if (!raw) throw new Error('VAULT_MASTER_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('VAULT_MASTER_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function seal(secret: string, rawKey?: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(rawKey), iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), last4: secret.slice(-4) };
}

export function open(sealed: Pick<Sealed, 'ciphertext' | 'iv' | 'tag'>, rawKey?: string): string {
  const decipher = createDecipheriv('aes-256-gcm', masterKey(rawKey), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
