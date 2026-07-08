'use client'

import { THAI_DAYS_SHORT, dayOfWeek, thaiTime } from '@/lib/dates'
import type { Assignment, DayClass, Holiday, Job, Requirement, ShiftType, Team } from '@/lib/types'

export type BundleMember = { userId: string; displayName: string; fullName: string; role: string; ephisId: string | null }

export type RosterCell = {
  date: string
  shiftType: ShiftType
  job: Job | null
  slotIndex: number
  assignment: Assignment | null
  active: boolean
}

type Props = {
  team: Team
  shiftTypes: ShiftType[]
  requirements: Requirement[]
  jobs: Job[]
  days: { date: string; dayClass: DayClass }[]
  holidays: Holiday[]
  members: BundleMember[]
  assignments: Assignment[]
  me: string
  onCellClick?: (cell: RosterCell) => void
}

export function RosterGrid({ team, shiftTypes, requirements, jobs, days, holidays, members, assignments, me, onCellClick }: Props) {
  const nameByUser = new Map(members.map((m) => [m.userId, m.displayName]))
  const holidayByDate = new Map(holidays.map((h) => [h.holiday_date, h.name_th]))

  const reqFor = (typeId: string, dayClass: DayClass) =>
    requirements.find((r) => r.shift_type_id === typeId && r.day_class === dayClass)?.required_count ?? 0

  // shift groups shown = active types that are required on at least one day class
  const groups = shiftTypes
    .filter((t) => t.is_active)
    .filter((t) => (['weekday', 'weekend', 'holiday'] as DayClass[]).some((dc) => reqFor(t.id, dc) > 0))
    .sort((a, b) => a.sort_order - b.sort_order)

  // columns per group: jobs for job teams; otherwise max required headcount
  const columnsFor = (type: ShiftType): (Job | null)[] => {
    if (team.uses_jobs && jobs.length > 0) return jobs
    const maxRequired = Math.max(
      ...(['weekday', 'weekend', 'holiday'] as DayClass[]).map((dc) => reqFor(type.id, dc)), 1,
    )
    return Array.from({ length: maxRequired }, () => null)
  }

  // index assignments: date|typeId → list
  const byCell = new Map<string, Assignment[]>()
  for (const a of assignments) {
    const key = `${a.work_date}|${a.shift_type_id}`
    const list = byCell.get(key) ?? []
    list.push(a)
    byCell.set(key, list)
  }

  /** place assignments of one (date,type) into the group's columns */
  function placeInColumns(list: Assignment[], columns: (Job | null)[]): (Assignment | null)[] {
    const placed: (Assignment | null)[] = columns.map(() => null)
    const rest: Assignment[] = []
    if (columns[0] !== null) {
      for (const a of list) {
        const idx = columns.findIndex((j, i) => j && a.job_id === j.id && !placed[i])
        if (idx >= 0) placed[idx] = a
        else rest.push(a)
      }
    } else {
      rest.push(...list)
    }
    for (const a of rest) {
      const empty = placed.findIndex((p) => p === null)
      if (empty >= 0) placed[empty] = a
    }
    return placed
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="roster-table text-[12px]">
        <thead>
          <tr>
            <th rowSpan={2} colSpan={2} className="min-w-14">วันที่</th>
            {groups.map((type) => (
              <th key={type.id} colSpan={columnsFor(type).length} className="shift-sep">
                {type.name_th} ({thaiTime(type.start_time)}-{type.end_time.startsWith('00') ? '24.00' : thaiTime(type.end_time)} น.)
              </th>
            ))}
          </tr>
          <tr>
            {groups.map((type) =>
              columnsFor(type).map((job, i) => (
                <th key={`${type.id}-${i}`} className={`min-w-20 ${i === 0 ? 'shift-sep' : ''}`}>
                  {job ? job.name_th : `คนที่ ${i + 1}`}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const dow = dayOfWeek(day.date)
            const holidayName = holidayByDate.get(day.date)
            const rowCls = day.dayClass === 'holiday' ? 'holiday-row' : day.dayClass === 'weekend' ? 'weekend-row' : ''
            return (
              <tr key={day.date} className={rowCls}>
                <td className="font-semibold">{THAI_DAYS_SHORT[dow]}</td>
                <td className="font-semibold" title={holidayName}>
                  {Number(day.date.slice(8, 10))}
                  {holidayName ? ' 🎌' : ''}
                </td>
                {groups.map((type) => {
                  const columns = columnsFor(type)
                  const required = reqFor(type.id, day.dayClass)
                  const list = byCell.get(`${day.date}|${type.id}`) ?? []
                  const placed = placeInColumns(list, columns)
                  return columns.map((job, i) => {
                    const assignment = placed[i]
                    const active = required > 0 && i < Math.max(required, list.length)
                    const mine = assignment && assignment.user_id === me
                    const clickable = Boolean(onCellClick) && (active || Boolean(assignment))
                    return (
                      <td
                        key={`${type.id}-${i}`}
                        className={`${i === 0 ? 'shift-sep' : ''} ${mine ? 'mine' : ''} ${!active && !assignment ? 'bg-slate-50' : ''} ${clickable ? 'cursor-pointer hover:outline hover:outline-2 hover:outline-brand-400' : ''}`}
                        onClick={clickable ? () => onCellClick!({ date: day.date, shiftType: type, job, slotIndex: i, assignment, active }) : undefined}
                      >
                        {assignment ? (nameByUser.get(assignment.user_id) ?? '?') : active ? '' : ''}
                      </td>
                    )
                  })
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
