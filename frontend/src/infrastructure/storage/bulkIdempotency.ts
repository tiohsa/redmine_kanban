const STORAGE_PREFIX = 'redmine_kanban:bulk:';

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function storageKeyForBulkSignature(signature: string): string {
  return `${STORAGE_PREFIX}${signature}`;
}

export function getOrCreateBulkIdempotencyKey(signature: string): { key: string; storageKey: string } {
  const storageKey = storageKeyForBulkSignature(signature);
  let key: string | null = null;
  try { key = sessionStorage.getItem(storageKey); } catch { /* best effort */ }
  key = key ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  try { sessionStorage.setItem(storageKey, key); } catch { /* best effort */ }
  return { key, storageKey };
}

export function discardBulkIdempotencyKey(storageKey: string): void {
  try { sessionStorage.removeItem(storageKey); } catch { /* best effort */ }
}
