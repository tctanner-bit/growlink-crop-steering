import 'server-only';
import { createDemoFarm, GrowlinkApi, HttpGrowlinkClient } from '@gl-steering/core';
import { open } from '@gl-steering/core/vault';

/** Discovery client for a stored connection (decrypts the key server-side only). */
export function apiForConnection(conn: { kind: 'growlink' | 'demo'; key_ciphertext: string | null; key_iv: string | null; key_tag: string | null }): GrowlinkApi {
  if (conn.kind === 'demo') return createDemoFarm();
  if (!conn.key_ciphertext || !conn.key_iv || !conn.key_tag) throw new Error('Connection has no API key');
  return new HttpGrowlinkClient({
    apiKey: open({ ciphertext: conn.key_ciphertext, iv: conn.key_iv, tag: conn.key_tag }),
    baseUrl: process.env.GROWLINK_BASE_URL || undefined,
  });
}
