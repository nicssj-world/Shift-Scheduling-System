'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeftRight, BarChart3, Bell, CalendarClock, CalendarCog, CalendarDays,
  ClipboardList, FileSpreadsheet, LogOut, Menu, Palmtree, Settings, Sparkles, Users, X,
} from 'lucide-react'
import { NotificationBell } from '@/components/notification-bell'
import { createClient } from '@/lib/supabase/client'

export type ShellActor = {
  id: string
  name: string
  role: string
  isAdmin: boolean
  isManager: boolean
  isScheduler: boolean
}

type NavItem = { href: string; label: string; icon: React.ReactNode; show: boolean }

export function AppShell({ actor, children }: { actor: ShellActor; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  const nav: { section: string; items: NavItem[] }[] = [
    {
      section: 'ตารางเวร',
      items: [
        { href: '/schedule', label: 'ตารางเวร', icon: <CalendarDays size={17} />, show: true },
        { href: '/schedule/manage', label: 'จัดตารางเวร', icon: <CalendarCog size={17} />, show: actor.isScheduler },
        { href: '/swaps', label: 'แลก/ขายเวร', icon: <ArrowLeftRight size={17} />, show: true },
        { href: '/leaves', label: 'วันลา', icon: <Palmtree size={17} />, show: true },
      ],
    },
    {
      section: 'ภาพรวม',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: <BarChart3 size={17} />, show: actor.isScheduler || actor.isManager },
        { href: '/reports', label: 'รายงาน', icon: <FileSpreadsheet size={17} />, show: true },
        { href: '/analytics', label: 'วิเคราะห์', icon: <Sparkles size={17} />, show: actor.isScheduler },
        { href: '/notifications', label: 'การแจ้งเตือน', icon: <Bell size={17} />, show: true },
      ],
    },
    {
      section: 'ตั้งค่า',
      items: [
        { href: '/admin/staff', label: 'บุคลากรและทีมเวร', icon: <Users size={17} />, show: actor.isAdmin },
        { href: '/admin/shift-types', label: 'ประเภทเวร', icon: <ClipboardList size={17} />, show: actor.isAdmin },
        { href: '/admin/holidays', label: 'วันหยุดพิเศษ', icon: <CalendarClock size={17} />, show: actor.isAdmin },
        { href: '/admin/settings', label: 'ตั้งค่าระบบ', icon: <Settings size={17} />, show: actor.isAdmin },
      ],
    },
  ]

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2.5 px-2 py-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/30">
          <CalendarClock size={20} />
        </div>
        <div>
          <div className="text-[13px] font-bold leading-tight">ระบบจัดตารางเวร</div>
          <div className="text-[10px] text-slate-500">เทคนิคการแพทย์ รพ.ชลบุรี</div>
        </div>
      </div>
      {nav.map((group) => {
        const visible = group.items.filter((i) => i.show)
        if (visible.length === 0) return null
        return (
          <div key={group.section} className="mb-1">
            <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {group.section}
            </div>
            {visible.map((item) => {
              const active = pathname === item.href || (item.href !== '/schedule' && pathname.startsWith(`${item.href}/`))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                    active ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-800'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              )
            })}
          </div>
        )
      })}
      <div className="mt-auto border-t border-line pt-3">
        <div className="px-3 pb-2">
          <div className="text-[13px] font-bold">{actor.name}</div>
          <div className="text-[11px] text-slate-500">{actor.role}</div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-red-50 hover:text-red-700"
        >
          <LogOut size={17} />
          ออกจากระบบ
        </button>
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="glass sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/40" />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 lg:px-6">
          <button className="rounded-xl p-2 text-slate-500 hover:bg-brand-50 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="เมนู">
            <Menu size={20} />
          </button>
          <div className="hidden text-sm font-semibold text-slate-500 lg:block">
            กลุ่มงานเทคนิคการแพทย์ · โรงพยาบาลชลบุรี
          </div>
          <NotificationBell userId={actor.id} />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
