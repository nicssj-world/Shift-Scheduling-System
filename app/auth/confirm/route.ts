import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function loginRedirect(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login?error=shift_sso_failed', request.url))
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  // The portal handoff mints a one-time magic-link token. Do not accept other
  // OTP types or pass the token through to the browser-side client.
  if (!tokenHash || type !== 'magiclink') return loginRedirect(request)

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (error) return loginRedirect(request)

  const response = NextResponse.redirect(new URL('/schedule', request.url))
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
