'use client'

import { useCallback, useEffect, useState } from 'react'
import { Coins, Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { HistoryControls } from '@/components/history-controls'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiMonthLabel, thaiShortDate } from '@/lib/dates'
import { SALE_STATUS_TH, type SaleStatus } from '@/lib/types'

type SaleRow = {
  id: string
  status: SaleStatus
  reason: string | null
  seller_id: string
  buyer_id: string
  sellerName: string
  buyerName: string
  shifts: { date: string; type: string; code: string }[]
  created_at: string
  events: RequestEvent[]
}

type RequestEvent = { id: string; eventType: string; fromStatus: string | null; toStatus: string; createdAt: string }

type OptionShift = {
  id: string
  scheduleId: string
  teamId: string
  date: string
  code: string
  typeName: string
  selectable: boolean
  unavailableReason: string | null
}
type Member = { userId: string; userName: string; teamId: string }

const TONE: Record<SaleStatus, 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'violet'> = {
  pending_buyer: 'amber',
  pending_approval: 'violet',
  approved: 'green',
  declined: 'red',
  rejected: 'red',
  cancelled: 'gray',
}

function thaiDateTime(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
}

export function SalesView() {
  const [actionable, setActionable] = useState<SaleRow[]>([])
  const [history, setHistory] = useState<SaleRow[]>([])
  const [me, setMe] = useState('')
  const [isScheduler, setIsScheduler] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [optionMonth, setOptionMonth] = useState(bangkokMonthNow())
  const [options, setOptions] = useState<{ mine: OptionShift[]; members: Member[] } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [buyerId, setBuyerId] = useState('')
  const [reason, setReason] = useState('')
  const [confirmBox, setConfirmBox] = useState<{ message: string; run: () => void } | null>(null)

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
      const data = await api<{ actionable: SaleRow[]; history: SaleRow[]; me: string; isScheduler: boolean; total: number }>(
        `/api/sales?${params.toString()}`,
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

  async function loadCreateOptions(month: string) {
    setOptions(null)
    try {
      setOptions(await api<{ mine: OptionShift[]; members: Member[] }>(`/api/sales/options?month=${month}`))
    } catch (e) {
      setOptions({ mine: [], members: [] })
      setError(e instanceof Error ? e.message : 'โหลดตัวเลือกไม่สำเร็จ')
    }
  }

  async function openCreate() {
    const month = fromMonth || toMonth || bangkokMonthNow()
    setCreateOpen(true)
    setOptionMonth(month)
    setPicked(new Set())
    setBuyerId('')
    setReason('')
    setError(null)
    await loadCreateOptions(month)
  }

  async function changeOptionMonth(month: string) {
    if (!month) return
    setOptionMonth(month)
    setPicked(new Set())
    setBuyerId('')
    await loadCreateOptions(month)
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setBuyerId('')
  }

  async function submitCreate() {
    setBusy(true)
    setError(null)
    try {
      await api('/api/sales', {
        method: 'POST',
        body: JSON.stringify({ assignmentIds: [...picked], buyerId, reason: reason || undefined }),
      })
      setCreateOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ส่งคำขอไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function runAction(id: string, action: string) {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/sales/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function act(id: string, action: string, confirmText?: string) {
    if (confirmText) {
      setConfirmBox({ message: confirmText, run: () => { void runAction(id, action) } })
    } else {
      void runAction(id, action)
    }
  }

  const pickedShifts = options?.mine.filter((m) => picked.has(m.id)) ?? []
  const pickedTeamId = pickedShifts[0]?.teamId
  const buyerOptions = options?.members.filter((m) => m.teamId === pickedTeamId) ?? []
  const selectableShiftCount = options?.mine.filter((shift) => shift.selectable).length ?? 0

  const incoming = actionable.filter((s) => s.buyer_id === me && s.status === 'pending_buyer')
  const approvals = actionable.filter((s) => s.status === 'pending_approval')

  function SaleCard({ sale }: { sale: SaleRow }) {
    return (
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Coins size={15} className="text-amber-600" />
            {sale.sellerName} → {sale.buyerName} ({sale.shifts.length} เวร)
          </div>
          <Badge tone={TONE[sale.status]}>{SALE_STATUS_TH[sale.status]}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[13px] text-slate-600">
          {sale.shifts.map((s, i) => (
            <span key={i} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">
              {thaiShortDate(s.date)} · {s.type}
            </span>
          ))}
        </div>
        {sale.reason && <div className="text-xs text-slate-500">เหตุผล: {sale.reason}</div>}
        {sale.events.length > 0 && (
          <details className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold text-slate-700">ประวัติรายการ ({sale.events.length})</summary>
            <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-slate-200 pl-3">
              {sale.events.map((event) => (
                <div key={event.id}>
                  <span className="font-medium">
                    {event.fromStatus
                      ? `${SALE_STATUS_TH[event.fromStatus as SaleStatus] ?? event.fromStatus} → ${SALE_STATUS_TH[event.toStatus as SaleStatus] ?? event.toStatus}`
                      : `สร้างคำขอ · ${SALE_STATUS_TH[event.toStatus as SaleStatus] ?? event.toStatus}`}
                  </span>
                  <span className="ml-2 text-slate-400">{thaiDateTime(event.createdAt)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="flex flex-wrap gap-2">
          {sale.status === 'pending_buyer' && sale.buyer_id === me && (
            <>
              <Button size="sm" variant="success" disabled={busy} onClick={() => act(sale.id, 'accept')}>ตอบรับซื้อ</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act(sale.id, 'decline')}>ปฏิเสธ</Button>
            </>
          )}
          {sale.status === 'pending_approval' && isScheduler && (
            <>
              <Button size="sm" variant="success" disabled={busy} onClick={() => act(sale.id, 'approve', 'อนุมัติและปรับตารางเวรทันที?')}>อนุมัติ</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act(sale.id, 'reject')}>ไม่อนุมัติ</Button>
            </>
          )}
          {sale.status.startsWith('pending') && sale.seller_id === me && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(sale.id, 'cancel', 'ยกเลิกคำขอนี้?')}>ยกเลิกคำขอ</Button>
          )}
        </div>
      </Card>
    )
  }

  if (loading) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">ขายเวร</h1>
        <Button onClick={openCreate}><Plus size={15} /> ขายเวร</Button>
      </div>
      <ErrorNote error={error} />

      {incoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-amber-700">มีคนเสนอขายเวรให้ฉัน ({incoming.length})</h2>
          {incoming.map((s) => <SaleCard key={s.id} sale={s} />)}
        </section>
      )}

      {isScheduler && approvals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-violet-700">รออนุมัติ ({approvals.length})</h2>
          {approvals.map((s) => <SaleCard key={s.id} sale={s} />)}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-slate-600">ประวัติการขายเวร</h2>
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
        {history.length === 0 && <Card><EmptyState text="ไม่มีคำขอขายเวรในช่วงที่เลือก" /></Card>}
        {history.map((s) => <SaleCard key={s.id} sale={s} />)}
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="ขายเวร" wide>
        <div className="flex flex-col gap-4">
          <Field label="เดือนของเวร">
            <input
              type="month"
              className={inputCls}
              value={optionMonth}
              onChange={(e) => { void changeOptionMonth(e.target.value) }}
            />
          </Field>
          {!options ? <Spinner /> : (
            <>
            <Field label={`1) เลือกเวรที่ต้องการขาย (ทั้งหมด ${options.mine.length} เวร · เลือกได้ ${selectableShiftCount} เวร)`}>
              {options.mine.length === 0 ? (
                <div className="text-sm text-slate-400">คุณไม่มีเวรที่เผยแพร่แล้วในเดือน{thaiMonthLabel(optionMonth)}</div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-line">
                  {options.mine.map((m) => (
                    <label
                      key={m.id}
                      className={`flex items-center gap-2 border-b border-line/60 px-3 py-2 text-sm last:border-0 ${m.selectable ? 'cursor-pointer hover:bg-brand-50/50' : 'cursor-not-allowed bg-slate-50 text-slate-400'}`}
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(m.id)}
                        onChange={() => toggle(m.id)}
                        disabled={!m.selectable}
                      />
                      <span className="min-w-0 flex-1">{thaiShortDate(m.date)} · {m.typeName}</span>
                      {m.unavailableReason && (
                        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          {m.unavailableReason}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </Field>
            <Field label={`2) ผู้ซื้อ (จะได้เวรเพิ่ม ${picked.size} เวร)`}>
              <select className={inputCls} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} disabled={picked.size === 0}>
                <option value="">— เลือกผู้ซื้อ —</option>
                {buyerOptions.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.userName}</option>
                ))}
              </select>
            </Field>
            <Field label="เหตุผล (ไม่บังคับ)">
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ต้องการรายได้เสริม" />
            </Field>
            <Button disabled={picked.size === 0 || !buyerId || busy} onClick={submitCreate}>
              ส่งคำขอขายเวร
            </Button>
            </>
          )}
        </div>
      </Modal>

      <Modal open={Boolean(confirmBox)} onClose={() => setConfirmBox(null)} title="ยืนยันการดำเนินการ">
        {confirmBox && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">{confirmBox.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmBox(null)}>ยกเลิก</Button>
              <Button onClick={() => { const run = confirmBox.run; setConfirmBox(null); run() }}>ยืนยัน</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
