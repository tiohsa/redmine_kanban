type Revision = { lock_version?: number; updated_on?: string | null };

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function compareIssueFreshness(current: Revision, incoming: Revision): 'newer' | 'same' | 'older' | 'unknown' {
  const bothVersioned = typeof current.lock_version === 'number' && typeof incoming.lock_version === 'number';
  if (bothVersioned) {
    if (incoming.lock_version! > current.lock_version!) return 'newer';
    if (incoming.lock_version! < current.lock_version!) return 'older';
  }
  const currentTime = timestamp(current.updated_on);
  const incomingTime = timestamp(incoming.updated_on);
  if (currentTime !== null && incomingTime !== null) {
    if (incomingTime > currentTime) return 'newer';
    if (incomingTime < currentTime) return 'older';
    return 'same';
  }
  if (currentTime !== null && incomingTime === null) return 'older';
  return bothVersioned ? 'same' : 'unknown';
}
