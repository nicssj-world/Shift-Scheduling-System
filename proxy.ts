import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.redirect(new URL('/login', request.url))

  const supabase = createServerClient(url, key, {
    cookieOptions: { name: 'shift-auth' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const login = new URL('/login', request.url)
    login.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(login)
  }
  return response
}

export const config = {
  matcher: [
    '/schedule/:path*',
    '/swaps/:path*',
    '/leaves/:path*',
    '/dashboard/:path*',
    '/reports/:path*',
    '/analytics/:path*',
    '/notifications/:path*',
    '/admin/:path*',
  ],
}
