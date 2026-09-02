'use client'

import { useEffect, useState } from 'react'
import { Download, Eye, FileSpreadsheet, FileText, Info } from 'lucide-react'
import { Button, Card, EmptyState, ErrorNote, Field, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiMonthLabel } from '@/lib/dates'
import { ATTENDANCE_REPORT_CATEGORIES, ATTENDANCE_REPORT_CATEGORY_TH, type Team } from '@/lib/types'
import type { ScheduleBundle } from '@/components/schedule/schedule-view'
import { RosterGrid } from '@/components/schedule/roster-grid'
import { buildRosterExportData } from '@/lib/reports/roster-data'
import type { AttendanceReportRow } from '@/lib/attendance'
import type { OtReportRow } from '@/lib/reports/pdf'

type ReportKind = 'roster' | 'leaves' | 'ot'

type OtApi = { month: string; shiftTypes: { code: string; name: string; hours: number }[]; rows: OtReportRow[] }

export function ReportsView() {
  const [kind, setKind] = useState<ReportKind>('roster')
  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState('')
  const [month, setMonth] = useState(bangkokMonthNow())
  const [fromMonth, setFromMonth] = useState(bangkokMonthNow())
  const [toMonth, setToMonth] = useState(bangkokMonthNow())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [bundle, setBundle] = useState<ScheduleBundle | null>(null)
  const [leaveRows, setLeaveRows] = useState<AttendanceReportRow[] | null>(null)
  const [leaveRange, setLeaveRange] = useState<{ from: string; to: string } | null>(null)
  const [otData, setOtData] = useState<OtApi | null>(null)

  useEffect(() => {
    api<{ teams: (Team & Record<string, unknown>)[] }>('/api/teams')
      .then((d) => {
        setTeams(d.teams.filter((t) => t.is_active))
        if (d.teams[0]) setTeamId(d.teams[0].id)
      })
      .catch(() => {})
  }, [])

  async function preview() {
    setBusy(true)
    setError(null)
    setBundle(null)
    setLeaveRows(null)
    setLeaveRange(null)
    setOtData(null)
    try {
      if (kind === 'roster') {
        const data = await api<ScheduleBundle>(`/api/schedules?month=${month}&team=${teamId}`)
        if (!data.schedule) throw new Error(`ยังไม่มีตารางเวรเดือน${thaiMonthLabel(month)} (หรือยังไม่เผยแพร่)`)
        setBundle(data)
      } else if (kind === 'leaves') {
        const data = await api<{ rows: AttendanceReportRow[]; from: string; to: string }>(`/api/reports/leaves?from=${fromMonth}&to=${toMonth}`)
        setLeaveRows(data.rows)
        setLeaveRange({ from: data.from, to: data.to })
      } else {
        const data = await api<OtApi>(`/api/reports/ot?month=${month}${teamId ? `&team=${teamId}` : ''}`)
        setOtData(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function exportPdf() {
    const { exportRosterPdf, exportAttendancePdf, exportOtPdf } = await import('@/lib/reports/pdf')
    if (kind === 'roster' && bundle) exportRosterPdf(buildRosterExportData(bundle, month))
    if (kind === 'leaves' && leaveRows && leaveRange) exportAttendancePdf(leaveRows, leaveRange.from, leaveRange.to)
    if (kind === 'ot' && otData) exportOtPdf(otData.rows, otData.shiftTypes.filter((t) => otData.rows.some((r) => r.byType[t.code])).map((t) => t.code), month)
  }

  async function exportInitialRosterPdf() {
    if (kind !== 'roster' || !bundle?.initialAssignments) return
    const { exportRosterPdf } = await import('@/lib/reports/pdf')
    const initialBundle = { ...bundle, assignments: bundle.initialAssignments }
    exportRosterPdf(buildRosterExportData(initialBundle, month), {
      titleSuffix: 'ตารางตั้งต้นก่อนแลก/ขายเวร',
      fileSuffix: 'ตั้งต้นก่อนแลกขายเวร',
    })
  }

  async function exportExcel() {
    const { exportRosterExcel, exportAttendanceExcel, exportOtExcel } = await import('@/lib/reports/excel')
    if (kind === 'roster' && bundle) exportRosterExcel(buildRosterExportData(bundle, month))
    if (kind === 'leaves' && leaveRows && leaveRange) exportAttendanceExcel(leaveRows, leaveRange.from, leaveRange.to)
    if (kind === 'ot' && otData) exportOtExcel(otData.rows, otData.shiftTypes.filter((t) => otData.rows.some((r) => r.byType[t.code])).map((t) => t.code), month)
  }

  const hasPreview = Boolean(bundle || leaveRows || otData)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">รายงาน</h1>

      <Card className="flex flex-col gap-4">
        <div className="flex gap-1">
          {([
            ['roster', 'ตารางเวรรายเดือน'],
            ['leaves', 'สรุปทะเบียน (เลือกช่วงเดือน)'],
            ['ot', 'สรุป OT / สถิติปฏิบัติงาน'],
          ] as [ReportKind, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold ${kind === k ? 'bg-brand-600 text-white' : 'border border-line bg-white text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {(kind === 'roster' || kind === 'ot') && (
            <>
              <Field label="ทีม">
                <select className={inputCls} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  {kind === 'ot' && <option value="">ทุกทีม</option>}
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name_th}</option>)}
                </select>
              </Field>
              <Field label={`เดือน (${thaiMonthLabel(month)})`}>
                <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
              </Field>
            </>
          )}
          {kind === 'leaves' && (
            <>
              <Field label={`ตั้งแต่เดือน (${thaiMonthLabel(fromMonth)})`}>
                <input type="month" className={inputCls} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
              </Field>
              <Field label={`ถึงเดือน (${thaiMonthLabel(toMonth)})`}>
                <input type="month" className={inputCls} value={toMonth} min={fromMonth} onChange={(e) => setToMonth(e.target.value)} />
              </Field>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-line/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-6 text-xs text-slate-500" aria-live="polite">
            {!hasPreview && 'เลือกข้อมูลแล้วกด “แสดงตัวอย่าง”'}
            {hasPreview && kind !== 'roster' && 'ตัวอย่างพร้อมดาวน์โหลด'}
            {hasPreview && kind === 'roster' && bundle?.initialAssignments && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                มีตารางตั้งต้นพร้อมดาวน์โหลด
              </span>
            )}
            {hasPreview && kind === 'roster' && !bundle?.initialAssignments && (
              <span id="initial-roster-status" className="inline-flex items-center gap-1.5 text-amber-700">
                <Info size={14} aria-hidden="true" />
                ยังไม่มี snapshot ตารางตั้งต้น
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button className="min-h-11 whitespace-nowrap" disabled={busy} onClick={preview}>
              <Eye size={15} aria-hidden="true" />
              {busy ? 'กำลังโหลด…' : 'แสดงตัวอย่าง'}
            </Button>
            {hasPreview && (
              <>
                <Button className="min-h-11 whitespace-nowrap" variant="danger" onClick={exportPdf}>
                  <FileText size={15} aria-hidden="true" /> PDF ปัจจุบัน
                </Button>
                {kind === 'roster' && (
                  <Button
                    className="min-h-11 whitespace-nowrap"
                    variant="outline"
                    disabled={!bundle?.initialAssignments}
                    title={!bundle?.initialAssignments ? 'ยังไม่มี snapshot ตารางตั้งต้นของเดือนนี้' : 'ดาวน์โหลดตารางเวรก่อนแลก/ขายเวร'}
                    aria-label="ดาวน์โหลด PDF ตารางเวรตั้งต้นก่อนแลกหรือขายเวร"
                    aria-describedby={!bundle?.initialAssignments ? 'initial-roster-status' : undefined}
                    onClick={exportInitialRosterPdf}
                  >
                    <Download size={15} aria-hidden="true" /> PDF ตั้งต้น
                  </Button>
                )}
                <Button className="min-h-11 whitespace-nowrap" variant="success" onClick={exportExcel}>
                  <FileSpreadsheet size={15} aria-hidden="true" /> Excel
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <ErrorNote error={error} />
      {busy && <Spinner />}

      {bundle && (
        <Card className="!p-0 overflow-hidden">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <div className="text-sm font-bold">ตารางเวร{bundle.team.name_th} เดือน{thaiMonthLabel(month)}</div>
            <div className="mt-1 text-xs text-slate-500">ตัวอย่างตารางจากข้อมูลล่าสุด · เลื่อนซ้าย–ขวาเพื่อดูเวรทั้งหมด</div>
          </div>
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
          />
          {kind === 'roster' && !bundle.initialAssignments && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 sm:px-5">
              ตารางนี้ยังไม่มี snapshot ตั้งต้น ระบบจะเริ่มเก็บเมื่อเผยแพร่ตารางครั้งแรกหลังติดตั้งฟีเจอร์นี้
            </div>
          )}
        </Card>
      )}

      {leaveRows && (
        <Card className="overflow-x-auto">
          {leaveRows.length === 0 ? <EmptyState text="ไม่มีข้อมูลทะเบียนในช่วงที่เลือก" /> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-slate-500">
                  <th className="py-1.5">ชื่อ-สกุล</th><th>งาน</th><th>ตำแหน่ง</th><th>ประเภทการจ้าง</th>
                  {ATTENDANCE_REPORT_CATEGORIES.map((category) => <th key={category} className="text-right">{ATTENDANCE_REPORT_CATEGORY_TH[category]}</th>)}
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((r) => (
                  <tr key={r.userId} className="border-b border-line/60">
                    <td className="py-1.5">{r.name}</td>
                    <td>{r.dept ?? '-'}</td>
                    <td>{r.positionTitle ?? '-'}</td>
                    <td>{r.employmentType ?? '-'}</td>
                    {ATTENDANCE_REPORT_CATEGORIES.map((category) => <td key={category} className="text-right font-semibold">{Number.isInteger(r[category]) ? r[category] : r[category].toFixed(1)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {otData && (
        <Card className="overflow-x-auto">
          {otData.rows.length === 0 ? <EmptyState text="ไม่มีข้อมูลเวรเดือนนี้" /> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-slate-500">
                  <th className="py-1.5">ชื่อ-สกุล</th><th>ทีม</th>
                  {otData.shiftTypes.filter((t) => otData.rows.some((r) => r.byType[t.code])).map((t) => (
                    <th key={t.code} className="text-center">{t.code}</th>
                  ))}
                  <th className="text-right">รวมเวร</th><th className="text-right">ชั่วโมง</th>
                </tr>
              </thead>
              <tbody>
                {otData.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-1.5">{r.name}</td>
                    <td>{r.team}</td>
                    {otData.shiftTypes.filter((t) => otData.rows.some((x) => x.byType[t.code])).map((t) => (
                      <td key={t.code} className="text-center">{r.byType[t.code] ?? 0}</td>
                    ))}
                    <td className="text-right font-semibold">{r.totalShifts}</td>
                    <td className="text-right font-semibold">{r.totalHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  )
}
