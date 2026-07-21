// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { discardBulkIdempotencyKey, getOrCreateBulkIdempotencyKey, stableSerialize } from './bulkIdempotency';

describe('bulk idempotency helpers', () => {
  beforeEach(() => sessionStorage.clear());

  it('serializes object keys independently of insertion order', () => {
    expect(stableSerialize({ b: 2, a: 1 })).toBe(stableSerialize({ a: 1, b: 2 }));
  });

  it('keeps a key until explicitly discarded', () => {
    const first = getOrCreateBulkIdempotencyKey(stableSerialize({ subject: 'same' }));
    expect(getOrCreateBulkIdempotencyKey(stableSerialize({ subject: 'same' })).key).toBe(first.key);
    discardBulkIdempotencyKey(first.storageKey);
    expect(getOrCreateBulkIdempotencyKey(stableSerialize({ subject: 'same' })).key).not.toBe(first.key);
  });

  it('uses different keys for different operation content', () => {
    expect(getOrCreateBulkIdempotencyKey(stableSerialize({ subject: 'A' })).key)
      .not.toBe(getOrCreateBulkIdempotencyKey(stableSerialize({ subject: 'B' })).key);
  });
});
