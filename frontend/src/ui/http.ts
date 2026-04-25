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
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'POST'): Promise<T> {
  const token = csrfToken();
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
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
