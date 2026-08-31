/**
 * Normalize the supported work-date-local shift interval.
 *
 * A shift may end at 24:00 (also commonly stored/displayed as 00:00), but
 * shifts that cross midnight in any other way are intentionally rejected. The
 * scheduler's boundary carry-in is based on a work date, so silently treating
 * an arbitrary overnight interval as a negative duration would corrupt all
 * overlap and continuous-hours checks.
 */
export function normalizeShiftTimes(startTime: string, endTime: string, declaredHours?: number) {
  const startMin = parseClock(startTime, false)
  const endMin = parseClock(endTime, true)
  if (endMin <= startMin) {
    throw new Error('เวลาเวรต้องสิ้นสุดหลังเวลาเริ่มภายในวันเดียวกัน')
  }

  const hours = (endMin - startMin) / 60
  if (declaredHours !== undefined && (!Number.isFinite(declaredHours) || Math.abs(declaredHours - hours) > 0.01)) {
    throw new Error(`จำนวนชั่วโมงไม่ตรงกับช่วงเวลาเวร (${hours} ชั่วโมง)`)
  }
  return { startMin, endMin, hours }
}

function parseClock(value: string, allowEndOfDay: boolean) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) throw new Error('รูปแบบเวลาเวรไม่ถูกต้อง')
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = match[3] ? Number(match[3]) : 0
  if (minute > 59 || second !== 0 || hour > 24 || (hour === 24 && minute !== 0)) {
    throw new Error('เวลาเวรอยู่นอกช่วง 00:00–24:00')
  }
  if (hour === 24) {
    if (!allowEndOfDay) throw new Error('เวลาเริ่มเวรห้ามเป็น 24:00')
    return 1440
  }
  // A displayed 00:00 end means the end of the work date. This is the
  // canonical representation used by the existing A (16:00–24:00) shift.
  if (allowEndOfDay && hour === 0 && minute === 0) return 1440
  return hour * 60 + minute
}
