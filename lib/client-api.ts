export async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  // Live, mutable data — never serve a stale browser-cached GET. Without this,
  // reloading right after a mutation (e.g. generate → reload) can return the
  // pre-mutation response and the UI looks like nothing changed. cache:
  // 'no-store' is the spec fix; the unique _t param defeats any stale entry a
  // browser cached before no-store was in place, and any layer that ignores it.
  const url = method === 'GET' ? `${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}` : path
  const res = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
    }
    throw new Error(json.error ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่')
  }
  return json
}
