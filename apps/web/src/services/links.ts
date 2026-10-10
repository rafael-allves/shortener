export type Link = { shortCode: string; originalUrl: string; createdAt: string };
export type Page = { data: Link[]; pagination: { page: number; limit: number; total: number; pages: number } };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/links${path}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : body?.message ?? `Request failed (${response.status}).`);
  if (!body) throw new Error('The API returned an unexpected response.');
  return body as T;
}

export const linksApi = {
  list(page: number, shortCut: string, signal: AbortSignal) {
    const query = new URLSearchParams({ page: String(page), limit: '20' });
    if (shortCut) query.set('shortCut', shortCut);
    return request<Page>(`?${query}`, { signal });
  },
  async get(code: string, signal: AbortSignal) {
    return (await request<{ data: Link }>(`/${encodeURIComponent(code)}`, { signal })).data;
  },
  create(originalUrl: string, shortCode: string, key: string) {
    return request<Link>('', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ originalUrl, ...(shortCode ? { shortCode } : {}) }) });
  },
  async update(code: string, originalUrl: string) {
    return (await request<{ data: Link }>(`/${encodeURIComponent(code)}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl }) })).data;
  },
};
