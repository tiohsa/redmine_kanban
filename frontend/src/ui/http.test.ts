// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, csrfToken, getJson, postJson } from './http';

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
});

describe('csrfToken', () => {
  it('reads csrf token from meta tag', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'csrf-token');
    meta.setAttribute('content', 'abc123');
    document.head.appendChild(meta);

    expect(csrfToken()).toBe('abc123');
  });
});

describe('getJson', () => {
  it('forwards an optional AbortSignal and preserves the default call shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);
    await getJson('/api/default');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/default', { credentials: 'same-origin', cache: 'no-store' });

    const controller = new AbortController();
    await getJson('/api/cancellable', { signal: controller.signal });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/cancellable', {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    });
  });

  it('throws when response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(getJson('/api/board')).rejects.toMatchObject({
      name: 'HttpError',
      status: 500,
      payload: null,
    });
  });
});

describe('postJson', () => {
  it('sends csrf header and JSON body', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'csrf-token');
    meta.setAttribute('content', 'token-1');
    document.head.appendChild(meta);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const res = await postJson<{ ok: boolean }>('/api/issue', { issue: { subject: 'A' } }, 'PATCH');

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/issue',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'same-origin',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'token-1',
        }),
      })
    );
  });

  it('attaches status and payload to thrown error on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Validation failed' }),
    } as Response);

    try {
      await postJson('/api/issue', { issue: { subject: '' } });
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(HttpError);
      const error = e as HttpError<{ message: string }>;
      expect(error.message).toBe('HTTP 422');
      expect(error.status).toBe(422);
      expect(error.payload).toEqual({ message: 'Validation failed' });
      return;
    }

    throw new Error('expected postJson to throw');
  });
});
