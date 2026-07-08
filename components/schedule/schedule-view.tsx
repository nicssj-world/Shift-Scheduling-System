'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ChevronLeft, ChevronRight, Lock, LockOpen, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Modal, Spinner } from '@/components/ui'
import { RosterGrid, type BundleMember, type RosterCell } from '@/components/schedule/roster-grid'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiMonthLabel, thaiShortDate } from '@/lib/dates'
import type { Assignment, DayClass, Holiday, Job, Requirement, Schedule, ShiftType, Team } from '@/lib/types'

export type ScheduleBundle = {
  teams: Team[]
  team: Team
  shiftTypes: ShiftType[]
  requirements: Requirement[]
  jobs: Job[]
  days: { date: string; dayClass: DayClass }[]
  holidays: Holiday[]
  members: BundleMember[]
  schedule: Schedule | null
  assignments: Assignment[]
  canManage: boolean
  isAdmin: boolean
  me: string
}

type Violation = { date: string; shiftTypeCode?: string; userId?: string; rule: string; severity: 'error' | 'warning'; message: string }

type Candidate = { userId: string; displayName: string; total: number; ok: boolean; reason: string | null; score: number }

const STATUS_TH: Record<string, { label: string; tone: 'gray' | 'green' | 'red' }> = {
  draft: { label: 'ฉบับร่าง', tone: 'gray' },
  published: { label: 'เผยแพร่แล้ว', tone: 'green' },
  locked: { label: 'ล็อคแล้ว', tone: 'red' },
}

