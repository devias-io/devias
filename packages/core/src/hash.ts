/**
 * Deterministic serialization + a small non-cryptographic hash.
 * Used for manifest hashes, plan hashes and query-cache keys. Change detection only, never security.
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return value === undefined ? 'null' : JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
};

/** FNV-1a, 64-bit, hex encoded. Fast, dependency-free, identical in Node and browsers. */
export const fnv1a64 = (input: string): string => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(input);

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
};

export const hashValue = (value: unknown): string => fnv1a64(stableStringify(value));
