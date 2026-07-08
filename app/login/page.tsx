'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarClock, Eye, EyeOff, KeyRound, UserRound } from 'lucide-react'
import { clearStaleAuthSession, createClient } from '@/lib/supabase/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [ephis, setEphis] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    clearStaleAuthSession()
    const supabase = createClient()
    const loginEmail = ephis.includes('@') ? ephis : `${ephis.trim()}@cbh.go.th`
    const { error } = await supabase.auth
      .signInWithPassword({ email: loginEmail, password })
      .catch(() => ({ error: { message: 'Failed to fetch' } }))

    if (error) {
      if (error.message === 'Failed to fetch') clearStaleAuthSession()
      setError('รหัส E-Phis หรือรหัสผ่านไม่ถูกต้อง')
      setLoading(false)
      return
    }

    const next = searchParams.get('next')
    router.push(next && next.startsWith('/') ? next : '/schedule')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-600/30">
              <CalendarClock size={26} />
            </div>
            <div>
              <div className="font-bold text-[15px]">ระบบจัดตารางเวร</div>
              <div className="text-xs text-slate-500">กลุ่มงานเทคนิคการแพทย์ · โรงพยาบาลชลบุรี</div>
            </div>
          </div>

          <h1 className="text-2xl font-bold mb-1">เข้าสู่ระบบ</h1>
          <p className="text-sm text-slate-500 mb-7">
            ใช้รหัส E-Phis และรหัสผ่านเดียวกับ Lab Management Portal
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-[13px] font-semibold mb-1.5">รหัส E-Phis</label>
              <div className="relative">
                <UserRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={ephis}
                  onChange={(e) => setEphis(e.target.value)}
                  placeholder="xxxxxxx"
                  required
                  className="w-full rounded-xl border border-line bg-white pl-9 pr-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-semibold mb-1.5">รหัสผ่าน</label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-xl border border-line bg-white pl-9 pr-10 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700 disabled:opacity-60"
            >
              {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            ปัญหาการเข้าสู่ระบบ? ติดต่อผู้ดูแลระบบ
          </p>
        </div>
      </div>

      {/* Right: brand panel */}
      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden bg-gradient-to-br from-brand-600 to-brand-800">
        <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-white/10" />
        <div className="absolute -left-10 -bottom-16 w-64 h-64 rounded-full bg-mint-500/20" />
        <div className="relative text-white text-center max-w-sm px-8">
          <div className="text-5xl mb-5">🩺</div>
          <h2 className="text-2xl font-bold mb-3">Shift Scheduling System</h2>
          <p className="text-sm/-relaxed opacity-85 leading-7">
            ระบบจัดตารางเวรนักเทคนิคการแพทย์ออนไลน์แบบครบวงจร
            จัดเวรอัตโนมัติ · แลกเวร · บันทึกวันลา · รายงานสรุป
          </p>
          <div className="mt-7 glass rounded-2xl px-5 py-3 text-ink">
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-0.5">Central Lab</div>
            <div className="text-sm font-bold">เวรเช้า · เวรบ่าย · เวรดึก</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
