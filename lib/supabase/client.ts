'use client'

import { createBrowserClient } from '@supabase/ssr'

export const AUTH_COOKIE_NAME = 'shift-auth'

// Next.js can only inline NEXT_PUBLIC_* vars into the client bundle when it
// sees a static `process.env.NEXT_PUBLIC_X` expression — dynamic/bracket
// access (e.g. via a shared requireEnv(name) helper) is invisible to the
// bundler and evaluates to undefined in the browser. Keep these two static.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, { cookieOptions: { name: AUTH_COOKIE_NAME } })
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
