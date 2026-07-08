'use client'

import { useEffect, useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { Button, Card, EmptyState, ErrorNote, Field, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiMonthLabel } from '@/lib/dates'
import { LEAVE_TYPE_TH, type LeaveType, type Team } from '@/lib/types'
import type { ScheduleBundle } from '@/components/schedule/schedule-view'
import { buildRosterExportData } from '@/lib/reports/roster-data'
import type { LeaveReportRow, OtReportRow } from '@/lib/reports/pdf'

type ReportKind = 'roster' | 'leaves' | 'ot'

type LeaveApiRow = { userId: string; name: string; dept: string | null; month: string; type: LeaveType; days: number }
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
  const [leaveRows, setLeaveRows] = useState<LeaveApiRow[] | null>(null)
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
    setOtData(null)
    try {
      if (kind === 'roster') {
        const data = await api<ScheduleBundle>(`/api/schedules?month=${month}&team=${teamId}`)
        if (!data.schedule) throw new Error(`ยังไม่มีตารางเวรเดือน${thaiMonthLabel(month)} (หรือยังไม่เผยแพร่)`)
        setBundle(data)
      } else if (kind === 'leaves') {
        const data = await api<{ rows: LeaveApiRow[] }>(`/api/reports/leaves?from=${fromMonth}&to=${toMonth}`)
        setLeaveRows(data.rows)
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

  const leaveExportRows: LeaveReportRow[] = (leaveRows ?? []).map((r) => ({
    name: r.name, dept: r.dept, month: r.month, typeTh: LEAVE_TYPE_TH[r.type] ?? r.type, days: r.days,
  }))

  async function exportPdf() {
    const { exportRosterPdf, exportLeavePdf, exportOtPdf } = await import('@/lib/reports/pdf')
    if (kind === 'roster' && bundle) exportRosterPdf(buildRosterExportData(bundle, month))
    if (kind === 'leaves' && leaveRows) exportLeavePdf(leaveExportRows, fromMonth, toMonth)
    if (kind === 'ot' && otData) exportOtPdf(otData.rows, otData.shiftTypes.filter((t) => otData.rows.some((r) => r.byType[t.code])).map((t) => t.code), month)
  }

  async function exportExcel() {
    const { exportRosterExcel, exportLeaveExcel, exportOtExcel } = await import('@/lib/reports/excel')
    if (kind === 'roster' && bundle) exportRosterExcel(buildRosterExportData(bundle, month))
    if (kind === 'leaves' && leaveRows) exportLeaveExcel(leaveExportRows, fromMonth, toMonth)
    if (kind === 'ot' && otData) exportOtExcel(otData.rows, otData.shiftTypes.filter((t) => otData.rows.some((r) => r.byType[t.code])).map((t) => t.code), month)
  }

  const hasPreview = Boolean(bundle || leaveRows || otData)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">รายงาน</h1>

      <Card className="flex flex-col gap-3">
        <div className="flex gap-1">
          {([
            ['roster', 'ตารางเวรรายเดือน'],
            ['leaves', 'สรุปวันลา (เลือกช่วงเดือน)'],
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

        <div className="grid gap-3 sm:grid-cols-3">
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
          <div className="flex items-end gap-2">
            <Button disabled={busy} onClick={preview}>แสดงตัวอย่าง</Button>
            {hasPreview && (
              <>
                <Button variant="danger" onClick={exportPdf}><FileText size={15} /> PDF</Button>
                <Button variant="success" onClick={exportExcel}><FileSpreadsheet size={15} /> Excel</Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <ErrorNote error={error} />
      {busy && <Spinner />}

      {bundle && (
        <Card className="overflow-x-auto">
          <div className="mb-2 text-sm font-bold">ตารางเวร{bundle.team.name_th} เดือน{thaiMonthLabel(month)}</div>
          <div className="text-xs text-slate-500">ดูตารางเต็มได้ที่หน้า &quot;ตารางเวร&quot; — กด PDF/Excel เพื่อดาวน์โหลดรูปแบบเดียวกับตารางกระดาษ</div>
        </Card>
      )}

      {leaveRows && (
        <Card className="overflow-x-auto">
          {leaveRows.length === 0 ? <EmptyState text="ไม่มีข้อมูลการลาในช่วงที่เลือก" /> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-slate-500">
                  <th className="py-1.5">ชื่อ-สกุล</th><th>แผนก</th><th>เดือน</th><th>ประเภท</th><th className="text-right">วัน</th>
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-1.5">{r.name}</td>
                    <td>{r.dept ?? '-'}</td>
                    <td>{thaiMonthLabel(r.month)}</td>
                    <td>{LEAVE_TYPE_TH[r.type] ?? r.type}</td>
                    <td className="text-right font-semibold">{r.days}</td>
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
