'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Ban, CalendarDays, Check, CheckCircle2, Clock3, Inbox, Plus, Search, XCircle } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { HistoryControls } from '@/components/history-controls'
import { RequestTimeline } from '@/components/swaps/request-timeline'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiMonthLabel, thaiShortDate } from '@/lib/dates'
import { SWAP_STATUS_TH, type SwapStatus } from '@/lib/types'
import { useAssignmentReservationRealtime } from '@/components/swaps/use-assignment-reservation-realtime'

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
  events: RequestEvent[]
}

type RequestEvent = { id: string; eventType: string; fromStatus: string | null; toStatus: string; createdAt: string }

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

function thaiDateTime(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
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
  const [optionMonth, setOptionMonth] = useState(bangkokMonthNow())
  const [options, setOptions] = useState<{ mine: OptionShift[]; others: OtherShift[] } | null>(null)
  const [myPick, setMyPick] = useState('')
  const [theirPick, setTheirPick] = useState('')
  const [targetSearch, setTargetSearch] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [targetShiftCode, setTargetShiftCode] = useState('')
  const [reason, setReason] = useState('')
  const [confirmBox, setConfirmBox] = useState<{ message: string; run: () => void } | null>(null)
  const optionsRequestRef = useRef(0)

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

  async function loadCreateOptions(month: string, preserveSelections = true, silent = false) {
    const requestId = ++optionsRequestRef.current
    if (!silent) setOptions(null)
    try {
      const next = await api<{ mine: OptionShift[]; others: OtherShift[] }>(`/api/swaps/options?month=${month}`)
      if (requestId !== optionsRequestRef.current) return
      const validMineIds = new Set(next.mine.map((shift) => shift.id))
      const validOtherIds = new Set(next.others.map((shift) => shift.id))
      const currentMyPick = preserveSelections ? myPick : ''
      const currentTheirPick = preserveSelections ? theirPick : ''
      const nextMyPick = validMineIds.has(currentMyPick) ? currentMyPick : ''
      const nextTheirPick = nextMyPick && validOtherIds.has(currentTheirPick) ? currentTheirPick : ''
      if (currentMyPick && !nextMyPick) setError('เวรของคุณมีคำขอแลก/ขายค้างอยู่ จึงถูกนำออกจากรายการแล้ว')
      else if (currentTheirPick && !nextTheirPick) setError('เวรที่เลือกมีคำขอแลก/ขายค้างอยู่ จึงถูกนำออกจากรายการแล้ว')
      setMyPick(nextMyPick)
      setTheirPick(nextTheirPick)
      setOptions(next)
    } catch (e) {
      if (requestId !== optionsRequestRef.current || silent) return
      setOptions({ mine: [], others: [] })
      setError(e instanceof Error ? e.message : 'โหลดตัวเลือกไม่สำเร็จ')
    }
  }

  useAssignmentReservationRealtime(createOpen, () => { void loadCreateOptions(optionMonth, true, true) })

  async function openCreate() {
    const month = fromMonth || toMonth || bangkokMonthNow()
    setCreateOpen(true)
    setOptionMonth(month)
    setMyPick('')
    setTheirPick('')
    setTargetSearch('')
    setTargetDate('')
    setTargetShiftCode('')
    setReason('')
    setError(null)
    await loadCreateOptions(month, false)
  }

  async function changeOptionMonth(month: string) {
    if (!month) return
    setOptionMonth(month)
    setMyPick('')
    setTheirPick('')
    setTargetSearch('')
    setTargetDate('')
    setTargetShiftCode('')
    await loadCreateOptions(month, false)
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

  async function runAction(id: string, action: string) {
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

  function act(id: string, action: string, confirmText?: string) {
    if (confirmText) {
      setConfirmBox({ message: confirmText, run: () => { void runAction(id, action) } })
    } else {
      void runAction(id, action)
    }
  }

  const myPicked = options?.mine.find((m) => m.id === myPick)
  const targets = options?.others.filter((o) => !myPicked || o.scheduleId === myPicked.scheduleId) ?? []
  const targetShiftTypes = [...new Map(targets.map((target) => [target.code, target.typeName])).entries()]
  const normalizedTargetSearch = targetSearch.trim().toLocaleLowerCase('th')
  const filteredTargets = targets.filter((target) => {
    const matchesSearch = !normalizedTargetSearch || [target.userName, target.typeName, thaiShortDate(target.date)]
      .some((value) => value.toLocaleLowerCase('th').includes(normalizedTargetSearch))
    const matchesDate = !targetDate || target.date === targetDate
    const matchesShift = !targetShiftCode || target.code === targetShiftCode
    return matchesSearch && matchesDate && matchesShift
  })
  const selectedTarget = targets.find((target) => target.id === theirPick)

  const incoming = actionable.filter((s) => s.target_user_id === me && s.status === 'pending_counterpart')
  const approvals = actionable.filter((s) => s.status === 'pending_approval')

  function SwapCard({ swap, showActions = true }: { swap: SwapRow; showActions?: boolean }) {
    return (
      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <ArrowLeftRight size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">
                {swap.requesterName} <span className="font-normal text-slate-400">แลกกับ</span> {swap.targetName}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">ส่งคำขอเมื่อ {thaiDateTime(swap.created_at)}</p>
            </div>
          </div>
          <Badge tone={TONE[swap.status]}>{SWAP_STATUS_TH[swap.status]}</Badge>
        </div>

        <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch sm:px-5">
          <div className="min-w-0 rounded-xl border border-line bg-slate-50/70 p-3">
            <p className="text-[11px] font-bold tracking-wide text-slate-500">เวรของผู้ขอ</p>
            <p className="mt-1 truncate text-sm font-bold text-slate-800">{swap.requesterName}</p>
            {swap.requesterShift ? (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1"><CalendarDays size={13} className="text-brand-600" aria-hidden="true" />{thaiShortDate(swap.requesterShift.date)}</span>
                <span className="inline-flex items-center gap-1"><Clock3 size={13} className="text-brand-600" aria-hidden="true" />{swap.requesterShift.type}</span>
              </div>
            ) : <p className="mt-2 text-xs text-slate-500">ไม่พบรายละเอียดเวร</p>}
          </div>
          <div className="hidden items-center justify-center text-brand-500 sm:flex" aria-hidden="true">
            <ArrowLeftRight size={18} />
          </div>
          <div className="min-w-0 rounded-xl border border-line bg-slate-50/70 p-3">
            <p className="text-[11px] font-bold tracking-wide text-slate-500">เวรของคู่แลก</p>
            <p className="mt-1 truncate text-sm font-bold text-slate-800">{swap.targetName}</p>
            {swap.targetShift ? (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1"><CalendarDays size={13} className="text-brand-600" aria-hidden="true" />{thaiShortDate(swap.targetShift.date)}</span>
                <span className="inline-flex items-center gap-1"><Clock3 size={13} className="text-brand-600" aria-hidden="true" />{swap.targetShift.type}</span>
              </div>
            ) : <p className="mt-2 text-xs text-slate-500">ไม่พบรายละเอียดเวร</p>}
          </div>
        </div>

        {swap.reason && (
          <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-sm text-slate-600 sm:px-5">
            <span className="mt-0.5 text-slate-400">เหตุผล</span>
            <span className="min-w-0 break-words">{swap.reason}</span>
          </div>
        )}

        <RequestTimeline events={swap.events} statusLabels={SWAP_STATUS_TH} />

        {showActions && (
          <div className="flex flex-wrap gap-2 border-t border-line bg-slate-50/60 px-4 py-3 sm:px-5">
            {swap.status === 'pending_counterpart' && swap.target_user_id === me && (
              <>
                <Button size="sm" className="min-h-11" variant="success" disabled={busy} onClick={() => act(swap.id, 'accept')}><CheckCircle2 size={15} />ตอบรับ</Button>
                <Button size="sm" className="min-h-11" variant="danger" disabled={busy} onClick={() => act(swap.id, 'decline')}><XCircle size={15} />ปฏิเสธ</Button>
              </>
            )}
            {swap.status === 'pending_approval' && isScheduler && (
              <>
                <Button size="sm" className="min-h-11" variant="success" disabled={busy} onClick={() => act(swap.id, 'approve', 'อนุมัติและปรับตารางเวรทันที?')}><CheckCircle2 size={15} />อนุมัติ</Button>
                <Button size="sm" className="min-h-11" variant="danger" disabled={busy} onClick={() => act(swap.id, 'reject')}><XCircle size={15} />ไม่อนุมัติ</Button>
              </>
            )}
            {swap.status.startsWith('pending') && swap.requester_id === me && (
              <Button size="sm" className="min-h-11" variant="outline" disabled={busy} onClick={() => act(swap.id, 'cancel', 'ยกเลิกคำขอนี้?')}><Ban size={15} />ยกเลิกคำขอ</Button>
            )}
          </div>
        )}
      </Card>
    )
  }

  if (loading) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">ขอแลกเวร</h1>
          <p className="mt-1 text-sm text-slate-600">ตรวจสอบคำขอที่ต้องตอบ และดูประวัติการแลกเวรย้อนหลัง</p>
        </div>
        <Button className="min-h-11 w-full sm:w-auto" onClick={openCreate}><Plus size={16} /> ขอแลกเวร</Button>
      </div>
      <ErrorNote error={error} />

      {incoming.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Inbox size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-amber-900">รอฉันตอบรับ</h2>
              <p className="text-xs text-amber-800/80">มีคำขอแลกเวรที่ต้องตรวจสอบ</p>
            </div>
            <span className="ml-auto rounded-full bg-amber-200 px-2.5 py-1 text-xs font-bold text-amber-900">{incoming.length}</span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {incoming.map((s) => <SwapCard key={s.id} swap={s} />)}
          </div>
        </section>
      )}

      {isScheduler && approvals.length > 0 && (
        <section className="rounded-2xl border border-brand-200 bg-brand-50/50 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
              <CheckCircle2 size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-brand-900">รออนุมัติ</h2>
              <p className="text-xs text-brand-800/80">คำขอที่คู่แลกตอบรับแล้ว</p>
            </div>
            <span className="ml-auto rounded-full bg-brand-200 px-2.5 py-1 text-xs font-bold text-brand-900">{approvals.length}</span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {approvals.map((s) => <SwapCard key={s.id} swap={s} />)}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            <ArrowLeftRight size={18} className="text-brand-600" aria-hidden="true" />
            ประวัติการแลกเวร
          </h2>
          <p className="mt-1 text-sm text-slate-600">ค้นหาคำขอตามช่วงเดือน และเปิดดูรายละเอียดการดำเนินการได้</p>
        </div>
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
        {history.map((s) => <SwapCard key={s.id} swap={s} showActions={false} />)}
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="ขอแลกเวร" wide>
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
            <Field label="1) เวรของฉันที่ต้องการแลก">
              {options.mine.length === 0 ? (
                <div className="text-sm text-slate-400">คุณไม่มีเวรที่เผยแพร่แล้วในเดือน{thaiMonthLabel(optionMonth)}</div>
              ) : (
                <select className={inputCls} value={myPick} onChange={(e) => {
                  setMyPick(e.target.value)
                  setTheirPick('')
                  setTargetSearch('')
                  setTargetDate('')
                  setTargetShiftCode('')
                }}>
                  <option value="">— เลือกเวรของฉัน —</option>
                  {options.mine.map((m) => (
                    <option key={m.id} value={m.id}>{thaiShortDate(m.date)} · {m.typeName}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="2) เวรของเพื่อนร่วมงานที่จะแลกด้วย">
              {!myPick ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                  เลือกเวรของคุณก่อน ระบบจึงจะแสดงคู่เวรที่แลกได้
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-line bg-slate-50/70">
                  {selectedTarget && (
                    <div className="flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-3 py-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                        <Check size={15} strokeWidth={3} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-emerald-900">เลือก {selectedTarget.userName}</div>
                        <div className="text-xs text-emerald-700">{thaiShortDate(selectedTarget.date)} · {selectedTarget.typeName}</div>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                        onClick={() => setTheirPick('')}
                      >
                        เปลี่ยน
                      </button>
                    </div>
                  )}

                  <div className="grid gap-2 border-b border-line bg-white p-3 sm:grid-cols-[1fr_155px]">
                    <div className="relative">
                      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        className={`${inputCls} pl-9`}
                        value={targetSearch}
                        onChange={(e) => setTargetSearch(e.target.value)}
                        placeholder="ค้นหาชื่อคู่เวร"
                        aria-label="ค้นหาชื่อคู่เวร"
                      />
                    </div>
                    <input
                      type="date"
                      className={inputCls}
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                      aria-label="กรองวันที่"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-white px-3 pb-3">
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${!targetShiftCode ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      onClick={() => setTargetShiftCode('')}
                      aria-pressed={!targetShiftCode}
                    >
                      ทุกเวร
                    </button>
                    {targetShiftTypes.map(([code, typeName]) => (
                      <button
                        key={code}
                        type="button"
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${targetShiftCode === code ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        onClick={() => setTargetShiftCode(code)}
                        aria-pressed={targetShiftCode === code}
                      >
                        {typeName}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500">
                    <span>พบ {filteredTargets.length} เวร</span>
                    {(targetSearch || targetDate || targetShiftCode) && (
                      <button
                        type="button"
                        className="font-semibold text-brand-700 hover:underline"
                        onClick={() => { setTargetSearch(''); setTargetDate(''); setTargetShiftCode('') }}
                      >
                        ล้างตัวกรอง
                      </button>
                    )}
                  </div>

                  <div className="max-h-64 overflow-y-auto border-t border-line bg-white">
                    {filteredTargets.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-400">ไม่พบคู่เวรตามตัวกรอง</div>
                    ) : filteredTargets.map((target) => {
                      const selected = target.id === theirPick
                      return (
                        <button
                          key={target.id}
                          type="button"
                          className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 transition-colors ${selected ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                          onClick={() => setTheirPick(target.id)}
                          aria-pressed={selected}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-800">{target.userName}</span>
                            <span className="block text-xs text-slate-500">{thaiShortDate(target.date)}</span>
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                            {target.typeName}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </Field>
            <Field label="เหตุผล (ไม่บังคับ)">
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ติดธุระครอบครัว" />
            </Field>
            <Button disabled={!myPick || !theirPick || busy} onClick={submitCreate}>
              ส่งคำขอแลกเวร
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
