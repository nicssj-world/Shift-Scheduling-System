import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildAttendancePdf } from '@/lib/reports/pdf'
import { DEPARTMENTS } from '@/lib/types'
import { emptyAttendanceTotals, type AttendanceReportRow } from '@/lib/attendance'

describe('attendance PDF export', () => {
  it('builds a multi-page Thai landscape report with zero-total staff', () => {
    const rows: AttendanceReportRow[] = Array.from({ length: 110 }, (_, index) => ({
      userId: `user-${index}`,
      name: `บุคลากรทดสอบ ${index + 1}`,
      dept: DEPARTMENTS[index % DEPARTMENTS.length],
      positionTitle: index % 2 === 0 ? (index === 0 ? 'นักเทคนิคการแพทย์ชำนาญการพิเศษ' : 'นักเทคนิคการแพทย์') : null,
      employmentType: index % 3 === 0 ? 'ข้าราชการ' : null,
      ...emptyAttendanceTotals(),
    }))
    rows[0].vacation = 0.5
    rows[0].late = 2
    const doc = buildAttendancePdf(rows, '2026-04-01', '2026-09-30')
    const bytes = doc.output('arraybuffer') as ArrayBuffer

    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    expect(bytes.byteLength).toBeGreaterThan(10_000)
    if (process.env.RENDER_ATTENDANCE_PDF === '1') {
      writeFileSync(join(tmpdir(), 'shift-scheduler-attendance-test.pdf'), Buffer.from(bytes))
    }
  })
})
