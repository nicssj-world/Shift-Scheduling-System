'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireEnv } from '@/lib/supabase/env'

export const AUTH_COOKIE_NAME = 'shift-auth'

export function createClient() {
  return createBrowserClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { cookieOptions: { name: AUTH_COOKIE_NAME } },
  )
}

/** Clear a broken/stale session (bad refresh token) for this app's cookie only. */
export function clearStaleAuthSession() {
  if (typeof window === 'undefined') return
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(AUTH_COOKIE_NAME)) window.localStorage.removeItem(key)
    }
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim()
      if (name && name.startsWith(AUTH_COOKIE_NAME)) {
        document.cookie = `${name}=; Max-Age=0; path=/`
      }
    }
  } catch {
    // best-effort cleanup only
  }
}
