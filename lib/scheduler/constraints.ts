import type { SchedulerConfig, SlotDef } from '@/lib/scheduler/types'

export type Interval = {
  date: string
  code: string
  /** absolute minutes since 1970-01-01 00:00 UTC */
  startAbs: number
  endAbs: number
  /** True when this is a night shift subject to the consecutive-night rule. */
  isNight: boolean
  /** Implicit Mon–Fri 08:00–16:00 regular work. It counts toward continuous
   * hours, but is not an OT shift and is not controlled by the OT-double
   * toggle. */
  isRegularWork?: boolean
}

export function epochDay(date: string) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000)
}

export function toInterval(
  date: string,
  slot: Pick<SlotDef, 'code' | 'startMin' | 'endMin' | 'triggersRestAfterNight'>,
): Interval {
  const base = epochDay(date) * 1440
  return {
    date,
    code: slot.code,
    startAbs: base + slot.startMin,
    endAbs: base + slot.endMin,
    // The flag is authoritative. Production slots always carry it from
    // shift_shift_types.triggers_rest_after_night; an omitted value in a pure
    // fixture is deliberately treated as non-night rather than inferred from
    // the clock time.
    isNight: slot.triggersRestAfterNight === true,
  }
}

export type PersonState = {
  intervals: Interval[]
  /** dates (in the scheduled month) with at least one assignment */
  workDates: Set<string>
  monthCount: number
  unavailable: Set<string>
}

const REGULAR_WORK_SLOT = { code: 'REGULAR_M', startMin: 8 * 60, endMin: 16 * 60 }

export function addRegularWork(person: PersonState, date: string) {
  person.intervals.push({ ...toInterval(date, REGULAR_WORK_SLOT), isRegularWork: true })
  person.workDates.add(date)
}

export type CheckResult = { ok: true } | { ok: false; rule: string; reason: string }

const MAX_CONTIGUOUS_MIN = 16 * 60

/** Minimum recovery time between two overtime shifts. Regular 08:00–16:00
 * work is intentionally exempt because weekday OT is scheduled around it. */
export function minimumRestHoursBetweenOt(config: SchedulerConfig) {
  return Math.max(16, config.minRestHoursAfterNight)
}

/**
 * Hard-constraint check for adding one shift to a person's existing set.
 * Pure and order-independent: used by both the generator and the validator.
 */
export function checkAssignment(
  person: PersonState,
  date: string,
  slot: Pick<SlotDef, 'code' | 'startMin' | 'endMin' | 'triggersRestAfterNight'>,
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
    // A night shift must not be assigned on two consecutive work dates. The
    // normal rest-window rule alone allows N→N because there are 16 hours
    // between the two shifts, but consecutive nights are a separate roster
    // safety rule.
    if (iv.isNight && next.isNight && Math.abs(epochDay(iv.date) - epochDay(next.date)) === 1) {
      return { ok: false, rule: 'consecutive_night', reason: 'ห้ามจัดเวรดึกติดต่อกันสองวัน' }
    }
    // Every pair of OT shifts needs at least 16 hours of recovery. Regular
    // 08:00–16:00 work is intentionally exempt; it still participates in
    // overlap/continuous-hours checks below.
    if (!iv.isRegularWork && !next.isRegularWork) {
      const earlier = iv.startAbs <= next.startAbs ? iv : next
      const later = earlier === iv ? next : iv
      const gap = later.startAbs - earlier.endAbs
      if (gap < minimumRestHoursBetweenOt(config) * 60) {
        return { ok: false, rule: 'minimum_rest_between_ot', reason: `ต้องพักระหว่างเวร OT อย่างน้อย ${minimumRestHoursBetweenOt(config)} ชม.` }
      }
    }
  }

  // contiguous run containing the new interval
  let runStart = next.startAbs
  let runEnd = next.endAbs
  let runOvertimeShifts = 1
  let extended = true
  while (extended) {
    extended = false
    for (const iv of person.intervals) {
      if (iv.endAbs === runStart) {
        runStart = iv.startAbs
        if (!iv.isRegularWork) runOvertimeShifts += 1
        extended = true
      } else if (iv.startAbs === runEnd) {
        runEnd = iv.endAbs
        if (!iv.isRegularWork) runOvertimeShifts += 1
        extended = true
      }
    }
  }
  if (runEnd - runStart > MAX_CONTIGUOUS_MIN) {
    return { ok: false, rule: 'max_consecutive_hours', reason: 'เกิน 16 ชั่วโมงติดต่อกัน' }
  }
  if (runOvertimeShifts > 1 && !config.allowAfternoonNightDouble) {
    return { ok: false, rule: 'double_shift', reason: 'ไม่อนุญาตเวรควบ (ติดต่อกัน 2 เวร)' }
  }

  if (person.monthCount >= config.maxShiftsPerMonth) {
    return { ok: false, rule: 'max_shifts', reason: `ครบ ${config.maxShiftsPerMonth} เวร/เดือนแล้ว` }
  }

  // Weekly day off is enforceable whenever the complete Mon–Sun boundary is
  // known. Unknown future edge days are left unchecked until the neighboring
  // roster exists; the current month must not wait for a future roster.
  if (config.requireWeeklyDayOff && weekDates.length >= 7 && !person.workDates.has(date)) {
    // must keep at least one assignment-free day in this Mon–Sun week
    const freeAfter = weekDates.filter((d) => d !== date && !person.workDates.has(d)).length
    if (freeAfter < 1) {
      return { ok: false, rule: 'weekly_day_off', reason: 'ไม่เหลือวันหยุดประจำสัปดาห์' }
    }
  }

  return { ok: true }
}

export function addToPerson(
  person: PersonState,
  date: string,
  slot: Pick<SlotDef, 'code' | 'startMin' | 'endMin' | 'triggersRestAfterNight'>,
) {
  person.intervals.push(toInterval(date, slot))
  person.workDates.add(date)
  person.monthCount += 1
}
