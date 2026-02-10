export function csrfToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>("meta[name='csrf-token']");
  return meta?.content || null;
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
    const err = new Error(`HTTP ${res.status}`);
    (err as any).payload = json;
    (err as any).status = res.status;
    throw err;
  }
  return (json as T) ?? ({} as T);
}
