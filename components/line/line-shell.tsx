'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeftRight, Bell, CalendarDays, Coins, Home, LogOut, Menu, Settings, UserRound, Users, X } from 'lucide-react'
import { lineApi, LineAuthError } from '@/lib/line-api'

declare global {
  interface Window {
    liff?: {
      init(options: { liffId: string }): Promise<void>
      isLoggedIn(): boolean
      login(options?: { redirectUri?: string }): void
      getIDToken(): string | null
    }
  }
}

type LineActor = { id: string; name: string; role: string; dept: string | null; isAdmin?: boolean; isScheduler?: boolean }
type LineContextValue = { actor: LineActor; csrfToken: string; settings: Record<string, boolean> }

import { createContext, useContext } from 'react'
const LineContext = createContext<LineContextValue | null>(null)

export function useLineContext() {
  const value = useContext(LineContext)
  if (!value) throw new Error('useLineContext must be used inside LineShell')
  return value
}

type Bootstrap = { actor: LineActor; settings: Record<string, boolean> }

async function loadLiffScript() {
  if (window.liff) return
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-line-liff]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('โหลด LINE SDK ไม่สำเร็จ')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
    script.async = true
    script.dataset.lineLiff = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('โหลด LINE SDK ไม่สำเร็จ'))
    document.head.appendChild(script)
  })
}

export function LineShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'ready' | 'unlinked' | 'error'>('loading')
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LINE_MINI_APP_LIFF_ID
        if (!liffId) throw new Error('ยังไม่ได้ตั้งค่า LINE MINI App')
        await loadLiffScript()
        if (!window.liff) throw new Error('LINE SDK ไม่พร้อมใช้งาน')
        await window.liff.init({ liffId })
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href })
          return
        }
        const idToken = window.liff.getIDToken()
        if (!idToken) throw new Error('LINE ไม่ส่งตัวตนผู้ใช้')
        await lineApi('/api/line/session', { method: 'POST', body: JSON.stringify({ idToken }) })
        const next = await lineApi<Bootstrap>('/api/line/bootstrap')
        if (!cancelled) { setBootstrap(next); setState('ready') }
      } catch (reason) {
        if (cancelled) return
        const message = reason instanceof LineAuthError ? 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับระบบ' : reason instanceof Error ? reason.message : 'เปิด LINE MINI App ไม่สำเร็จ'
        setError(message)
        setState(reason instanceof Error && reason.message.includes('ยังไม่ได้เชื่อม') ? 'unlinked' : 'error')
      }
    }
    void boot()
    return () => { cancelled = true }
  }, [])

  const nav = useMemo(() => [
    { href: '/line/today', label: 'เวรวันนี้', icon: Users },
    { href: '/line', label: 'หน้าหลัก', icon: Home },
    { href: '/line/schedule', label: 'ตารางเวร', icon: CalendarDays },
    { href: '/line/my-shifts', label: 'เวรของฉัน', icon: UserRound },
    { href: '/line/swap', label: 'แลกเวร', icon: ArrowLeftRight },
    { href: '/line/sell', label: 'ขาย/รับเวร', icon: Coins },
    { href: '/line/open-sales', label: 'เวรเปิดขาย', icon: Coins },
    { href: '/line/requests', label: 'คำขอ', icon: Bell },
    { href: '/line/settings', label: 'ตั้งค่า', icon: Settings },
  ], [])

  if (state === 'loading') return <LineLoading />
  if (state === 'unlinked') return <LineUnlinked error={error} />
  if (state === 'error') return <LineError error={error} onRetry={() => window.location.reload()} />
  if (!bootstrap) return null

  async function logout() {
    await lineApi('/api/line/session', { method: 'DELETE' }).catch(() => {})
    router.push('/line')
    router.refresh()
  }

  return (
    <LineContext.Provider value={{ actor: bootstrap.actor, csrfToken: '', settings: bootstrap.settings }}>
      <div className="min-h-screen bg-[#f2f7fa] text-ink">
        <header className="sticky top-0 z-30 border-b border-white/30 bg-[#0c2f4a]/95 text-white shadow-lg shadow-slate-900/10 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400/20 text-cyan-200"><CalendarDays size={20} /></div>
              <div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">MT · CBH</p><p className="text-sm font-bold">ตารางเวรของเรา</p></div>
            </div>
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-white/10" aria-label="เมนู">
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
          {menuOpen && <div className="mx-auto max-w-xl border-t border-white/10 px-4 pb-3 pt-2"><nav className="grid grid-cols-2 gap-1">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-white/10"><Icon size={17} />{label}</Link>)}<button type="button" onClick={logout} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-200 hover:bg-white/10"><LogOut size={17} />ออกจากระบบ</button></nav></div>}
        </header>
        <main className="mx-auto max-w-xl px-4 pb-8 pt-5">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200/80 bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(12,47,74,0.08)] backdrop-blur sm:hidden"><div className="mx-auto grid max-w-xl grid-cols-5">{nav.filter((item) => item.href !== '/line/today').slice(0, 5).map(({ href, label, icon: Icon }) => { const active = pathname === href || (href !== '/line' && pathname.startsWith(`${href}/`)); return <Link key={href} href={href} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${active ? 'text-brand-700' : 'text-slate-500'}`}><Icon size={18} /><span>{label}</span></Link> })}</div></nav>
      </div>
    </LineContext.Provider>
  )
}

function LineLoading() { return <div className="flex min-h-screen items-center justify-center bg-[#f2f7fa] p-6"><div className="w-full max-w-sm text-center"><div className="mx-auto mb-5 h-12 w-12 animate-pulse rounded-2xl bg-brand-600/20" /><p className="text-sm font-semibold text-slate-600">กำลังเชื่อมต่อ LINE…</p><div className="mx-auto mt-4 h-1.5 w-32 overflow-hidden rounded-full bg-slate-200"><div className="h-full w-1/2 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-brand-600" /></div></div></div> }
function LineUnlinked({ error }: { error: string }) { return <div className="flex min-h-screen items-center justify-center bg-[#f2f7fa] p-6"><div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl shadow-slate-900/10"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><UserRound size={26} /></div><h1 className="text-lg font-bold">ยังไม่ได้เชื่อมบัญชี</h1><p className="mt-2 text-sm leading-6 text-slate-600">{error}<br />เชื่อมกับบัญชี E‑Phis เดิมเพื่อดูตารางเวร</p><Link href="/line/link" className="mt-5 flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">เชื่อมบัญชี</Link></div></div> }
function LineError({ error, onRetry }: { error: string; onRetry: () => void }) { return <div className="flex min-h-screen items-center justify-center bg-[#f2f7fa] p-6"><div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl shadow-slate-900/10"><h1 className="text-lg font-bold">เปิด MINI App ไม่สำเร็จ</h1><p className="mt-2 text-sm leading-6 text-slate-600">{error}</p><button type="button" onClick={onRetry} className="mt-5 min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white">ลองใหม่</button></div></div> }
