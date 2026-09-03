'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Coins, ExternalLink, RefreshCw, Send } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiShortDate } from '@/lib/dates'
import { useAssignmentReservationRealtime } from '@/components/swaps/use-assignment-reservation-realtime'
import type { OpenSaleListing } from '@/lib/server/open-sales'

type ListingResponse = {
  today: string
  teams: { id: string; code: string; name: string }[]
  listings: OpenSaleListing[]
  page: number
  pageSize: number
  total: number
}

type Option = {
  id: string
  scheduleId: string
  teamId: string
  date: string
  workDate?: string
  code: string
  typeName: string
  startTime: string
  endTime: string
  selectable: boolean
  unavailableReason: string | null
}
type OptionResponse = { from: string; to: string; mine: Option[]; members: { userId: string; userName: string; teamId: string }[] }

function queryString(from: string, to: string, teamId: string) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (teamId) params.set('teamId', teamId)
  params.set('pageSize', '100')
  return params.toString()
}

function SaleCard({ listing, actorId, busy, onClaim }: {
  listing: OpenSaleListing
  actorId: string
  busy: boolean
  onClaim: (id: string) => void
}) {
  const mine = listing.sellerId === actorId
  return (
    <Card className="flex flex-col gap-4 border-t-2 border-t-brand-500">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-ink">{listing.sellerName || 'สมาชิกทีม'}</h2>
            {mine && <Badge tone="violet">รายการของฉัน</Badge>}
            <Badge tone="blue">{listing.teamName || 'ทีมเวร'}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">{listing.activeShiftCount} เวรที่ยังเปิดรับ</p>
        </div>
        <Button
          size="sm"
          className="min-h-11 shrink-0"
          disabled={busy || mine}
          onClick={() => onClaim(listing.id)}
          aria-label={mine ? 'รายการของฉัน' : 'รับเวร ' + listing.activeShiftCount + ' เวร'}
        >
          <Coins size={15} aria-hidden="true" /> {mine ? 'รายการของฉัน' : 'รับเวรทั้งหมด'}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {listing.shifts.map((shift) => (
          <div key={shift.assignmentId} className="rounded-xl border border-line bg-slate-50 px-3 py-2">
            <p className="text-sm font-bold text-ink">{thaiShortDate(shift.date)} · {shift.code}</p>
            <p className="text-xs text-slate-500">{shift.typeName} · {shift.startTime}-{shift.endTime}</p>
          </div>
        ))}
      </div>
      {listing.reason && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">เหตุผล: {listing.reason}</p>}
    </Card>
  )
}

export function OpenSalesView({ actorId }: { actorId: string }) {
  // Empty bounds intentionally mean all future open shifts. A user can narrow
  // the market with either month input when needed.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [teamId, setTeamId] = useState('')
  const [data, setData] = useState<ListingResponse | null>(null)
  const [options, setOptions] = useState<OptionResponse | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api<ListingResponse>('/api/sales/open?' + queryString(from, to, teamId)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดตลาดเวรไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [from, to, teamId])

  useEffect(() => { void load() }, [load])
  useAssignmentReservationRealtime(true, load)
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, 10_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!createOpen) return
    setOptionsLoading(true)
    void api<OptionResponse>('/api/sales/options?' + queryString(from || bangkokMonthNow(), to, teamId))
      .then(setOptions)
      .catch((e) => setError(e instanceof Error ? e.message : 'โหลดเวรของคุณไม่สำเร็จ'))
      .finally(() => setOptionsLoading(false))
  }, [createOpen, from, to, teamId])

  const selectedTeamId = useMemo(() => {
    const row = options?.mine.find((item) => selected.includes(item.id))
    return row?.teamId ?? ''
  }, [options, selected])
  const selectable = useMemo(() => options?.mine.filter((item) => item.selectable) ?? [], [options?.mine])
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, Option[]>()
    for (const option of selectable) groups.set(option.date.slice(0, 7), [...(groups.get(option.date.slice(0, 7)) ?? []), option])
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [selectable])

  function toggle(id: string) {
    const optionTeamId = options?.mine.find((item) => item.id === id)?.teamId ?? ''
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= 31 || (selectedTeamId && selectedTeamId !== optionTeamId)) return current
      return [...current, id]
    })
  }

  async function createListing(event: React.FormEvent) {
    event.preventDefault()
    if (!selected.length || selected.length > 31) return
    if (!window.confirm('ยืนยันประกาศขายเวร ' + selected.length + ' เวรเป็นรายการเดียวหรือไม่')) return
    setBusy(true); setError(null); setMessage(null)
    try {
      await api('/api/sales', { method: 'POST', body: JSON.stringify({ mode: 'open', assignmentIds: selected, reason: reason || undefined }) })
      setSelected([]); setReason(''); setCreateOpen(false); setMessage('สร้างประกาศขายเวรแล้ว'); await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างประกาศไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  async function claim(id: string) {
    setBusy(true); setError(null); setMessage(null)
    setData((current) => current ? { ...current, listings: current.listings.filter((listing) => listing.id !== id) } : current)
    try {
      await api('/api/sales/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'claim' }) })
      setMessage('รับเวรแล้ว ระบบกำลังดำเนินการต่อ')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'รับเวรไม่สำเร็จ')
      await load()
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">MARKETPLACE</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">เวรเปิดขาย</h1>
          <p className="mt-1 text-sm text-slate-600">ตลาดเดียวสำหรับสมาชิกทีมที่มีสิทธิ์รับเวร · เวรวันนี้ยังรับได้ถึงสิ้นวัน</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="min-h-11"><RefreshCw size={15} aria-hidden="true" /> รีเฟรช</Button>
          <Button onClick={() => setCreateOpen((value) => !value)} className="min-h-11"><Send size={15} aria-hidden="true" /> ประกาศขายเวร</Button>
        </div>
      </div>
      <Card className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
        <Field label="ตั้งแต่เดือน"><input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="ถึงเดือน (เว้นว่าง = ทั้งหมดในอนาคต)"><input type="month" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
        <Field label="ทีม"><select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={inputCls}><option value="">ทุกทีมที่ฉันมีสิทธิ์</option>{data?.teams.map((team) => <option key={team.id} value={team.id}>{team.code} · {team.name}</option>)}</select></Field>
      </Card>
      {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div>}
      <ErrorNote error={error} />
      {createOpen && (
        <Card className="border-brand-200 bg-brand-50/40">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-bold text-ink">สร้างประกาศขายหลายเวร</h2><p className="text-xs text-slate-600">เลือกได้สูงสุด 31 เวร และต้องเป็นทีมเดียวกัน</p></div><Badge tone={selected.length === 31 ? 'amber' : 'blue'}>{selected.length}/31 เวร</Badge></div>
          {optionsLoading ? <Spinner /> : (
            <form onSubmit={createListing} className="space-y-4">
              <div className="max-h-72 space-y-4 overflow-y-auto">
                {groupedOptions.map(([month, rows]) => <section key={month}><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-700">{month}</h3><div className="grid gap-2 sm:grid-cols-2">{rows.map((row) => { const checked = selected.includes(row.id); const differentTeam = Boolean(selectedTeamId && selectedTeamId !== row.teamId); return <label key={row.id} className={'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 ' + (checked ? 'border-brand-500 bg-white' : 'border-line bg-white') + (differentTeam ? ' cursor-not-allowed opacity-50' : '')}><input type="checkbox" checked={checked} disabled={differentTeam || (!checked && selected.length >= 31)} onChange={() => toggle(row.id)} className="h-4 w-4 accent-brand-600" /><span className="min-w-0 flex-1 text-sm font-semibold">{thaiShortDate(row.date)} · {row.code} <span className="font-normal text-slate-500">{row.typeName}</span></span></label> })}</div></section>)}
                {!groupedOptions.length && <EmptyState text="ไม่มีเวรอนาคตที่พร้อมประกาศ" />}
              </div>
              <Field label="เหตุผล (ไม่บังคับ)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className={inputCls} placeholder="เช่น ติดภารกิจส่วนตัว" /></Field>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)} className="min-h-11">ยกเลิก</Button><Button type="submit" disabled={busy || selected.length === 0} className="min-h-11"><Send size={15} aria-hidden="true" /> ยืนยันประกาศ</Button></div>
            </form>
          )}
        </Card>
      )}
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-ink">รายการที่เปิดรับ</h2><span className="text-sm text-slate-500">{data?.total ?? 0} รายการ</span></div>
      {loading && !data ? <Spinner /> : data?.listings.length ? <div className="space-y-3">{data.listings.map((listing) => <SaleCard key={listing.id} listing={listing} actorId={actorId} busy={busy} onClaim={claim} />)}</div> : <Card><EmptyState text="ยังไม่มีเวรเปิดขายในช่วงที่เลือก" /></Card>}
      <p className="text-center text-xs text-slate-500"><Link href="/swaps" className="inline-flex min-h-11 items-center gap-1 text-brand-700 underline underline-offset-2"><ExternalLink size={13} aria-hidden="true" /> ดูคำขอขายแบบระบุผู้รับ</Link></p>
    </div>
  )
}
