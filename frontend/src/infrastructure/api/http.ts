export function csrfToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>("meta[name='csrf-token']");
  return meta?.content || null;
}

export class HttpError<TPayload = unknown> extends Error {
  readonly status: number;
  readonly payload: TPayload | null;

  constructor(status: number, payload: TPayload | null) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.payload = payload;
  }
}

export function isHttpError<TPayload = unknown>(error: unknown): error is HttpError<TPayload> {
  return error instanceof HttpError;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const json = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new HttpError(res.status, json);
  return json as T;
}

export async function postJson<T>(url: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'POST', extraHeaders: Record<string, string> = {}): Promise<T> {
  const token = csrfToken();
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    throw new HttpError(res.status, json);
  }
  return (json as T) ?? ({} as T);
}
