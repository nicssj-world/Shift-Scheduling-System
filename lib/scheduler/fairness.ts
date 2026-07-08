import type { PersonStats, SchedulerWeights } from '@/lib/scheduler/types'
import type { DayClass } from '@/lib/types'

export function emptyStats(): PersonStats {
  return { total: 0, byType: {}, weekendHoliday: 0, byJob: {} }
}

/** Lower is better. Deterministic — no randomness anywhere. */
export function fairnessScore(
  stats: PersonStats,
  code: string,
  dayClass: DayClass,
  consecutiveBefore: number,
  weights: SchedulerWeights,
): number {
  return (
    weights.total * stats.total +
    weights.type * (stats.byType[code] ?? 0) +
    (dayClass !== 'weekday' ? weights.weekend * stats.weekendHoliday : 0) +
    weights.consecutive * consecutiveBefore
  )
}

/** Count consecutive days with work immediately before `date`. */
export function consecutiveWorkDaysBefore(workDates: Set<string>, date: string): number {
  let count = 0
  let cursor = date
  while (count < 14) {
    const prev = shiftDate(cursor, -1)
    if (!workDates.has(prev)) break
    count += 1
    cursor = prev
  }
  return count
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
