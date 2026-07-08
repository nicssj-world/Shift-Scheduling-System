'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, Card, EmptyState, Spinner } from '@/components/ui'
import { api } from '@/lib/client-api'
import type { AppNotification } from '@/lib/types'

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    const data = await api<{ notifications: AppNotification[]; unreadCount: number }>('/api/notifications?limit=100')
    setItems(data.notifications)
    setUnread(data.unreadCount)
  }, [])

  useEffect(() => { load().catch(() => setItems([])) }, [load])

  async function markAll() {
    await api('/api/notifications', { method: 'PATCH', body: JSON.stringify({ all: true }) })
    await load()
  }

  if (!items) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">การแจ้งเตือน</h1>
        {unread > 0 && <Button variant="outline" size="sm" onClick={markAll}>อ่านทั้งหมด ({unread})</Button>}
      </div>
      {items.length === 0 && <Card><EmptyState text="ยังไม่มีการแจ้งเตือน" /></Card>}
      <div className="flex flex-col gap-2">
        {items.map((n) => (
          <Link key={n.id} href={n.link ?? '#'}>
            <Card className={`hover:border-brand-300 ${n.read_at ? 'opacity-60' : 'border-brand-200'}`}>
              <div className="text-sm font-semibold">{n.title}</div>
              {n.body && <div className="text-[13px] text-slate-500">{n.body}</div>}
              <div className="mt-1 text-[11px] text-slate-400">
                {new Date(n.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
