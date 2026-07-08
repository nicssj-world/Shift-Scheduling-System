import type { ScheduleBundle } from '@/components/schedule/schedule-view'
import type { DayClass } from '@/lib/types'

export type RosterExportData = {
  month: string
  teamName: string
  groups: { code: string; name: string; startTime: string; endTime: string; columns: string[] }[]
  days: { date: string; dayClass: DayClass }[]
  /** `${date}|${groupCode}|${columnIndex}` → name */
  cellText: Record<string, string>
}

/** Transform the schedule bundle into the paper-roster export structure
 *  (shared by PDF and Excel exports). */
export function buildRosterExportData(bundle: ScheduleBundle, month: string): RosterExportData {
  const nameByUser = new Map(bundle.members.map((m) => [m.userId, m.displayName]))
  const reqFor = (typeId: string, dayClass: DayClass) =>
    bundle.requirements.find((r) => r.shift_type_id === typeId && r.day_class === dayClass)?.required_count ?? 0

  const groups = bundle.shiftTypes
    .filter((t) => t.is_active)
    .filter((t) => (['weekday', 'weekend', 'holiday'] as DayClass[]).some((dc) => reqFor(t.id, dc) > 0))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => {
      const columns = bundle.team.uses_jobs && bundle.jobs.length > 0
        ? bundle.jobs.map((j) => j.name_th)
        : Array.from(
            { length: Math.max(...(['weekday', 'weekend', 'holiday'] as DayClass[]).map((dc) => reqFor(t.id, dc)), 1) },
            (_, i) => `คนที่ ${i + 1}`,
          )
      return { id: t.id, code: t.code, name: t.name_th, startTime: t.start_time, endTime: t.end_time, columns }
    })

  const cellText: Record<string, string> = {}
  for (const group of groups) {
    for (const day of bundle.days) {
      const list = bundle.assignments.filter((a) => a.work_date === day.date && a.shift_type_id === group.id)
      const placed: (string | null)[] = group.columns.map(() => null)
      const rest: string[] = []
      if (bundle.team.uses_jobs && bundle.jobs.length > 0) {
        for (const a of list) {
          const idx = bundle.jobs.findIndex((j) => j.id === a.job_id)
          const name = nameByUser.get(a.user_id) ?? '?'
          if (idx >= 0 && !placed[idx]) placed[idx] = name
          else rest.push(name)
        }
      } else {
        rest.push(...list.map((a) => nameByUser.get(a.user_id) ?? '?'))
      }
      for (const name of rest) {
        const empty = placed.findIndex((p) => p === null)
        if (empty >= 0) placed[empty] = name
        else placed[placed.length - 1] = `${placed[placed.length - 1]}, ${name}`
      }
      placed.forEach((name, i) => {
        if (name) cellText[`${day.date}|${group.code}|${i}`] = name
      })
    }
  }

  return {
    month,
    teamName: bundle.team.name_th,
    groups: groups.map(({ id: _id, ...g }) => g),
    days: bundle.days,
    cellText,
  }
}
