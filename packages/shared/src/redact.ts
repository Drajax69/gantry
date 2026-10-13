/**
 * Secret hygiene. Environment values loaded from private files must never
 * reach the API, logs, prompts or exports. Everything that crosses that
 * boundary passes through `redactEnv`, which keeps only key names and the
 * fingerprint-like length of each value.
 */

const SENSITIVE_KEY = /(secret|token|password|passwd|key|credential|authorization|cookie|jwt)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export type RedactedEnv = Record<string, { set: true; length: number } | { set: false }>;

/** Keep key names (useful for diagnostics), drop every value. */
export function redactEnv(env: Record<string, string>): RedactedEnv {
  const out: RedactedEnv = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = value?.trim() ? { set: true, length: value.length } : { set: false };
  }
  return out;
}

/** Redact values of sensitive-looking keys from a plain object copy. */
export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const key of Object.keys(out)) {
    if (isSensitiveKey(key) && typeof out[key] === 'string') {
      out[key] = '[redacted]';
    }
  }
  return out;
}

/**
 * Scrub accidental secret-looking substrings from free-form log text by
 * replacing exact matches of supplied secret values with `[redacted]`.
 */
export function scrubSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[redacted]');
  }
  return out;
}
