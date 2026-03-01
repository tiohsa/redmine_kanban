export function buildProjectScopeFromDataUrl(dataUrl: string): string {
  const normalizedDataUrl = dataUrl.replace(/\?.*$/, '');
  return normalizedDataUrl.replace(/\/data$/, '');
}

export function makeScopedStorageKey(baseKey: string, scope: string): string {
  return `${baseKey}:${scope}`;
}

function readStorageRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readScopedBooleanWithLegacy(
  scopedKey: string,
  legacyKey: string,
  defaultValue: boolean,
): boolean {
  const scopedValue = readStorageRaw(scopedKey);
  if (scopedValue !== null) {
    return scopedValue === '1';
  }

  const legacyValue = readStorageRaw(legacyKey);
  if (legacyValue !== null) {
    return legacyValue === '1';
  }

  return defaultValue;
}

function parseNumberSet(raw: string): Set<number> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.map(Number));
  } catch {
    return null;
  }
}

export function readScopedNumberSetWithLegacy(
  scopedKey: string,
  legacyKey: string,
  defaultValue: Set<number>,
): Set<number> {
  const scopedValue = readStorageRaw(scopedKey);
  if (scopedValue !== null) {
    return parseNumberSet(scopedValue) ?? new Set(defaultValue);
  }

  const legacyValue = readStorageRaw(legacyKey);
  if (legacyValue !== null) {
    return parseNumberSet(legacyValue) ?? new Set(defaultValue);
  }

  return new Set(defaultValue);
}