export function ScheduleView({ manage }: { manage: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [bundle, setBundle] = useState<ScheduleBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [violations, setViolations] = useState<Violation[]>([])
  const [mode, setMode] = useState<'grid' | 'list'>('grid')
  const [cell, setCell] = useState<RosterCell | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  // In-app confirm dialog. Never use window.confirm here: browsers can
  // silently suppress native dialogs (after repeated dialogs / "prevent this
  // page from creating additional dialogs"), making confirm() return false
  // instantly — the click then does nothing, with no request and no error.
  const [confirmBox, setConfirmBox] = useState<{ title: string; message: string; run: () => void } | null>(null)

  const month = searchParams.get('month') ?? bangkokMonthNow()
  const teamId = searchParams.get('team')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<ScheduleBundle>(`/api/schedules?month=${month}${teamId ? `&team=${teamId}` : ''}`)
      setBundle(data)
      if (manage && data.schedule && data.canManage) {
        api<{ violations: Violation[] }>(`/api/schedules/${data.schedule.id}/validate`)
          .then((v) => setViolations(v.violations))
          .catch(() => setViolations([]))
      } else {
        setViolations([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [month, teamId, manage])

  useEffect(() => {
    load()
  }, [load])

  function setParams(next: { month?: string; team?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.month) params.set('month', next.month)
    if (next.team) params.set('team', next.team)
    router.replace(`${manage ? '/schedule/manage' : '/schedule'}?${params.toString()}`)
  }

  function shiftMonth(delta: number) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    setParams({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` })
  }

  async function action(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function askConfirm(title: string, message: string, run: () => void) {
    setConfirmBox({ title, message, run })
  }

  async function generateNow(scheduleId: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      // Trust the generate response directly — it's the authoritative result
      // from the server, so violations are correct even if the follow-up
      // bundle refetch were ever to lag or be served stale.
      const res = await api<{ violations: Violation[]; count: number }>(
        `/api/schedules/${scheduleId}/generate`,
        { method: 'POST' },
      )
      setViolations(res.violations)
      await load()
      if (res.count === 0) {
        setError('ไม่สามารถจัดเวรได้ — ตรวจสอบว่าทีมมีสมาชิกและกำหนดจำนวนคนต่อเวรแล้ว')
      } else {
        const errors = res.violations.filter((v) => v.severity === 'error').length
        setNotice(`จัดเวรอัตโนมัติสำเร็จ ${res.count} เวร${errors > 0 ? ` (มีข้อควรแก้ไข ${errors} จุด)` : ' ไม่มีข้อผิดพลาด'}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างตารางไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function openCell(c: RosterCell) {
    if (!bundle?.schedule || bundle.schedule.status === 'locked') return
    setCell(c)
    setCandidates(null)
    try {
      const data = await api<{ candidates: Candidate[] }>(
        `/api/schedules/${bundle.schedule.id}/candidates?date=${c.date}&shiftTypeId=${c.shiftType.id}`,
      )
      setCandidates(data.candidates)
    } catch {
      setCandidates([])
    }
  }

  async function assign(userId: string) {
    if (!bundle?.schedule || !cell) return
    setBusy(true)
    try {
      const res = await api<{ violations: Violation[] }>(`/api/schedules/${bundle.schedule.id}/assignments`, {
        method: 'POST',
        body: JSON.stringify({
          workDate: cell.date,
          shiftTypeId: cell.shiftType.id,
          userId,
          jobId: cell.job?.id ?? null,
          replaceAssignmentId: cell.assignment?.id,
        }),
      })
      setViolations(res.violations)
      setCell(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function removeAssignment() {
    if (!bundle?.schedule || !cell?.assignment) return
    setBusy(true)
    try {
      const res = await api<{ violations: Violation[] }>(`/api/schedules/${bundle.schedule.id}/assignments`, {
        method: 'DELETE',
        body: JSON.stringify({ assignmentId: cell.assignment.id }),
      })
      setViolations(res.violations)
      setCell(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const errorCount = violations.filter((v) => v.severity === 'error').length
  const schedule = bundle?.schedule ?? null
  const status = schedule ? STATUS_TH[schedule.status] : null

  const dayList = useMemo(() => {
    if (!bundle) return []
    const typeById = new Map(bundle.shiftTypes.map((t) => [t.id, t]))
    const nameByUser = new Map(bundle.members.map((m) => [m.userId, m.displayName]))
    return bundle.days.map((day) => {
      const items = bundle.assignments
        .filter((a) => a.work_date === day.date)
        .map((a) => ({
          id: a.id,
          type: typeById.get(a.shift_type_id),
          name: nameByUser.get(a.user_id) ?? '?',
          mine: a.user_id === bundle.me,
          jobName: bundle.jobs.find((j) => j.id === a.job_id)?.name_th ?? null,
        }))
        .sort((x, y) => (x.type?.sort_order ?? 0) - (y.type?.sort_order ?? 0))
      return { ...day, items }
    })
  }, [bundle])

  if (loading && !bundle) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">
          {manage ? 'จัดตารางเวร' : 'ตารางปฏิบัติงานนอกเวลาราชการ'}
        </h1>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
      </div>

      <Card className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อนหน้า"><ChevronLeft size={14} /></Button>
          <div className="min-w-36 text-center text-sm font-bold">เดือน{thaiMonthLabel(month)}</div>
          <Button variant="outline" size="sm" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป"><ChevronRight size={14} /></Button>
        </div>
        <div className="flex gap-1">
          {bundle?.teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setParams({ team: t.id })}
              className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold ${
                bundle.team.id === t.id ? 'bg-brand-600 text-white' : 'bg-white border border-line text-slate-600 hover:bg-brand-50'
              }`}
            >
              {t.name_th}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setMode('grid')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${mode === 'grid' ? 'bg-brand-100 text-brand-800' : 'text-slate-500'}`}
          >
            ตาราง
          </button>
          <button
            onClick={() => setMode('list')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${mode === 'list' ? 'bg-brand-100 text-brand-800' : 'text-slate-500'}`}
          >
            รายวัน
          </button>
        </div>
      </Card>

      <ErrorNote error={error} />
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-700">
          ✓ {notice}
        </div>
      )}

      {/* manage toolbar */}
      {manage && bundle?.canManage && (
        <Card className="flex flex-wrap items-center gap-2">
          {!schedule && (
            <Button
              disabled={busy}
              onClick={() => action(() => api('/api/schedules', { method: 'POST', body: JSON.stringify({ teamId: bundle.team.id, month }) }))}
            >
              <Sparkles size={15} /> สร้างตารางฉบับร่าง
            </Button>
          )}
          {schedule && schedule.status === 'draft' && (
            <>
              <Button
                disabled={busy}
                onClick={() => askConfirm(
                  'สร้างตารางอัตโนมัติ',
                  'ระบบจะจัดเวรใหม่ทั้งเดือนและแทนที่เวรทั้งหมดในฉบับร่างนี้ ดำเนินการต่อ?',
                  () => generateNow(schedule.id),
                )}
              >
                <Sparkles size={15} /> {busy ? 'กำลังจัดเวร…' : 'สร้างตารางอัตโนมัติ'}
              </Button>
              <Button
                variant="success"
                disabled={busy}
                onClick={() => askConfirm(
                  'เผยแพร่ตารางเวร',
                  errorCount > 0 ? `ยังมีข้อผิดพลาด ${errorCount} จุด ต้องการเผยแพร่หรือไม่?` : 'เผยแพร่ตารางเวรให้ทุกคนเห็น?',
                  () => action(() => api(`/api/schedules/${schedule.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'publish' }) })),
                )}
              >
                <Send size={15} /> เผยแพร่
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => askConfirm(
                  'ลบฉบับร่าง',
                  'ลบตารางฉบับร่างนี้ทั้งหมด?',
                  () => action(() => api(`/api/schedules/${schedule.id}`, { method: 'DELETE' })),
                )}
              >
                <Trash2 size={15} /> ลบฉบับร่าง
              </Button>
            </>
          )}
          {schedule && schedule.status === 'published' && (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => askConfirm(
                  'ล็อคตารางเวร',
                  'ล็อคตารางเวรเดือนนี้? เมื่อล็อคแล้วจะไม่สามารถแก้ไขหรือแลกเวรได้อีก',
                  () => action(() => api(`/api/schedules/${schedule.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'lock' }) })),
                )}
              >
                <Lock size={15} /> ล็อคตาราง
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => askConfirm(
                  'กลับเป็นฉบับร่าง',
                  'ยกเลิกการเผยแพร่และกลับเป็นฉบับร่าง?',
                  () => action(() => api(`/api/schedules/${schedule.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'unpublish' }) })),
                )}
              >
                กลับเป็นฉบับร่าง
              </Button>
            </>
          )}
          {schedule && schedule.status === 'locked' && bundle.isAdmin && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => askConfirm(
                'ปลดล็อคตารางเวร',
                'ปลดล็อคตารางเวรเพื่อกลับมาแก้ไข/แลกเวรได้? (เฉพาะ Admin)',
                () => action(() => api(`/api/schedules/${schedule.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'unlock' }) })),
              )}
            >
              <LockOpen size={15} /> ปลดล็อค
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => load()}>
            <RefreshCw size={14} /> รีเฟรช
          </Button>
          {schedule && schedule.status !== 'locked' && (
            <span className="text-xs text-slate-400">คลิกช่องในตารางเพื่อแก้ไขรายคน</span>
          )}
        </Card>
      )}

      {/* violations */}
      {manage && violations.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold">
            <AlertTriangle size={16} className="text-amber-500" />
            ผลตรวจสอบกฎการจัดเวร ({errorCount} ข้อผิดพลาด / {violations.length - errorCount} คำเตือน)
          </div>
          <div className="max-h-48 overflow-y-auto text-[13px]">
            {violations.slice(0, 80).map((v, i) => (
              <div key={i} className={`border-l-2 py-0.5 pl-2 ${v.severity === 'error' ? 'border-red-400 text-red-700' : 'border-amber-400 text-amber-700'}`}>
                {v.message}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* body */}
      {bundle && !schedule && !manage && <Card><EmptyState text={`ยังไม่มีตารางเวรเดือน${thaiMonthLabel(month)}`} /></Card>}

      {bundle && (schedule || manage) && mode === 'grid' && (
        <RosterGrid
          team={bundle.team}
          shiftTypes={bundle.shiftTypes}
          requirements={bundle.requirements}
          jobs={bundle.jobs}
          days={bundle.days}
          holidays={bundle.holidays}
          members={bundle.members}
          assignments={bundle.assignments}
          me={bundle.me}
          onCellClick={manage && schedule && schedule.status !== 'locked' ? openCell : undefined}
        />
      )}

      {bundle && (schedule || manage) && mode === 'list' && (
        <div className="flex flex-col gap-2">
          {dayList.map((day) => (
            <Card key={day.date} className={day.items.some((i) => i.mine) ? 'ring-2 ring-brand-300' : ''}>
              <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">
                {thaiShortDate(day.date)}
                {day.dayClass === 'holiday' && <Badge tone="amber">วันหยุด</Badge>}
                {day.dayClass === 'weekend' && <Badge tone="gray">เสาร์-อาทิตย์</Badge>}
              </div>
              {day.items.length === 0 ? (
                <div className="text-xs text-slate-400">—</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {day.items.map((item) => (
                    <span
                      key={item.id}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${item.mine ? 'bg-brand-600 text-white' : 'bg-slate-100'}`}
                      style={item.mine ? undefined : { borderLeft: `3px solid ${item.type?.color ?? '#999'}` }}
                    >
                      {item.type?.code} · {item.name}
                      {item.jobName ? ` (${item.jobName})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* legend */}
      {bundle && (
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {bundle.shiftTypes.filter((t) => t.is_active).map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded" style={{ background: t.color }} />
              {t.code} = {t.name_th}
            </span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-[#d2ecff]" /> เวรของฉัน</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-[#fdf1d8]" /> วันหยุดพิเศษ</span>
        </div>
      )}

      {/* cell editor */}
      <Modal
        open={Boolean(cell)}
        onClose={() => setCell(null)}
        title={cell ? `${thaiShortDate(cell.date)} · ${cell.shiftType.name_th}${cell.job ? ` · ${cell.job.name_th}` : ''}` : ''}
      >
        {cell && (
          <div className="flex flex-col gap-3">
            {cell.assignment && (
              <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2 text-sm">
                <span>
                  ปัจจุบัน: <b>{bundle?.members.find((m) => m.userId === cell.assignment!.user_id)?.displayName ?? '?'}</b>
                </span>
                <Button variant="danger" size="sm" disabled={busy} onClick={removeAssignment}>
                  <Trash2 size={13} /> เอาออก
                </Button>
              </div>
            )}
            <div className="text-[13px] font-semibold">เลือกคนเข้าเวร (เรียงตามความเหมาะสม)</div>
            {!candidates && <Spinner />}
            {candidates && (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
                {candidates.map((c) => (
                  <button
                    key={c.userId}
                    disabled={!c.ok || busy || c.userId === cell.assignment?.user_id}
                    onClick={() => assign(c.userId)}
                    className="flex w-full items-center justify-between border-b border-line px-3 py-2 text-left text-sm last:border-0 enabled:hover:bg-brand-50 disabled:opacity-45"
                  >
                    <span className="font-medium">{c.displayName}</span>
                    <span className="text-xs text-slate-500">
                      {c.ok ? `${c.total} เวรเดือนนี้` : c.reason}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* in-app confirm (replaces window.confirm — cannot be suppressed by the browser) */}
      <Modal open={Boolean(confirmBox)} onClose={() => setConfirmBox(null)} title={confirmBox?.title ?? ''}>
        {confirmBox && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">{confirmBox.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmBox(null)}>ยกเลิก</Button>
              <Button
                onClick={() => {
                  const run = confirmBox.run
                  setConfirmBox(null)
                  run()
                }}
              >
                ยืนยัน
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
