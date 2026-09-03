'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, CircleAlert,
  Coins, ExternalLink, ListChecks, RefreshCw, Send, Settings2, ShieldCheck,
  UserRound, Users, X,
} from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Spinner, inputCls } from '@/components/ui'
import { useLineContext } from '@/components/line/line-shell'
import { lineApi } from '@/lib/line-api'
import { bangkokDateString, bangkokMonthNow, nextMonth, previousMonth, thaiMonthLabel, thaiShortDate } from '@/lib/dates'
import { SALE_STATUS_TH, SWAP_STATUS_TH } from '@/lib/types'
import { useAssignmentReservationRealtime } from '@/components/swaps/use-assignment-reservation-realtime'

type Assignment = {
  id: string
  scheduleId: string
  teamId: string
  workDate: string
  shiftTypeId: string
  code: string
  typeName: string
  startTime: string
  endTime: string
  userId: string
  userName: string
  mine: boolean
}

type ScheduleResponse = {
  month: string
  today: string
  teams: { id: string; code: string; name: string }[]
  members?: { userId: string; userName: string; teamId: string }[]
  schedules: { id: string; teamId: string; status: string }[]
  assignments: Assignment[]
}

type RequestResponse = {
  received: Record<string, unknown>[]
  sent: Record<string, unknown>[]
  sales: Record<string, unknown>[]
  approvals?: { swaps: Record<string, unknown>[]; sales: Record<string, unknown>[] }
}

type OpenSale = {
  id: string
  sellerId: string
  sellerName: string
  reason: string | null
  status: string
  saleMode: 'open'
  createdAt: string
  teamId: string
  teamName?: string
  activeShiftCount?: number
  shifts: { assignmentId: string; date: string; code: string; typeName: string }[]
}
type OpenSaleOption = {
  id: string
  scheduleId: string
  teamId: string
  workDate: string
  code: string
  typeName: string
  startTime: string
  endTime: string
  selectable: boolean
  unavailableReason: string | null
}
type OpenSaleOptionsResponse = {
  from: string
  to: string
  today: string
  teams: { id: string; code: string; name: string }[]
  members: { userId: string; userName: string; teamId: string }[]
  mine: OpenSaleOption[]
}
type DailyRoster = { date: string; teams: { teamId: string; teamName: string; shifts: { id: string; userName: string; code: string; typeName: string; startTime: string; endTime: string; phone: string | null }[] }[] }

