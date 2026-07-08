'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { HistoryControls } from '@/components/history-controls'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiShortDate } from '@/lib/dates'
import { SWAP_STATUS_TH, type SwapStatus } from '@/lib/types'

type SwapRow = {
  id: string
  status: SwapStatus
  reason: string | null
  requester_id: string
  target_user_id: string
  requesterName: string
  targetName: string
  requesterShift: { date: string; type: string; code: string } | null
  targetShift: { date: string; type: string; code: string } | null
  created_at: string
}

type OptionShift = { id: string; scheduleId: string; teamId: string; date: string; code: string; typeName: string }
type OtherShift = OptionShift & { userId: string; userName: string }

const TONE: Record<SwapStatus, 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'violet'> = {
  pending_counterpart: 'amber',
  pending_approval: 'violet',
  approved: 'green',
  declined: 'red',
  rejected: 'red',
  cancelled: 'gray',
}

export function SwapsView() {
  const [actionable, setActionable] = useState<SwapRow[]>([])
  const [history, setHistory] = useState<SwapRow[]>([])
  const [me, setMe] = useState('')
  const [isScheduler, setIsScheduler] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [options, setOptions] = useState<{ mine: OptionShift[]; others: OtherShift[] } | null>(null)
  const [myPick, setMyPick] = useState('')
  const [theirPick, setTheirPick] = useState('')
  const [reason, setReason] = useState('')

  const [fromMonth, setFromMonth] = useState(bangkokMonthNow())
  const [toMonth, setToMonth] = useState(bangkokMonthNow())
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (fromMonth) params.set('from', fromMonth)
      if (toMonth) params.set('to', toMonth)
      const data = await api<{ actionable: SwapRow[]; history: SwapRow[]; me: string; isScheduler: boolean; total: number }>(
        `/api/swaps?${params.toString()}`,
      )
      setActionable(data.actionable)
      setHistory(data.history)
      setMe(data.me)
      setIsScheduler(data.isScheduler)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [page, fromMonth, toMonth])

  useEffect(() => { load() }, [load])

  function clearFilter() {
    setFromMonth(bangkokMonthNow())
    setToMonth(bangkokMonthNow())
    setPage(1)
  }

  async function openCreate() {
    setCreateOpen(true)
    setMyPick('')
    setTheirPick('')
    setReason('')
    setOptions(null)
    try {
      setOptions(await api<{ mine: OptionShift[]; others: OtherShift[] }>('/api/swaps/options'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดตัวเลือกไม่สำเร็จ')
    }
  }

  async function submitCreate() {
    setBusy(true)
    setError(null)
    try {
      await api('/api/swaps', {
        method: 'POST',
        body: JSON.stringify({ requesterAssignmentId: myPick, targetAssignmentId: theirPick, reason: reason || undefined }),
      })
      setCreateOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ส่งคำขอไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function act(id: string, action: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/swaps/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const myPicked = options?.mine.find((m) => m.id === myPick)
  const targets = options?.others.filter((o) => !myPicked || o.scheduleId === myPicked.scheduleId) ?? []

  const incoming = actionable.filter((s) => s.target_user_id === me && s.status === 'pending_counterpart')
  const approvals = actionable.filter((s) => s.status === 'pending_approval')

  function SwapCard({ swap }: { swap: SwapRow }) {
    return (
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ArrowLeftRight size={15} className="text-brand-600" />
            {swap.requesterName} ↔ {swap.targetName}
          </div>
          <Badge tone={TONE[swap.status]}>{SWAP_STATUS_TH[swap.status]}</Badge>
        </div>
        <div className="grid gap-1 text-[13px] text-slate-600 sm:grid-cols-2">
          <div>🔹 {swap.requesterName}: {swap.requesterShift ? `${thaiShortDate(swap.requesterShift.date)} · ${swap.requesterShift.type}` : '—'}</div>
          <div>🔸 {swap.targetName}: {swap.targetShift ? `${thaiShortDate(swap.targetShift.date)} · ${swap.targetShift.type}` : '—'}</div>
        </div>
        {swap.reason && <div className="text-xs text-slate-500">เหตุผล: {swap.reason}</div>}
        <div className="flex flex-wrap gap-2">
          {swap.status === 'pending_counterpart' && swap.target_user_id === me && (
            <>
              <Button size="sm" variant="success" disabled={busy} onClick={() => act(swap.id, 'accept')}>ตอบรับ</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act(swap.id, 'decline')}>ปฏิเสธ</Button>
            </>
          )}
          {swap.status === 'pending_approval' && isScheduler && (
            <>
              <Button size="sm" variant="success" disabled={busy} onClick={() => act(swap.id, 'approve', 'อนุมัติและปรับตารางเวรทันที?')}>อนุมัติ</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act(swap.id, 'reject')}>ไม่อนุมัติ</Button>
            </>
          )}
          {swap.status.startsWith('pending') && swap.requester_id === me && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(swap.id, 'cancel', 'ยกเลิกคำขอนี้?')}>ยกเลิกคำขอ</Button>
          )}
        </div>
      </Card>
    )
  }

  if (loading) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">ขอแลกเวร</h1>
        <Button onClick={openCreate}><Plus size={15} /> ขอแลกเวร</Button>
      </div>
      <ErrorNote error={error} />

      {incoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-amber-700">รอฉันตอบรับ ({incoming.length})</h2>
          {incoming.map((s) => <SwapCard key={s.id} swap={s} />)}
        </section>
      )}

      {isScheduler && approvals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-violet-700">รออนุมัติ ({approvals.length})</h2>
          {approvals.map((s) => <SwapCard key={s.id} swap={s} />)}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-slate-600">ประวัติการแลกเวร</h2>
        <HistoryControls
          from={fromMonth}
          to={toMonth}
          onFromChange={(v) => { setFromMonth(v); setPage(1) }}
          onToChange={(v) => { setToMonth(v); setPage(1) }}
          onClear={clearFilter}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
        />
        {history.length === 0 && <Card><EmptyState text="ไม่มีคำขอแลกเวรในช่วงที่เลือก" /></Card>}
        {history.map((s) => <SwapCard key={s.id} swap={s} />)}
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="ขอแลกเวร" wide>
        {!options ? <Spinner /> : (
          <div className="flex flex-col gap-4">
            <Field label="1) เวรของฉันที่ต้องการแลก">
              {options.mine.length === 0 ? (
                <div className="text-sm text-slate-400">คุณไม่มีเวรที่เผยแพร่แล้วในอนาคต</div>
              ) : (
                <select className={inputCls} value={myPick} onChange={(e) => { setMyPick(e.target.value); setTheirPick('') }}>
                  <option value="">— เลือกเวรของฉัน —</option>
                  {options.mine.map((m) => (
                    <option key={m.id} value={m.id}>{thaiShortDate(m.date)} · {m.typeName}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="2) เวรของเพื่อนร่วมงานที่จะแลกด้วย">
              <select className={inputCls} value={theirPick} onChange={(e) => setTheirPick(e.target.value)} disabled={!myPick}>
                <option value="">— เลือกเวรคู่แลก —</option>
                {targets.map((o) => (
                  <option key={o.id} value={o.id}>{o.userName} · {thaiShortDate(o.date)} · {o.typeName}</option>
                ))}
              </select>
            </Field>
            <Field label="เหตุผล (ไม่บังคับ)">
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ติดธุระครอบครัว" />
            </Field>
            <Button disabled={!myPick || !theirPick || busy} onClick={submitCreate}>
              ส่งคำขอแลกเวร
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
