import { jsPDF } from 'jspdf'
import autoTable, { type CellHookData } from 'jspdf-autotable'
import { sarabunBase64 } from '@/lib/fonts/sarabun-base64'
import { THAI_DAYS_SHORT, dayOfWeek, thaiMonthLabel, thaiTime, toBE } from '@/lib/dates'
import type { RosterExportData } from '@/lib/reports/roster-data'

function createThaiDoc(orientation: 'portrait' | 'landscape' = 'landscape') {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  doc.addFileToVFS('Sarabun.ttf', sarabunBase64)
  doc.addFont('Sarabun.ttf', 'Sarabun', 'normal')
  doc.setFont('Sarabun')
  return doc
}

/** Monthly roster PDF in the paper layout: day rows × (shift group × job) columns,
 *  thick separators between shift groups, shaded weekend/holiday rows. */
export function exportRosterPdf(data: RosterExportData) {
  const doc = createThaiDoc('landscape')
  const { month, teamName, groups, days, cellText } = data

  doc.setFontSize(16)
  doc.text(`ตารางปฏิบัติงานนอกเวลาราชการเดือน ${thaiMonthLabel(month)}`, 148, 12, { align: 'center' })
  doc.setFontSize(11)
  doc.text(`${teamName} · กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี`, 148, 18, { align: 'center' })

  const head1: { content: string; colSpan?: number; rowSpan?: number }[] = [{ content: 'วันที่', colSpan: 2, rowSpan: 2 }]
  const head2: { content: string }[] = []
  const groupStartCols: number[] = []
  let col = 2
  for (const g of groups) {
    groupStartCols.push(col)
    head1.push({
      content: `${g.name} (${thaiTime(g.startTime)}-${g.endTime.startsWith('00') ? '24.00' : thaiTime(g.endTime)} น.)`,
      colSpan: g.columns.length,
    })
    for (const c of g.columns) head2.push({ content: c })
    col += g.columns.length
  }

  const body = days.map((day) => {
    const row: string[] = [THAI_DAYS_SHORT[dayOfWeek(day.date)], String(Number(day.date.slice(8, 10)))]
    for (const g of groups) {
      for (let i = 0; i < g.columns.length; i++) {
        row.push(cellText[`${day.date}|${g.code}|${i}`] ?? '')
      }
    }
    return row
  })

  const shadedRows = new Set(days.map((d, i) => (d.dayClass !== 'weekday' ? i : -1)).filter((i) => i >= 0))
  const holidayRows = new Set(days.map((d, i) => (d.dayClass === 'holiday' ? i : -1)).filter((i) => i >= 0))

  autoTable(doc, {
    startY: 22,
    head: [head1, head2],
    body,
    styles: {
      font: 'Sarabun', fontSize: 8.5, cellPadding: 0.8, halign: 'center', valign: 'middle',
      lineColor: [120, 140, 160], lineWidth: 0.15, textColor: [20, 40, 60],
    },
    headStyles: { fillColor: [225, 240, 250], textColor: [12, 60, 100], fontStyle: 'normal' },
    didParseCell(cell: CellHookData) {
      if (cell.section === 'body' && shadedRows.has(cell.row.index)) {
        cell.cell.styles.fillColor = holidayRows.has(cell.row.index) ? [253, 241, 216] : [236, 242, 247]
      }
      if (groupStartCols.includes(cell.column.index)) {
        cell.cell.styles.lineWidth = { top: 0.15, right: 0.15, bottom: 0.15, left: 0.7 }
      }
    },
    margin: { left: 6, right: 6 },
  })

  doc.save(`ตารางเวร-${teamName}-${month}.pdf`)
}

export type LeaveReportRow = { name: string; dept: string | null; month: string; typeTh: string; days: number }

export function exportLeavePdf(rows: LeaveReportRow[], fromMonth: string, toMonth: string) {
  const doc = createThaiDoc('portrait')
  doc.setFontSize(15)
  doc.text(`สรุปวันลา ${thaiMonthLabel(fromMonth)} – ${thaiMonthLabel(toMonth)}`, 105, 14, { align: 'center' })
  doc.setFontSize(10)
  doc.text('กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี', 105, 20, { align: 'center' })

  autoTable(doc, {
    startY: 26,
    head: [['ชื่อ-สกุล', 'แผนก', 'เดือน', 'ประเภท', 'จำนวนวัน']],
    body: rows.map((r) => [r.name, r.dept ?? '-', thaiMonthLabel(r.month), r.typeTh, String(r.days)]),
    styles: { font: 'Sarabun', fontSize: 10, cellPadding: 1.5 },
    headStyles: { fillColor: [2, 132, 199] },
  })
  doc.save(`สรุปวันลา-${fromMonth}-ถึง-${toMonth}.pdf`)
}

export type OtReportRow = {
  name: string; team: string; byType: Record<string, number>; totalShifts: number; totalHours: number
}

export function exportOtPdf(rows: OtReportRow[], typeCodes: string[], month: string) {
  const doc = createThaiDoc('portrait')
  doc.setFontSize(15)
  doc.text(`สรุปการปฏิบัติงานนอกเวลา (OT) เดือน${thaiMonthLabel(month)}`, 105, 14, { align: 'center' })
  doc.setFontSize(10)
  doc.text('กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี', 105, 20, { align: 'center' })

  autoTable(doc, {
    startY: 26,
    head: [['ชื่อ-สกุล', 'ทีม', ...typeCodes, 'รวมเวร', 'รวมชั่วโมง']],
    body: rows.map((r) => [
      r.name, r.team,
      ...typeCodes.map((c) => String(r.byType[c] ?? 0)),
      String(r.totalShifts), String(r.totalHours),
    ]),
    styles: { font: 'Sarabun', fontSize: 10, cellPadding: 1.5 },
    headStyles: { fillColor: [2, 132, 199] },
  })
  doc.save(`สรุปOT-${month}.pdf`)
}

export { toBE }
