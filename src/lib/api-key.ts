/** API key format and hashing. No database access, so scripts and tests can import it. */
import { createHash, randomBytes } from "node:crypto";

/** Keys look like `ncd_<40 base32 chars>`; only their SHA-256 hash is stored. */
export const KEY_RE = /^ncd_[a-z2-7]{40}$/;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const key = `ncd_${[...randomBytes(40)].map((b) => alphabet[b & 31]).join("")}`;
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}
