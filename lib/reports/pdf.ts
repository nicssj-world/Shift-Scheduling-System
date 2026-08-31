import { jsPDF } from 'jspdf'
import autoTable, { type CellHookData, type RowInput } from 'jspdf-autotable'
import { sarabunBase64 } from '@/lib/fonts/sarabun-base64'
import { THAI_DAYS_SHORT, THAI_MONTHS_SHORT, dayOfWeek, thaiMonthLabel, thaiTime, toBE } from '@/lib/dates'
import { DEPARTMENTS } from '@/lib/types'
import type { AttendanceReportRow } from '@/lib/attendance'
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

function thaiReportDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return `${day} ${THAI_MONTHS_SHORT[month - 1]} ${toBE(year)}`
}

function reportDepartment(dept: string | null) {
  return dept && (DEPARTMENTS as readonly string[]).includes(dept) ? dept : 'ไม่ระบุงาน'
}

function reportNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** A4 landscape attendance register summary matching the supplied workbook. */
export function buildAttendancePdf(rows: AttendanceReportRow[], from: string, to: string) {
  const doc = createThaiDoc('landscape')
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const tableMargin = { left: 6, right: 6, bottom: 9 }
  const tableWidth = pageWidth - tableMargin.left - tableMargin.right
  doc.setFontSize(15)
  doc.text(`สรุปวันลาและการมาปฏิบัติงาน ${thaiReportDate(from)} – ${thaiReportDate(to)}`, pageWidth / 2, 11, { align: 'center' })
  doc.setFontSize(9)
  doc.text('กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี', pageWidth / 2, 17, { align: 'center' })

  const orderedDepartments = [...new Set(rows.map((row) => reportDepartment(row.dept)))].sort((a, b) => {
    const aIndex = DEPARTMENTS.indexOf(a as (typeof DEPARTMENTS)[number])
    const bIndex = DEPARTMENTS.indexOf(b as (typeof DEPARTMENTS)[number])
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, 'th')
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  })
  const byDepartment = new Map(orderedDepartments.map((dept) => [dept, rows.filter((row) => reportDepartment(row.dept) === dept).sort((a, b) => a.name.localeCompare(b.name, 'th'))]))
  const body: RowInput[] = []
  const departmentRows = new Set<number>()
  let sequence = 1
  for (const department of orderedDepartments) {
    departmentRows.add(body.length)
    body.push([{ content: department, colSpan: 11 }])
    for (const row of byDepartment.get(department) ?? []) {
      body.push([
        String(sequence++), row.name, row.positionTitle ?? '-', row.employmentType ?? '-',
        reportNumber(row.vacation), reportNumber(row.sick), reportNumber(row.personal),
        reportNumber(row.absent), reportNumber(row.late), reportNumber(row.early), reportNumber(row.maternity),
      ])
    }
  }

  doc.setFontSize(8.2)
  const longestPositionWidth = rows.reduce((max, row) => {
    const text = row.positionTitle?.trim() || '-'
    return Math.max(max, doc.getTextWidth(text) + 4)
  }, 0)
  const basePositionWidth = Math.min(Math.max(52, longestPositionWidth), 76)
  const baseColumnWidths = {
    sequence: 10,
    name: 48,
    position: basePositionWidth,
    employment: 38,
    number: 15,
  }
  const baseFlexibleWidth = baseColumnWidths.name + baseColumnWidths.position + baseColumnWidths.employment + (baseColumnWidths.number * 7)
  const flexibleScale = (tableWidth - baseColumnWidths.sequence) / baseFlexibleWidth
  const columnWidths = {
    sequence: baseColumnWidths.sequence,
    name: baseColumnWidths.name * flexibleScale,
    position: baseColumnWidths.position * flexibleScale,
    employment: baseColumnWidths.employment * flexibleScale,
    number: baseColumnWidths.number * flexibleScale,
  }

  autoTable(doc, {
    startY: 21,
    head: [['ลำดับ', 'ชื่อ-สกุล', 'ตำแหน่ง', 'ประเภทการจ้าง', 'พัก', 'ป่วย', 'กิจ', 'ขาด', 'สาย', 'ก่อน', 'คลอด']],
    body,
    showHead: 'everyPage',
    styles: {
      font: 'Sarabun', fontSize: 8.2, cellPadding: 1.1, valign: 'middle',
      lineColor: [65, 85, 100], lineWidth: 0.15, textColor: [20, 35, 48],
    },
    // Only the regular Sarabun face is embedded in this app. Keeping the
    // table on that face prevents jsPDF from falling back to a Latin font for
    // Thai glyphs when a synthetic bold face is requested.
    headStyles: { fillColor: [66, 135, 185], textColor: [255, 255, 255], fontStyle: 'normal', halign: 'center' },
    tableWidth,
    columnStyles: {
      0: { cellWidth: columnWidths.sequence, halign: 'center' },
      1: { cellWidth: columnWidths.name },
      2: { cellWidth: columnWidths.position },
      3: { cellWidth: columnWidths.employment },
      4: { cellWidth: columnWidths.number, halign: 'center' },
      5: { cellWidth: columnWidths.number, halign: 'center' },
      6: { cellWidth: columnWidths.number, halign: 'center' },
      7: { cellWidth: columnWidths.number, halign: 'center' },
      8: { cellWidth: columnWidths.number, halign: 'center' },
      9: { cellWidth: columnWidths.number, halign: 'center' },
      10: { cellWidth: columnWidths.number, halign: 'center' },
    },
    didParseCell(cell: CellHookData) {
      if (cell.section === 'head' && cell.column.index >= 4) {
        cell.cell.styles.fillColor = [72, 157, 125]
      }
      if (cell.section === 'body' && departmentRows.has(cell.row.index)) {
        cell.cell.styles.fillColor = [255, 244, 166]
        cell.cell.styles.fontStyle = 'normal'
        cell.cell.styles.textColor = [80, 62, 0]
        cell.cell.styles.halign = 'left'
      }
    },
    didDrawPage(data) {
      doc.setFontSize(7)
      doc.setTextColor(90, 105, 115)
      doc.text(`หน้า ${data.pageNumber}`, pageWidth - tableMargin.right, pageHeight - 5, { align: 'right' })
    },
    margin: tableMargin,
  })

  return doc
}

export function exportAttendancePdf(rows: AttendanceReportRow[], from: string, to: string) {
  const doc = buildAttendancePdf(rows, from, to)
  doc.save(`สรุปวันลาและการมาปฏิบัติงาน-${from}-ถึง-${to}.pdf`)
}

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
