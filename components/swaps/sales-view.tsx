'use client'

import { useCallback, useEffect, useState } from 'react'
import { Coins, Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { HistoryControls } from '@/components/history-controls'
import { api } from '@/lib/client-api'
import { thaiShortDate } from '@/lib/dates'
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
}

type OptionShift = { id: string; scheduleId: string; teamId: string; date: string; code: string; typeName: string }
type Member = { userId: string; userName: string; teamId: string }

const TONE: Record<SaleStatus, 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'violet'> = {
  pending_buyer: 'amber',
  pending_approval: 'violet',
  approved: 'green',
  declined: 'red',
  rejected: 'red',
  cancelled: 'gray',
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
  const [options, setOptions] = useState<{ mine: OptionShift[]; members: Member[] } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [buyerId, setBuyerId] = useState('')
  const [reason, setReason] = useState('')

  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
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
    setFromMonth('')
    setToMonth('')
    setPage(1)
  }

  async function openCreate() {
    setCreateOpen(true)
    setPicked(new Set())
    setBuyerId('')
    setReason('')
    setOptions(null)
    try {
      setOptions(await api<{ mine: OptionShift[]; members: Member[] }>('/api/sales/options'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดตัวเลือกไม่สำเร็จ')
    }
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

  async function act(id: string, action: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
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

  const pickedShifts = options?.mine.filter((m) => picked.has(m.id)) ?? []
  const pickedTeamId = pickedShifts[0]?.teamId
  const buyerOptions = options?.members.filter((m) => m.teamId === pickedTeamId) ?? []

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
        {!options ? <Spinner /> : (
          <div className="flex flex-col gap-4">
            <Field label="1) เลือกเวรที่ต้องการขาย (เลือกได้หลายเวร)">
              {options.mine.length === 0 ? (
                <div className="text-sm text-slate-400">คุณไม่มีเวรที่เผยแพร่แล้วในอนาคต</div>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-line">
                  {options.mine.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-2 text-sm last:border-0">
                      <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                      {thaiShortDate(m.date)} · {m.typeName}
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
          </div>
        )}
      </Modal>
    </div>
  )
}
