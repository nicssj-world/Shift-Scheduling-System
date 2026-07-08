import { datesOfMonth, isWeekend } from '@/lib/dates'
import type { DayInfo, JobIn, SlotDef, StaffIn } from '@/lib/scheduler/types'
import type { DayClass } from '@/lib/types'

export function makeDays(month: string, holidays: string[] = []): DayInfo[] {
  const holidaySet = new Set(holidays)
  return datesOfMonth(month).map((date) => ({
    date,
    dayClass: (holidaySet.has(date) ? 'holiday' : isWeekend(date) ? 'weekend' : 'weekday') as DayClass,
  }))
}

/** M/A/N slots with the central-lab pattern: A/N daily, M weekend+holiday only. */
export function makeSlots(required: number): SlotDef[] {
  return [
    {
      shiftTypeId: 'st-m', code: 'M', startMin: 480, endMin: 960, hours: 8,
      requiredByDayClass: { weekday: 0, weekend: required, holiday: required },
    },
    {
      shiftTypeId: 'st-a', code: 'A', startMin: 960, endMin: 1440, hours: 8,
      requiredByDayClass: { weekday: required, weekend: required, holiday: required },
    },
    {
      shiftTypeId: 'st-n', code: 'N', startMin: 0, endMin: 480, hours: 8,
      requiredByDayClass: { weekday: required, weekend: required, holiday: required },
    },
  ]
}

export function makeStaff(count: number): StaffIn[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `u${String(i + 1).padStart(2, '0')}`
    return { userId: id, key: id }
  })
}

export const FOUR_JOBS: JobIn[] = [
  { id: 'job-chem', code: 'CHEM', sortOrder: 1 },
  { id: 'job-sero', code: 'SERO', sortOrder: 2 },
  { id: 'job-hemato', code: 'HEMATO', sortOrder: 3 },
  { id: 'job-micross', code: 'MICROSS', sortOrder: 4 },
]