function useResource<T>(path: string) {
  const [value, setValue] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    void lineApi<T>(path)
      .then((result) => { if (active) setValue(result) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลไม่สำเร็จ') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [path])
  useEffect(() => reload(), [reload])
  return { value, loading, error, reload }
}

function PageHeading({ eyebrow, title, description, icon: Icon }: {
  eyebrow: string
  title: string
  description?: string
  icon: typeof CalendarDays
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-800"><Icon size={22} /></div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-700">{eyebrow}</p>
        <h1 className="mt-0.5 text-xl font-extrabold tracking-tight text-[#0c2f4a]">{title}</h1>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
    </div>
  )
}

function MonthPicker({ month, onChange }: { month: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" onClick={() => onChange(previousMonth(month))} aria-label="เดือนก่อนหน้า"><ChevronLeft size={18} /></button>
      <label className="flex flex-1 items-center justify-center"><span className="sr-only">เดือน</span><input type="month" value={month} onChange={(event) => onChange(event.target.value)} className="min-h-10 min-w-0 border-0 bg-transparent text-center text-sm font-bold text-[#0c2f4a] outline-none" /></label>
      <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" onClick={() => onChange(nextMonth(month))} aria-label="เดือนถัดไป"><ChevronRight size={18} /></button>
    </div>
  )
}

function AssignmentRow({ assignment, compact = false }: { assignment: Assignment; compact?: boolean }) {
  const weekday = new Date(`${assignment.workDate}T00:00:00Z`).toLocaleDateString('th-TH', { weekday: 'short', timeZone: 'UTC' })
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm ${assignment.mine ? 'ring-1 ring-cyan-200' : ''}`}>
      <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-[#0c2f4a] py-2 text-white"><span className="text-[10px] text-cyan-200">{weekday}</span><span className="text-base font-extrabold">{Number(assignment.workDate.slice(-2))}</span></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className="font-extrabold text-[#0c2f4a]">{assignment.code}</span><span className="text-xs text-slate-500">{assignment.typeName}</span>{assignment.mine && <Badge tone="green">ของฉัน</Badge>}</div><p className="mt-0.5 truncate text-xs text-slate-500">{assignment.userName || 'ไม่ระบุชื่อ'} · {assignment.startTime}-{assignment.endTime}</p></div>
      {!compact && <span className="hidden text-[11px] font-semibold text-slate-400 sm:block">{thaiShortDate(assignment.workDate)}</span>}
    </div>
  )
}

function GroupedAssignments({ assignments }: { assignments: Assignment[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    for (const assignment of assignments) map.set(assignment.workDate, [...(map.get(assignment.workDate) ?? []), assignment])
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [assignments])
  if (grouped.length === 0) return <EmptyState text="ยังไม่มีเวรในช่วงที่เลือก" />
  return (
    <div className="space-y-4">
      {grouped.map(([date, rows]) => (
        <section key={date}>
          <div className="mb-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-cyan-500" /><h2 className="text-xs font-extrabold text-[#0c2f4a]">{thaiShortDate(date)}</h2></div>
          <div className="space-y-2">{rows.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} />)}</div>
        </section>
      ))}
    </div>
  )
}

function ScheduleView({ mineOnly = false }: { mineOnly?: boolean }) {
  const [month, setMonth] = useState(bangkokMonthNow())
  const [team, setTeam] = useState('')
  const resource = useResource<ScheduleResponse>(`/api/line/schedule?month=${encodeURIComponent(month)}${team ? `&team=${encodeURIComponent(team)}` : ''}`)
  const assignments = resource.value?.assignments.filter((row) => !mineOnly || row.mine) ?? []
  return (
    <div>
      <PageHeading eyebrow={mineOnly ? 'MY SHIFTS' : 'ROSTER'} title={mineOnly ? 'เวรของฉัน' : 'ตารางเวร'} description={mineOnly ? 'เวรที่ผูกกับบัญชีของคุณในเดือนนี้' : 'ดูเวรที่ประกาศแล้วจากทีมที่คุณเข้าถึงได้'} icon={mineOnly ? UserRound : CalendarDays} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]"><MonthPicker month={month} onChange={setMonth} />{!mineOnly && <select value={team} onChange={(event) => setTeam(event.target.value)} className={inputCls}><option value="">ทุกทีม</option>{resource.value?.teams.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>}</div>
      {resource.loading && <Spinner />}
      {!resource.loading && <ErrorNote error={resource.error} />}
      {!resource.loading && !resource.error && <Card className="bg-[#eef8fc]/80"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold text-slate-500">{resource.value?.month ? thaiMonthLabel(resource.value.month) : month}</p><span className="text-[11px] text-slate-400">{assignments.length} เวร</span></div><GroupedAssignments assignments={assignments} /></Card>}
    </div>
  )
}

function DashboardView() {
  const { actor, settings } = useLineContext()
  const schedule = useResource<ScheduleResponse>(`/api/line/schedule?month=${bangkokMonthNow()}`)
  const requests = useResource<RequestResponse>('/api/line/requests')
  const today = schedule.value?.today ?? ''
  const upcoming = (schedule.value?.assignments ?? []).filter((row) => row.mine && row.workDate >= today).slice(0, 4)
  const pending = (requests.value?.received ?? []).filter((row) => String(row.status).startsWith('pending')).length + (requests.value?.sales ?? []).filter((row) => String(row.status).startsWith('pending')).length + (requests.value?.approvals?.swaps.length ?? 0) + (requests.value?.approvals?.sales.length ?? 0)
  return (
    <div>
      <div className="relative mb-5 overflow-hidden rounded-[28px] bg-[#0c2f4a] p-5 text-white shadow-xl shadow-cyan-900/15"><div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-cyan-400/20" /><div className="relative"><p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">SHIFT SCHEDULER · LINE</p><h1 className="mt-2 text-2xl font-extrabold">สวัสดี {actor.name}</h1><p className="mt-1 max-w-xs text-sm leading-6 text-slate-200">เช็กเวร แลกเวร และรับประกาศขายได้ในที่เดียว</p><div className="mt-5 grid grid-cols-3 gap-2"><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] text-cyan-100">เวรเดือนนี้</p><p className="mt-1 text-xl font-extrabold">{schedule.value?.assignments.filter((row) => row.mine).length ?? '—'}</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] text-cyan-100">คำขอรอ</p><p className="mt-1 text-xl font-extrabold">{requests.loading ? '—' : pending}</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] text-cyan-100">สถานะ</p><p className="mt-1 text-sm font-extrabold text-emerald-200">เชื่อมแล้ว</p></div></div></div></div>
      <div className="mb-5 grid grid-cols-2 gap-2"><Link href="/line/swap" className="flex min-h-20 flex-col justify-between rounded-2xl bg-cyan-500 p-4 text-sm font-extrabold text-white shadow-lg shadow-cyan-500/20"><ArrowLeftRight size={20} /><span>ขอแลกเวร</span></Link><Link href="/line/sell" className="flex min-h-20 flex-col justify-between rounded-2xl bg-emerald-600 p-4 text-sm font-extrabold text-white shadow-lg shadow-emerald-600/20"><Coins size={20} /><span>ขาย / รับเวร</span></Link></div>
      <Card><div className="mb-3 flex items-center justify-between"><h2 className="font-extrabold text-[#0c2f4a]">เวรถัดไป</h2><Link href="/line/my-shifts" className="text-xs font-bold text-cyan-700">ดูทั้งหมด</Link></div>{schedule.loading ? <Spinner /> : <div className="space-y-2">{upcoming.length ? upcoming.map((row) => <AssignmentRow key={row.id} assignment={row} compact />) : <EmptyState text="ไม่มีเวรที่กำลังจะมาถึง" />}</div>}</Card>
      {!settings.dailyRosterEnabled && <div className="mt-4 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"><CircleAlert size={17} className="mt-0.5 shrink-0" />ฟีเจอร์สรุปเวรรายวันจะเปิดเมื่อผู้ดูแลระบบอนุมัติ</div>}
    </div>
  )
}

function TodayView() {
  const [date, setDate] = useState(bangkokDateString())
  const resource = useResource<DailyRoster>(`/api/line/daily-roster?date=${encodeURIComponent(date)}`)
  return (
    <div>
      <PageHeading eyebrow="TODAY" title="เวรวันนี้" description="ดูรายชื่อเวรของทุกทีมที่ประกาศแล้ว" icon={Users} />
      <div className="mb-4"><label className="mb-1 block text-xs font-bold text-slate-500">วันที่</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputCls} /></div>
      {resource.loading && <Spinner />}{resource.error && <ErrorNote error={resource.error} />}
      {!resource.loading && !resource.error && <div className="space-y-3">{resource.value?.teams.length ? resource.value.teams.map((team) => <Card key={team.teamId}><h2 className="mb-3 font-extrabold text-[#0c2f4a]">{team.teamName}</h2><div className="space-y-2">{team.shifts.map((shift) => <div key={shift.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><p className="font-extrabold text-[#0c2f4a]">{shift.code} <span className="text-xs font-normal text-slate-500">{shift.typeName}</span></p><p className="text-xs text-slate-500">{shift.userName} · {shift.startTime}-{shift.endTime}</p></div></div>)}</div></Card>) : <Card><EmptyState text="ไม่มีข้อมูลเวรสำหรับวันที่เลือก" /></Card>}</div>}
    </div>
  )
}

function SwapView() {
  const { settings } = useLineContext()
  const [month, setMonth] = useState(bangkokMonthNow())
  const resource = useResource<ScheduleResponse>(`/api/line/schedule?month=${encodeURIComponent(month)}`)
  const [mineId, setMineId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mine = resource.value?.assignments.filter((row) => row.mine && row.workDate >= (resource.value?.today ?? '')) ?? []
  const selectedMine = mine.find((row) => row.id === mineId)
  const targets = resource.value?.assignments.filter((row) => !row.mine && row.teamId === selectedMine?.teamId && row.workDate >= (resource.value?.today ?? '')) ?? []
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!mineId || !targetId) return
    setBusy(true); setMessage(null)
    try {
      await lineApi('/api/line/swaps', { method: 'POST', body: JSON.stringify({ requesterAssignmentId: mineId, targetAssignmentId: targetId, reason: reason || undefined }) })
      setMessage('ส่งคำขอแลกเวรแล้ว'); setMineId(''); setTargetId(''); setReason('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'ส่งคำขอไม่สำเร็จ') } finally { setBusy(false) }
  }
  return (
    <div>
      <PageHeading eyebrow="SWAP" title="ขอแลกเวร" description="เลือกเวรของคุณและเวรของเพื่อนร่วมทีมในตารางเดียวกัน" icon={ArrowLeftRight} />
      {!settings.swapEnabled && <ErrorNote error="ผู้ดูแลระบบยังไม่เปิดการแลกเวรผ่าน LINE" />}
      <div className="mb-4"><MonthPicker month={month} onChange={(value) => { setMonth(value); setMineId(''); setTargetId('') }} /></div>
      {resource.loading && <Spinner />}{resource.error && <ErrorNote error={resource.error} />}
      {!resource.loading && !resource.error && <Card><form onSubmit={submit} className="space-y-4"><Field label="เวรของฉัน"><select required value={mineId} onChange={(event) => { setMineId(event.target.value); setTargetId('') }} className={inputCls}><option value="">เลือกเวรที่ต้องการแลก</option>{mine.map((row) => <option key={row.id} value={row.id}>{thaiShortDate(row.workDate)} · {row.code} {row.typeName}</option>)}</select></Field><Field label="เวรของเพื่อนร่วมทีม"><select required value={targetId} onChange={(event) => setTargetId(event.target.value)} className={inputCls} disabled={!mineId}><option value="">เลือกเวรปลายทาง</option>{targets.map((row) => <option key={row.id} value={row.id}>{thaiShortDate(row.workDate)} · {row.userName} · {row.code}</option>)}</select></Field><Field label="เหตุผล (ไม่บังคับ)"><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} className={inputCls} placeholder="เช่น ติดภารกิจส่วนตัว" /></Field>{message && <p className="rounded-xl bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">{message}</p>}<Button type="submit" disabled={busy || !settings.swapEnabled || !mineId || !targetId} className="w-full justify-center"><Send size={16} />{busy ? 'กำลังส่ง…' : 'ส่งคำขอแลกเวร'}</Button></form></Card>}
    </div>
  )
}

type OpenSalesResponse = {
  teams?: { id: string; code: string; name: string }[]
  listings?: OpenSale[]
  sales?: OpenSale[]
  total?: number
}

function OpenSalesView() {
  const { actor, settings } = useLineContext()
  // Empty bounds intentionally mean all future open shifts. A user can narrow
  // the market with either month input when needed.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [teamId, setTeamId] = useState('')
  const [hidden, setHidden] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const path = useMemo(() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (teamId) params.set('teamId', teamId)
    return '/api/line/sales/open?' + params.toString()
  }, [from, to, teamId])
  const resource = useResource<OpenSalesResponse>(path)
  const listings = (resource.value?.listings ?? resource.value?.sales ?? []).filter((sale) => !hidden.includes(sale.id))

  useAssignmentReservationRealtime(true, resource.reload)
  useEffect(() => {
    const timer = window.setInterval(() => resource.reload(), 10_000)
    return () => window.clearInterval(timer)
  }, [resource.reload])

  async function claim(id: string) {
    setBusy(true); setMessage(null); setHidden((current) => [...current, id])
    try {
      await lineApi('/api/line/sales/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'claim' }) })
      setMessage('รับเวรแล้ว ระบบกำลังดำเนินการต่อ')
      resource.reload()
    } catch (error) {
      setHidden((current) => current.filter((item) => item !== id))
      setMessage(error instanceof Error ? error.message : 'รับเวรไม่สำเร็จ')
      resource.reload()
    } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeading eyebrow="MARKETPLACE" title="เวรเปิดขาย" description="ตลาดเดียวของทีมที่คุณเป็นสมาชิก เวรวันนี้รับได้ถึงสิ้นวัน" icon={Coins} />
      {!settings.saleEnabled && <ErrorNote error="ผู้ดูแลระบบยังไม่เปิดการขายเวรผ่าน LINE" />}
      {(!settings.openSaleEnabled || !settings.openMarketEnabled) && <ErrorNote error="ผู้ดูแลระบบยังไม่เปิดตลาดเวรเปิดขายผ่าน LINE" />}
      <Card className="mb-4 grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="ตั้งแต่เดือน"><input type="month" value={from} onChange={(e) => { setFrom(e.target.value); setHidden([]) }} className={inputCls} /></Field>
          <Field label="ถึงเดือน"><input type="month" value={to} onChange={(e) => { setTo(e.target.value); setHidden([]) }} className={inputCls} /></Field>
        </div>
        <Field label="ทีม"><select value={teamId} onChange={(e) => { setTeamId(e.target.value); setHidden([]) }} className={inputCls}><option value="">ทุกทีมที่ฉันมีสิทธิ์</option>{resource.value?.teams?.map((team) => <option key={team.id} value={team.id}>{team.code} · {team.name}</option>)}</select></Field>
      </Card>
      {message && <p role="status" className="mb-4 rounded-xl bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">{message}</p>}
      {resource.loading && !resource.value && <Spinner />}
      {resource.error && <ErrorNote error={resource.error} />}
      {!resource.loading && !resource.error && (
        listings.length ? <div className="space-y-3">{listings.map((sale) => {
          const mine = sale.sellerId === actor.id
          return <Card key={sale.id} className="space-y-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="font-extrabold text-[#0c2f4a]">{sale.sellerName || 'สมาชิกทีม'}</p>{mine && <Badge tone="violet">รายการของฉัน</Badge>}{sale.teamName && <Badge tone="blue">{sale.teamName}</Badge>}</div><p className="mt-1 text-xs text-slate-500">{sale.activeShiftCount ?? sale.shifts.length} เวรที่ยังเปิดรับ</p></div><Button size="sm" className="min-h-11 shrink-0" disabled={busy || mine || !settings.openSaleEnabled || !settings.openMarketEnabled} onClick={() => claim(sale.id)}>{mine ? 'รายการของฉัน' : 'รับเวรทั้งหมด'}</Button></div><div className="grid gap-2">{sale.shifts.map((shift) => <div key={shift.assignmentId} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-sm font-extrabold text-[#0c2f4a]">{thaiShortDate(shift.date)} · {shift.code}</p><p className="text-xs text-slate-500">{shift.typeName}</p></div>)}</div>{sale.reason && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{sale.reason}</p>}</Card>
        })}</div> : <Card><EmptyState text="ยังไม่มีเวรเปิดขายในช่วงที่เลือก" /></Card>
      )}
    </div>
  )
}

function SellView() {
  return <SellMarketplaceView />
  /*
  const { actor, settings } = useLineContext()
  const [month, setMonth] = useState(bangkokMonthNow())
  const schedule = useResource<ScheduleResponse>(`/api/line/schedule?month=${encodeURIComponent(month)}`)
  const open = useResource<{ month: string; sales: OpenSale[] }>(`/api/line/sales/open?month=${encodeURIComponent(month)}`)
  const [mode, setMode] = useState<'direct' | 'open'>('open')
  const [selected, setSelected] = useState<string[]>([])
  const [buyerId, setBuyerId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mine = schedule.value?.assignments.filter((row) => row.mine && row.workDate >= (schedule.value?.today ?? '')) ?? []
  const selectedTeamId = mine.find((item) => selected.includes(item.id))?.teamId
  const buyers = (schedule.value?.members ?? []).filter((member) => member.teamId === selectedTeamId).map((member) => [member.userId, member.userName] as const)
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) }
  async function createSale(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null)
    try {
      await lineApi('/api/line/sales', { method: 'POST', body: JSON.stringify({ mode, assignmentIds: selected, buyerId: mode === 'direct' ? buyerId : undefined, reason: reason || undefined }) })
      setMessage(mode === 'open' ? 'ประกาศขายเวรแล้ว' : 'ส่งข้อเสนอขายให้ผู้รับแล้ว'); setSelected([]); setBuyerId(''); setReason(''); open.reload()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'สร้างคำขอขายไม่สำเร็จ') } finally { setBusy(false) }
  }
  async function claim(id: string) {
    setBusy(true); setMessage(null)
    try { await lineApi(`/api/line/sales/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'claim' }) }); setMessage('รับเวรสำเร็จ ระบบกำลังดำเนินการต่อ'); open.reload() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'รับเวรไม่สำเร็จ') } finally { setBusy(false) }
  }
  return (
    <div>
      <PageHeading eyebrow="SELL / CLAIM" title="ขายหรือรับเวร" description="ส่งข้อเสนอแบบระบุผู้รับ หรือประกาศให้สมาชิกในทีมกดรับคนแรก" icon={Coins} />
      <Link href="/line/open-sales" className="mb-4 flex min-h-11 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 text-sm font-bold text-cyan-800">ดูตลาดเวรเปิดขายทั้งหมด</Link>
      {!settings.saleEnabled && <ErrorNote error="ผู้ดูแลระบบยังไม่เปิดการขายเวรผ่าน LINE" />}
      <div className="mb-4"><MonthPicker month={month} onChange={(value) => { setMonth(value); setSelected([]) }} /></div>
      <Card className="mb-5">
        <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setMode('open')} className={`min-h-10 rounded-lg text-sm font-bold ${mode === 'open' ? 'bg-white text-[#0c2f4a] shadow-sm' : 'text-slate-500'}`}>ประกาศรับคนแรก</button><button type="button" onClick={() => setMode('direct')} className={`min-h-10 rounded-lg text-sm font-bold ${mode === 'direct' ? 'bg-white text-[#0c2f4a] shadow-sm' : 'text-slate-500'}`}>ระบุผู้รับ</button></div>
        <form onSubmit={createSale} className="space-y-4">
          <Field label="เลือกเวรของฉัน"><div className="max-h-56 space-y-2 overflow-y-auto">{mine.length ? mine.map((row) => <label key={row.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${selected.includes(row.id) ? 'border-cyan-400 bg-cyan-50' : 'border-slate-100'}`}><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} className="h-4 w-4 accent-cyan-600" /><span className="min-w-0 flex-1 text-sm font-semibold">{thaiShortDate(row.workDate)} · {row.code} {row.typeName}</span></label>) : <p className="text-sm text-slate-500">ไม่มีเวรที่เลือกขายได้</p>}</div></Field>
          {mode === 'direct' && <Field label="ผู้รับเวร"><select required value={buyerId} onChange={(event) => setBuyerId(event.target.value)} className={inputCls}><option value="">เลือกสมาชิกทีม</option>{buyers.filter(([id]) => id !== actor.id).map(([id, name]) => <option key={id} value={id}>{name || id}</option>)}</select></Field>}
          <Field label="รายละเอียด (ไม่บังคับ)"><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} className={inputCls} placeholder="ระบุรายละเอียดเพิ่มเติม" /></Field>
          {message && <p className="rounded-xl bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">{message}</p>}
           <Button type="submit" disabled={busy || !settings.saleEnabled || (mode === 'open' && (!settings.openSaleEnabled || !settings.openMarketEnabled)) || selected.length === 0 || (mode === 'direct' && !buyerId)} className="w-full justify-center"><Send size={16} />{busy ? 'กำลังบันทึก…' : mode === 'open' ? 'ประกาศขายเวร' : 'ส่งข้อเสนอขาย'}</Button>
        </form>
      </Card>
      <div><div className="mb-3 flex items-center justify-between"><h2 className="font-extrabold text-[#0c2f4a]">ประกาศที่เปิดรับ</h2><span className="text-xs text-slate-400">{open.value?.sales.length ?? 0} รายการ</span></div>{open.loading ? <Spinner /> : open.error ? <ErrorNote error={open.error} /> : open.value?.sales.length ? <div className="space-y-3">{open.value.sales.map((sale) => <Card key={sale.id}><div className="flex items-start justify-between gap-3"><div><p className="font-extrabold text-[#0c2f4a]">{sale.sellerName || 'สมาชิกทีม'} <span className="font-normal text-slate-500">ประกาศ</span></p><p className="mt-1 text-xs text-slate-500">{sale.shifts.map((shift) => `${thaiShortDate(shift.date)} · ${shift.code}`).join('  /  ')}</p>{sale.reason && <p className="mt-2 text-xs text-slate-600">{sale.reason}</p>}</div><Button size="sm" onClick={() => claim(sale.id)} disabled={busy || sale.sellerId === actor.id}>รับเวร</Button></div></Card>)}</div> : <Card><EmptyState text="ยังไม่มีประกาศขายเวรในเดือนนี้" /></Card>}</div>
    </div>
  )
}

  */
}

/** LINE's sale form shares the open-sale API with the web marketplace. It
 * deliberately loads a month range so one listing can span multiple months,
 * while direct sales keep the legacy single-month schedule picker. */
function SellMarketplaceView() {
  const { actor, settings } = useLineContext()
  const [month, setMonth] = useState(bangkokMonthNow())
  const [toMonth, setToMonth] = useState('')
  const [mode, setMode] = useState<'direct' | 'open'>('open')
  const [selected, setSelected] = useState<string[]>([])
  const [buyerId, setBuyerId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const schedule = useResource<ScheduleResponse>(`/api/line/schedule?month=${encodeURIComponent(month)}`)
  const openOptionsPath = useMemo(() => {
    const params = new URLSearchParams({ from: month })
    if (toMonth) params.set('to', toMonth)
    return `/api/line/sales/options?${params.toString()}`
  }, [month, toMonth])
  const openOptions = useResource<OpenSaleOptionsResponse>(openOptionsPath)

  const directMine = schedule.value?.assignments.filter((row) => row.mine && row.workDate >= (schedule.value?.today ?? '')) ?? []
  const openMine = openOptions.value?.mine.filter((row) => row.selectable) ?? []
  const available = mode === 'open' ? openMine : directMine
  const selectedTeamId = available.find((item) => selected.includes(item.id))?.teamId ?? ''
  const members = mode === 'open' ? (openOptions.value?.members ?? []) : (schedule.value?.members ?? [])
  const buyers = members.filter((member) => member.teamId === selectedTeamId && member.userId !== actor.id)
  const groupedOpenMine = (() => {
    const groups = new Map<string, OpenSaleOption[]>()
    for (const row of openMine) groups.set(row.workDate.slice(0, 7), [...(groups.get(row.workDate.slice(0, 7)) ?? []), row])
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  })()

  useEffect(() => {
    setSelected([])
    setBuyerId('')
  }, [mode, month, toMonth])

  function toggle(id: string, teamId: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= 31 || (selectedTeamId && selectedTeamId !== teamId)) return current
      return [...current, id]
    })
  }

  async function createSale(event: React.FormEvent) {
    event.preventDefault()
    if (!selected.length || selected.length > 31) return
    if (mode === 'open' && !settings.openMarketEnabled) return
    if (!window.confirm(`ยืนยันประกาศขาย ${selected.length} เวรเป็นรายการเดียวหรือไม่`)) return
    setBusy(true); setMessage(null)
    try {
      await lineApi('/api/line/sales', { method: 'POST', body: JSON.stringify({ mode, assignmentIds: selected, buyerId: mode === 'direct' ? buyerId : undefined, reason: reason || undefined }) })
      setMessage(mode === 'open' ? 'ประกาศขายเวรแล้ว' : 'ส่งข้อเสนอขายให้ผู้รับแล้ว')
      setSelected([]); setBuyerId(''); setReason('')
      schedule.reload(); openOptions.reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'สร้างคำขอขายไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  const formLoading = mode === 'open' ? openOptions.loading && !openOptions.value : schedule.loading && !schedule.value
  const formError = mode === 'open' ? openOptions.error : schedule.error
  return (
    <div>
      <PageHeading eyebrow="SELL" title="ประกาศขายเวร" description="เลือกเวรของคุณได้สูงสุด 31 เวรในทีมเดียวกัน และข้ามเดือนได้" icon={Coins} />
      <Link href="/line/open-sales" className="mb-4 flex min-h-11 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 text-sm font-bold text-cyan-800">ดูตลาดเวรเปิดขาย</Link>
      {!settings.saleEnabled && <ErrorNote error="ผู้ดูแลระบบยังไม่เปิดการขายเวรผ่าน LINE" />}
      <Card className="mb-5">
        <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setMode('open')} className={`min-h-10 rounded-lg text-sm font-bold ${mode === 'open' ? 'bg-white text-[#0c2f4a] shadow-sm' : 'text-slate-500'}`}>ประกาศรับคนแรก</button>
          <button type="button" onClick={() => setMode('direct')} className={`min-h-10 rounded-lg text-sm font-bold ${mode === 'direct' ? 'bg-white text-[#0c2f4a] shadow-sm' : 'text-slate-500'}`}>ระบุผู้รับ</button>
        </div>
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs font-bold text-slate-500">ตั้งแต่เดือน</label><MonthPicker month={month} onChange={setMonth} /></div>
          {mode === 'open' && <Field label="ถึงเดือน (เว้นว่าง = อนาคตทั้งหมด)"><input type="month" value={toMonth} onChange={(event) => setToMonth(event.target.value)} className={inputCls} /></Field>}
        </div>
        {formLoading && <Spinner />}
        {formError && <ErrorNote error={formError} />}
        {!formLoading && !formError && <form onSubmit={createSale} className="space-y-4">
          <Field label={`เลือกเวรของฉัน (${selected.length}/31)`}>
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {mode === 'open' ? groupedOpenMine.map(([monthKey, rows]) => <section key={monthKey}><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-700">{monthKey}</h3><div className="space-y-2">{rows.map((row) => { const checked = selected.includes(row.id); const differentTeam = Boolean(selectedTeamId && selectedTeamId !== row.teamId); return <label key={row.id} className={`flex min-h-11 items-center gap-3 rounded-xl border p-3 ${checked ? 'border-cyan-400 bg-cyan-50' : 'border-slate-100'} ${differentTeam ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}><input type="checkbox" checked={checked} disabled={differentTeam || (!checked && selected.length >= 31)} onChange={() => toggle(row.id, row.teamId)} className="h-4 w-4 accent-cyan-600" /><span className="min-w-0 flex-1 text-sm font-semibold">{thaiShortDate(row.workDate)} · {row.code} <span className="font-normal text-slate-500">{row.typeName}</span></span></label> })}</div></section>) : directMine.map((row) => { const checked = selected.includes(row.id); const differentTeam = Boolean(selectedTeamId && selectedTeamId !== row.teamId); return <label key={row.id} className={`flex min-h-11 items-center gap-3 rounded-xl border p-3 ${checked ? 'border-cyan-400 bg-cyan-50' : 'border-slate-100'} ${differentTeam ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}><input type="checkbox" checked={checked} disabled={differentTeam || (!checked && selected.length >= 31)} onChange={() => toggle(row.id, row.teamId)} className="h-4 w-4 accent-cyan-600" /><span className="min-w-0 flex-1 text-sm font-semibold">{thaiShortDate(row.workDate)} · {row.code} <span className="font-normal text-slate-500">{row.typeName}</span></span></label> })}
              {available.length === 0 && <EmptyState text="ไม่มีเวรอนาคตที่เลือกขายได้" />}
            </div>
          </Field>
          {mode === 'direct' && <Field label="ผู้รับเวร"><select required value={buyerId} onChange={(event) => setBuyerId(event.target.value)} className={inputCls}><option value="">เลือกสมาชิกทีม</option>{buyers.map((member) => <option key={member.userId} value={member.userId}>{member.userName || member.userId}</option>)}</select></Field>}
          <Field label="เหตุผล (ไม่บังคับ)"><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} className={inputCls} /></Field>
          {message && <p role="status" className="rounded-xl bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">{message}</p>}
          <Button type="submit" disabled={busy || !settings.saleEnabled || (mode === 'open' && (!settings.openSaleEnabled || !settings.openMarketEnabled)) || selected.length === 0 || (mode === 'direct' && !buyerId)} className="min-h-11 w-full justify-center"><Send size={16} />{busy ? 'กำลังบันทึก…' : mode === 'open' ? 'ยืนยันประกาศขาย' : 'ส่งข้อเสนอขาย'}</Button>
        </form>}
      </Card>
      <p className="text-center text-xs text-slate-500">การรับเวรเปิดขายทำได้จากหน้าตลาด และระบบจะตรวจสอบกฎการจัดเวรทั้งหมดก่อนโอน</p>
    </div>
  )
}

function RequestsView() {
  const { actor } = useLineContext()
  const resource = useResource<RequestResponse>('/api/line/requests')
  const [busy, setBusy] = useState<string | null>(null)
  async function act(kind: 'swaps' | 'sales', id: string, action: string) {
    setBusy(`${kind}:${id}:${action}`)
    try { await lineApi(`/api/line/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }); resource.reload() }
    catch (error) { window.alert(error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ') }
    finally { setBusy(null) }
  }
  function actionsFor(kind: 'swaps' | 'sales', row: Record<string, unknown>, incoming: boolean) {
    const status = String(row.status)
    const actions: { label: string; value: string; variant: 'success' | 'danger' | 'outline' }[] = []
    if (kind === 'swaps' && incoming && status === 'pending_counterpart') actions.push({ label: 'รับ', value: 'accept', variant: 'success' }, { label: 'ปฏิเสธ', value: 'decline', variant: 'danger' })
    if (kind === 'sales' && incoming && status === 'pending_buyer') actions.push({ label: 'รับซื้อ', value: 'accept', variant: 'success' }, { label: 'ปฏิเสธ', value: 'decline', variant: 'danger' })
    if (actor.isScheduler && status === 'pending_approval') actions.push({ label: 'อนุมัติ', value: 'approve', variant: 'success' }, { label: 'ไม่อนุมัติ', value: 'reject', variant: 'danger' })
    if (!incoming && (status === 'pending_counterpart' || status === 'pending_buyer' || status === 'open')) actions.push({ label: 'ยกเลิก', value: 'cancel', variant: 'outline' })
    return actions
  }
  function RequestCard({ kind, row, incoming }: { kind: 'swaps' | 'sales'; row: Record<string, unknown>; incoming: boolean }) {
    const status = String(row.status)
    const labels = kind === 'swaps' ? SWAP_STATUS_TH : SALE_STATUS_TH
    const mode = kind === 'sales' && String(row.sale_mode ?? 'direct') === 'open' ? ' · เปิดรับคนแรก' : ''
    const tone = status === 'approved' ? 'green' : status === 'declined' || status === 'rejected' ? 'red' : status === 'cancelled' ? 'gray' : 'amber'
    const actions = actionsFor(kind, row, incoming)
    return <Card><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{incoming ? 'รับเข้า' : 'ส่งออก'} · {kind === 'swaps' ? 'แลกเวร' : `ขายเวร${mode}`}</p><p className="mt-1 truncate text-sm font-extrabold text-[#0c2f4a]">#{String(row.id).slice(0, 8)}</p><p className="mt-1 text-xs text-slate-500">{row.reason ? String(row.reason) : 'ไม่มีรายละเอียดเพิ่มเติม'}</p></div><Badge tone={tone}>{labels[status as keyof typeof labels] ?? status}</Badge></div>{actions.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{actions.map((item) => <Button key={item.value} size="sm" variant={item.variant} disabled={busy !== null} onClick={() => act(kind, String(row.id), item.value)}>{busy === `${kind}:${String(row.id)}:${item.value}` ? '…' : item.label}</Button>)}</div>}</Card>
  }
  const receivedSwaps = resource.value?.received.filter((row) => row.target_user_id === actor.id) ?? []
  const approvalSwaps = resource.value?.approvals?.swaps ?? []
  const approvalSales = resource.value?.approvals?.sales ?? []
  const sales = resource.value?.sales ?? []
  return (
    <div>
      <PageHeading eyebrow="REQUESTS" title="คำขอของฉัน" description="ติดตามแลกเวร ขายเวร และการอนุมัติจากผู้จัดเวร" icon={ListChecks} />
      {resource.loading && <Spinner />}
      {resource.error && <ErrorNote error={resource.error} />}
      {!resource.loading && !resource.error && (
        <div className="space-y-5">
          {actor.isScheduler && (approvalSwaps.length > 0 || approvalSales.length > 0) && (
            <section>
              <h2 className="mb-2 text-sm font-extrabold text-[#0c2f4a]">รายการรออนุมัติ</h2>
              <div className="space-y-2">
                {approvalSwaps.map((row) => <RequestCard key={`approval-swap-${String(row.id)}`} kind="swaps" row={row} incoming={false} />)}
                {approvalSales.map((row) => <RequestCard key={`approval-sale-${String(row.id)}`} kind="sales" row={row} incoming={false} />)}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-2 text-sm font-extrabold text-[#0c2f4a]">คำขอแลกเวรที่ได้รับ</h2>
            <div className="space-y-2">{receivedSwaps.map((row) => <RequestCard key={String(row.id)} kind="swaps" row={row} incoming />)}{!receivedSwaps.length && <Card><EmptyState text="ไม่มีคำขอใหม่" /></Card>}</div>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-extrabold text-[#0c2f4a]">คำขอที่ส่ง</h2>
            <div className="space-y-2">{resource.value?.sent.map((row) => <RequestCard key={String(row.id)} kind="swaps" row={row} incoming={false} />)}{!resource.value?.sent.length && <Card><EmptyState text="ยังไม่มีคำขอ" /></Card>}</div>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-extrabold text-[#0c2f4a]">รายการขายเวร</h2>
            <div className="space-y-2">{sales.map((row) => <RequestCard key={String(row.id)} kind="sales" row={row} incoming={String(row.buyer_id) === actor.id} />)}{!sales.length && <Card><EmptyState text="ยังไม่มีรายการขายเวร" /></Card>}</div>
          </section>
        </div>
      )}
    </div>
  )
}

type Preferences = { shiftReminderEnabled: boolean; swapNotificationEnabled: boolean; saleNotificationEnabled: boolean; dailySummaryEnabled: boolean }
function SettingsView() {
  const { actor, settings } = useLineContext()
  const resource = useResource<Preferences>('/api/line/preferences')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  async function save(next: Preferences) { setBusy(true); setMessage(null); try { await lineApi('/api/line/preferences', { method: 'PATCH', body: JSON.stringify(next) }); setMessage('บันทึกการตั้งค่าแล้ว'); resource.reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ') } finally { setBusy(false) } }
  async function unlink() { if (!window.confirm('ต้องการยกเลิกการเชื่อมบัญชี LINE หรือไม่?')) return; setBusy(true); try { await lineApi('/api/line/unlink', { method: 'POST' }); window.location.href = '/line' } catch (error) { setMessage(error instanceof Error ? error.message : 'ยกเลิกการเชื่อมต่อไม่สำเร็จ'); setBusy(false) } }
  const preferenceItems: [keyof Preferences, string, boolean][] = [['shiftReminderEnabled', 'เตือนเวรล่วงหน้า', true], ['swapNotificationEnabled', 'ความคืบหน้าการแลกเวร', true], ['saleNotificationEnabled', 'ความคืบหน้าการขาย/รับเวร', true], ['dailySummaryEnabled', 'สรุปตารางเวรรายวัน', settings.dailyRosterEnabled]]
  return <div><PageHeading eyebrow="SETTINGS" title="ตั้งค่า LINE" description="จัดการการแจ้งเตือนและการเชื่อมบัญชีของคุณ" icon={Settings2} /><Card className="mb-4"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><ShieldCheck size={22} /></div><div><p className="font-extrabold text-[#0c2f4a]">{actor.name}</p><p className="text-xs text-slate-500">{actor.role} · เชื่อม LINE แล้ว</p></div></div></Card><Card className="mb-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-extrabold text-[#0c2f4a]">การแจ้งเตือน</h2><p className="text-xs text-slate-500">เลือกประเภทข้อความที่ต้องการรับใน LINE</p></div><RefreshCw size={18} className={busy ? 'animate-spin text-cyan-600' : 'text-slate-300'} /></div>{resource.loading ? <Spinner /> : resource.value ? <div className="divide-y divide-slate-100">{preferenceItems.map(([key, label, enabled]) => <label key={key} className="flex min-h-14 items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-700">{label}</span><input type="checkbox" checked={resource.value![key]} disabled={busy || !enabled} onChange={(event) => save({ ...resource.value!, [key]: event.target.checked })} className="h-5 w-5 accent-cyan-600" /></label>)}</div> : <ErrorNote error={resource.error} />}{message && <p className="mt-3 rounded-xl bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">{message}</p>}</Card><Card><h2 className="font-extrabold text-[#0c2f4a]">บัญชีและสิทธิ์</h2><p className="mt-1 text-xs leading-5 text-slate-500">การเชื่อมบัญชีใช้ LINE ID token ที่ตรวจสอบกับ LINE โดยตรง ไม่เก็บ token ไว้ในเบราว์เซอร์</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Link href="/line/link" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"><ExternalLink size={16} />วิธีเชื่อมบัญชี</Link><Button variant="danger" onClick={unlink} disabled={busy} className="justify-center"><X size={16} />ยกเลิกการเชื่อมต่อ</Button></div></Card></div>
}

export type LineViewKind = 'home' | 'schedule' | 'my-shifts' | 'today' | 'swap' | 'sell' | 'open-sales' | 'requests' | 'settings'
export function LineView({ kind }: { kind: LineViewKind }) {
  if (kind === 'home') return <DashboardView />
  if (kind === 'schedule') return <ScheduleView />
  if (kind === 'my-shifts') return <ScheduleView mineOnly />
  if (kind === 'today') return <TodayView />
  if (kind === 'swap') return <SwapView />
  if (kind === 'sell') return <SellView />
  if (kind === 'open-sales') return <OpenSalesView />
  if (kind === 'requests') return <RequestsView />
  return <SettingsView />
}
