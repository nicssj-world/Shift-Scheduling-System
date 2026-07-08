'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { api } from '@/lib/client-api'
import { createClient } from '@/lib/supabase/client'
import type { AppNotification } from '@/lib/types'

export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const data = await api<{ notifications: AppNotification[]; unreadCount: number }>('/api/notifications?limit=15')
      setItems(data.notifications)
      setUnread(data.unreadCount)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    load()
    const supabase = createClient()
    const channel = supabase
      .channel(`shift-notif-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shift_notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setItems((prev) => [payload.new as AppNotification, ...prev].slice(0, 15))
          setUnread((n) => n + 1)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, load])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function markAllRead() {
    setUnread(0)
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    await api('/api/notifications', { method: 'PATCH', body: JSON.stringify({ all: true }) }).catch(() => {})
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-700"
        aria-label="การแจ้งเตือน"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="glass absolute right-0 z-40 mt-2 w-80 rounded-2xl bg-white/95 p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-bold">การแจ้งเตือน</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold text-brand-600 hover:underline">
                อ่านทั้งหมด
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-400">ยังไม่มีการแจ้งเตือน</div>}
            {items.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? '/notifications'}
                onClick={() => setOpen(false)}
                className={`block rounded-xl px-3 py-2 hover:bg-brand-50 ${n.read_at ? 'opacity-60' : ''}`}
              >
                <div className="text-[13px] font-semibold leading-snug">{n.title}</div>
                {n.body && <div className="text-xs text-slate-500">{n.body}</div>}
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {new Date(n.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </Link>
            ))}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-center text-xs font-semibold text-brand-600 hover:bg-brand-50"
          >
            ดูทั้งหมด
          </Link>
        </div>
      )}
    </div>
  )
}
