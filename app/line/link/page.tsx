'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, CheckCircle2, KeyRound, Link2, LockKeyhole, UserRound } from 'lucide-react'
import { api } from '@/lib/client-api'
import { createClient } from '@/lib/supabase/client'

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

async function loadLiff() {
  if (window.liff) return window.liff
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
  return window.liff
}

function LinkForm() {
  const [linkToken, setLinkToken] = useState('')
  const [ephis, setEphis] = useState('')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [miniLoading, setMiniLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setLinkToken(params.get('linkToken') ?? '')
    void createClient().auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user))).catch(() => {})
  }, [])

  async function signIn() {
    const supabase = createClient()
    const email = ephis.includes('@') ? ephis.trim() : `${ephis.trim()}@cbh.go.th`
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) throw new Error('รหัส E-Phis หรือรหัสผ่านไม่ถูกต้อง')
    setSignedIn(true)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null); setLoading(true)
    try {
      if (!signedIn) await signIn()
      if (!linkToken) throw new Error('ลิงก์เชื่อมบัญชีหมดอายุ กรุณาพิมพ์ “เชื่อมบัญชี” ใน LINE ใหม่')
      const data = await api<{ redirectUrl?: string }>('/api/line/link', { method: 'POST', body: JSON.stringify({ linkToken }) })
      if (!data.redirectUrl) throw new Error('สร้างลิงก์เชื่อมบัญชีไม่สำเร็จ')
      setSuccess(true)
      window.location.assign(data.redirectUrl)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'เชื่อมบัญชีไม่สำเร็จ') } finally { setLoading(false) }
  }

  async function miniLink() {
    setError(null); setMiniLoading(true)
    try {
      if (!signedIn) await signIn()
      const liffId = process.env.NEXT_PUBLIC_LINE_MINI_APP_LIFF_ID
      if (!liffId) throw new Error('ยังไม่ได้ตั้งค่า LINE MINI App')
      const liff = await loadLiff()
      if (!liff) throw new Error('LINE SDK ไม่พร้อมใช้งาน')
      await liff.init({ liffId })
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return }
      const idToken = liff.getIDToken()
      if (!idToken) throw new Error('ไม่พบ LINE ID token')
      await api('/api/line/link/mini', { method: 'POST', body: JSON.stringify({ idToken }) })
      window.location.assign('/line')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'เชื่อมบัญชีไม่สำเร็จ') } finally { setMiniLoading(false) }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef7fb] p-4">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-2xl shadow-cyan-900/10">
        <div className="bg-[#0c2f4a] px-6 py-7 text-white"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/20 text-cyan-200"><Link2 size={22} /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">LINE ACCOUNT</p><h1 className="text-lg font-extrabold">เชื่อมบัญชีตารางเวร</h1></div></div><p className="mt-4 text-sm leading-6 text-slate-200">ยืนยันด้วยบัญชี E-Phis เดิม เพื่อให้ LINE เข้าถึงเฉพาะข้อมูลของคุณ</p></div>
        <div className="space-y-5 p-6">
          {success ? <div className="rounded-2xl bg-emerald-50 p-4 text-center text-sm font-semibold text-emerald-800"><CheckCircle2 className="mx-auto mb-2" size={28} />กำลังส่งต่อไป LINE เพื่อยืนยันการเชื่อมบัญชี…</div> : <form onSubmit={submit} className="space-y-4"><div><label className="mb-1.5 block text-sm font-bold">รหัส E-Phis</label><div className="relative"><UserRound size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input required value={ephis} onChange={(event) => setEphis(event.target.value)} className={`${inputStyle} pl-10`} placeholder="เช่น 1234567" /></div></div><div><label className="mb-1.5 block text-sm font-bold">รหัสผ่าน</label><div className="relative"><KeyRound size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputStyle} pl-10`} /></div></div>{error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<button type="submit" disabled={loading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-extrabold text-white shadow-lg shadow-cyan-600/20 disabled:opacity-50">{loading ? 'กำลังตรวจสอบ…' : 'เชื่อมผ่าน LINE OA'}<ArrowRight size={17} /></button></form>}
          <div className="relative flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-[11px] font-semibold text-slate-400">หรือ</span><div className="h-px flex-1 bg-slate-200" /></div>
          <button type="button" onClick={miniLink} disabled={miniLoading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><CalendarDays size={17} />{miniLoading ? 'กำลังเชื่อมจาก MINI App…' : 'เชื่อมจาก LINE MINI App'}</button>
          <div className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><LockKeyhole size={16} className="mt-0.5 shrink-0 text-cyan-700" />ระบบจะเก็บเพียง LINE user ID ที่จับคู่กับโปรไฟล์ และออก session อายุสั้น ไม่เก็บ ID token</div>
          <Link href="/line" className="block text-center text-sm font-bold text-cyan-700">กลับไปหน้า LINE</Link>
        </div>
      </div>
    </main>
  )
}

const inputStyle = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 sm:text-sm'

export default function LineLinkPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#eef7fb] text-sm text-slate-500">กำลังโหลด…</div>}><LinkForm /></Suspense>
}
