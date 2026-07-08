import * as XLSX from 'xlsx'
import { THAI_DAYS_SHORT, dayOfWeek, thaiMonthLabel, thaiTime } from '@/lib/dates'
import type { RosterExportData } from '@/lib/reports/roster-data'
import type { LeaveReportRow, OtReportRow } from '@/lib/reports/pdf'

/** Monthly roster Excel in the paper layout with 2-level merged headers. */
export function exportRosterExcel(data: RosterExportData) {
  const { month, teamName, groups, days, cellText } = data
  const aoa: (string | number)[][] = []

  aoa.push([`ตารางปฏิบัติงานนอกเวลาราชการเดือน ${thaiMonthLabel(month)} — ${teamName}`])
  const head1: string[] = ['วันที่', '']
  const head2: string[] = ['', '']
  for (const g of groups) {
    head1.push(`${g.name} (${thaiTime(g.startTime)}-${g.endTime.startsWith('00') ? '24.00' : thaiTime(g.endTime)} น.)`)
    for (let i = 1; i < g.columns.length; i++) head1.push('')
    for (const c of g.columns) head2.push(c)
  }
  aoa.push(head1, head2)

  for (const day of days) {
    const row: string[] = [THAI_DAYS_SHORT[dayOfWeek(day.date)], String(Number(day.date.slice(8, 10)))]
    for (const g of groups) {
      for (let i = 0; i < g.columns.length; i++) row.push(cellText[`${day.date}|${g.code}|${i}`] ?? '')
    }
    aoa.push(row)
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const totalCols = 2 + groups.reduce((sum, g) => sum + g.columns.length, 0)
  const merges: XLSX.Range[] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 2, c: 1 } },
  ]
  let col = 2
  for (const g of groups) {
    merges.push({ s: { r: 1, c: col }, e: { r: 1, c: col + g.columns.length - 1 } })
    col += g.columns.length
  }
  ws['!merges'] = merges
  ws['!cols'] = Array.from({ length: totalCols }, (_, i) => ({ wch: i < 2 ? 5 : 13 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'ตารางเวร')
  XLSX.writeFile(wb, `ตารางเวร-${teamName}-${month}.xlsx`)
}

export function exportLeaveExcel(rows: LeaveReportRow[], fromMonth: string, toMonth: string) {
  const aoa: (string | number)[][] = [
    [`สรุปวันลา ${thaiMonthLabel(fromMonth)} – ${thaiMonthLabel(toMonth)}`],
    ['ชื่อ-สกุล', 'แผนก', 'เดือน', 'ประเภท', 'จำนวนวัน'],
    ...rows.map((r) => [r.name, r.dept ?? '-', thaiMonthLabel(r.month), r.typeTh, r.days] as (string | number)[]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }]
  ws['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'สรุปวันลา')
  XLSX.writeFile(wb, `สรุปวันลา-${fromMonth}-ถึง-${toMonth}.xlsx`)
}

export function exportOtExcel(rows: OtReportRow[], typeCodes: string[], month: string) {
  const aoa: (string | number)[][] = [
    [`สรุปการปฏิบัติงานนอกเวลา (OT) เดือน${thaiMonthLabel(month)}`],
    ['ชื่อ-สกุล', 'ทีม', ...typeCodes, 'รวมเวร', 'รวมชั่วโมง'],
    ...rows.map((r) => [
      r.name, r.team, ...typeCodes.map((c) => r.byType[c] ?? 0), r.totalShifts, r.totalHours,
    ] as (string | number)[]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 + typeCodes.length } }]
  ws['!cols'] = [{ wch: 28 }, { wch: 22 }, ...typeCodes.map(() => ({ wch: 7 })), { wch: 8 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'สรุปOT')
  XLSX.writeFile(wb, `สรุปOT-${month}.xlsx`)
}
