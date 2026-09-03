'use client'

function csrfToken() {
  if (typeof document === 'undefined') return ''
  const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('shift-line-csrf='))
  return item ? decodeURIComponent(item.slice('shift-line-csrf='.length)) : ''
}

export class LineAuthError extends Error {
  constructor(message = 'LINE session expired') {
    super(message)
    this.name = 'LineAuthError'
  }
}

export async function lineApi<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const url = method === 'GET' ? `${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}` : path
  const res = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { 'x-line-csrf': csrfToken() } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    if (res.status === 401) throw new LineAuthError(body.error)
    throw new Error(body.error ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่')
  }
  return body
}
