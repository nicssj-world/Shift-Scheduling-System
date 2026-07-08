import type { SchedulerConfig, SlotDef } from '@/lib/scheduler/types'

export type Interval = {
  date: string
  code: string
  /** absolute minutes since 1970-01-01 00:00 UTC */
  startAbs: number
  endAbs: number
  isNight: boolean
}

export function epochDay(date: string) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000)
}

export function toInterval(date: string, slot: Pick<SlotDef, 'code' | 'startMin' | 'endMin'>): Interval {
  const base = epochDay(date) * 1440
  return {
    date,
    code: slot.code,
    startAbs: base + slot.startMin,
    endAbs: base + slot.endMin,
    isNight: slot.startMin === 0,
  }
}

export type PersonState = {
  intervals: Interval[]
  /** dates (in the scheduled month) with at least one assignment */
  workDates: Set<string>
  monthCount: number
  unavailable: Set<string>
}

export type CheckResult = { ok: true } | { ok: false; rule: string; reason: string }

const MAX_CONTIGUOUS_MIN = 16 * 60

/**
 * Hard-constraint check for adding one shift to a person's existing set.
 * Pure and order-independent: used by both the generator and the validator.
 */
export function checkAssignment(
  person: PersonState,
  date: string,
  slot: Pick<SlotDef, 'code' | 'startMin' | 'endMin'>,
  config: SchedulerConfig,
  weekDates: string[],
): CheckResult {
  if (person.unavailable.has(date)) {
    return { ok: false, rule: 'leave', reason: 'ลา/ไม่ว่างวันนี้' }
  }

  const next = toInterval(date, slot)

  for (const iv of person.intervals) {
    // overlap
    if (next.startAbs < iv.endAbs && iv.startAbs < next.endAbs) {
      return { ok: false, rule: 'overlap', reason: `ซ้อนกับ${iv.code}วันเดียวกัน` }
    }
    // rest after a night shift ends
    if (iv.isNight && next.startAbs >= iv.endAbs) {
      const gap = next.startAbs - iv.endAbs
      if (gap < config.minRestHoursAfterNight * 60) {
        return { ok: false, rule: 'rest_after_night', reason: `พักหลังเวรดึกน้อยกว่า ${config.minRestHoursAfterNight} ชม.` }
      }
    }
    // the new shift is a night shift: person must still get rest before a later shift
    if (next.isNight && iv.startAbs >= next.endAbs) {
      const gap = iv.startAbs - next.endAbs
      if (gap < config.minRestHoursAfterNight * 60) {
        return { ok: false, rule: 'rest_after_night', reason: `เวรถัดไปเริ่มเร็วเกินหลังเวรดึก` }
      }
    }
  }

  // contiguous run containing the new interval
  let runStart = next.startAbs
  let runEnd = next.endAbs
  let runShifts = 1
  let extended = true
  while (extended) {
    extended = false
    for (const iv of person.intervals) {
      if (iv.endAbs === runStart) {
        runStart = iv.startAbs
        runShifts += 1
        extended = true
      } else if (iv.startAbs === runEnd) {
        runEnd = iv.endAbs
        runShifts += 1
        extended = true
      }
    }
  }
  if (runEnd - runStart > MAX_CONTIGUOUS_MIN) {
    return { ok: false, rule: 'max_consecutive_hours', reason: 'เกิน 16 ชั่วโมงติดต่อกัน' }
  }
  if (runShifts > 1 && !config.allowAfternoonNightDouble) {
    return { ok: false, rule: 'double_shift', reason: 'ไม่อนุญาตเวรควบ (ติดต่อกัน 2 เวร)' }
  }

  if (person.monthCount >= config.maxShiftsPerMonth) {
    return { ok: false, rule: 'max_shifts', reason: `ครบ ${config.maxShiftsPerMonth} เวร/เดือนแล้ว` }
  }

  // Weekly day off is only enforceable for weeks fully inside the month —
  // partial edge weeks would otherwise reject everyone.
  if (config.requireWeeklyDayOff && weekDates.length >= 7 && !person.workDates.has(date)) {
    // must keep at least one assignment-free day in this Mon–Sun week
    const freeAfter = weekDates.filter((d) => d !== date && !person.workDates.has(d)).length
    if (freeAfter < 1) {
      return { ok: false, rule: 'weekly_day_off', reason: 'ไม่เหลือวันหยุดประจำสัปดาห์' }
    }
  }

  return { ok: true }
}

export function addToPerson(person: PersonState, date: string, slot: Pick<SlotDef, 'code' | 'startMin' | 'endMin'>) {
  person.intervals.push(toInterval(date, slot))
  person.workDates.add(date)
  person.monthCount += 1
}
