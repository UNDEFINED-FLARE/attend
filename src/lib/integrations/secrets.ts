import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Credentials for an institution's systems (Moodle tokens, roster-link tokens, OAuth
// client secrets) are encrypted here, on the server, before they reach the database.
// The database only ever holds "v1.<iv>.<tag>.<ciphertext>"; the key lives only in
// the server's environment (INTEGRATION_ENCRYPTION_KEY), never in the browser, the
// repository or the database. AES-256-GCM, so a tampered value fails to decrypt.
//
// Make a key once:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Losing or changing it means re-entering each connection's token.

const PREFIX = "v1.";

function key(): Buffer | null {
  const raw = (process.env.INTEGRATION_ENCRYPTION_KEY ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!raw) return null;
  const b64 = /^[A-Za-z0-9+/]{43}=?$/.test(raw) ? Buffer.from(raw, "base64") : null;
  if (b64 && b64.length === 32) return b64;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  // Any other value of reasonable length is stretched to 32 bytes.
  return raw.length >= 24 ? createHash("sha256").update(raw).digest() : null;
}

export const encryptionReady = () => key() !== null;

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error("INTEGRATION_ENCRYPTION_KEY is not set on the server, so credentials can't be stored safely.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) throw new Error("This connection's token was saved before encryption was set up. Edit the connection and paste the token again.");
  const k = key();
  if (!k) throw new Error("INTEGRATION_ENCRYPTION_KEY is not set on the server.");
  const [iv, tag, body] = stored.slice(PREFIX.length).split(".").map((p) => Buffer.from(p, "base64url"));
  try {
    const d = createDecipheriv("aes-256-gcm", k, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    throw new Error("This connection's token can't be decrypted (the server key changed). Edit the connection and paste the token again.");
  }
}

export type TestStatus = "connected" | "auth_failed" | "connection_failed" | "permission_denied" | "unavailable" | "incomplete";

/** Which connection status a failed test's message means. */
export function statusFromError(message: string): TestStatus {
  if (/refused access|didn't accept the token|token was refused|invalid ?token|\(401\)/i.test(message)) return "auth_failed";
  if (/isn't allowed|accessexception|permission|\(403\)/i.test(message)) return "permission_denied";
  if (/answered 5\d\d|timed? ?out|aborted|unavailable|ECONNRESET|ETIMEDOUT/i.test(message)) return "unavailable";
  if (/missing|not set|paste the/i.test(message)) return "incomplete";
  return "connection_failed";
}
