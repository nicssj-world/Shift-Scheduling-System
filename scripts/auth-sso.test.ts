import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

describe('shift SSO handoff', () => {
  it('consumes a one-time portal token before entering the protected schedule', () => {
    const confirm = readFileSync('app/auth/confirm/route.ts', 'utf8')
    const proxy = readFileSync('proxy.ts', 'utf8')

    assert.match(confirm, /type !== 'magiclink'/, 'the handoff only accepts portal magic links')
    assert.match(confirm, /auth\.verifyOtp\(\{ type: 'magiclink', token_hash: tokenHash \}\)/, 'the token hash is consumed server-side')
    assert.match(confirm, /NextResponse\.redirect\(new URL\('\/schedule'/, 'successful SSO lands on the schedule')
    assert.match(confirm, /Cache-Control.*no-store/, 'one-time credentials must not be cached')
    assert.match(confirm, /Referrer-Policy.*no-referrer/, 'one-time credentials must not be forwarded as referrer')
    assert.match(proxy, /\/schedule\/:path\*/, 'the destination remains protected by the existing proxy')
  })
})
