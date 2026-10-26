/** fetch with timeout + retry on network errors, 429 and 5xx. Returns parsed JSON. */
export async function httpJson<T = any>(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 15000, retries = 2, ...rest } = init;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { fatal: true });
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if ((e as any)?.fatal) break;
      if (i < retries) await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
