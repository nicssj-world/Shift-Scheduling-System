import 'server-only'

import { nextMonth } from '@/lib/dates'
import { HttpError } from '@/lib/server/errors'

export type HistoryFilter = {
  page: number
  pageSize: number
  offset: number
  /** inclusive lower bound for created_at (first day of `from` month), or null */
  gte: string | null
  /** exclusive upper bound for created_at (first day of the month after `to`), or null */
  lt: string | null
}

/** Creation-option endpoints must always be scoped to exactly one roster
 * month. Missing the parameter must fail closed; otherwise they silently
 * return every future published schedule and mix months in the modal. */
export function parseOptionMonth(url: URL) {
  const month = url.searchParams.get('month')
  if (!month || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpError(400, 'กรุณาระบุเดือนในรูปแบบ YYYY-MM')
  }
  return month
}

/** Parses ?from=YYYY-MM&to=YYYY-MM&page=&pageSize= for a paginated history list. */
export function parseHistoryFilter(url: URL): HistoryFilter {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (from && !/^\d{4}-\d{2}$/.test(from)) throw new HttpError(400, 'รูปแบบ from ต้องเป็น YYYY-MM')
  if (to && !/^\d{4}-\d{2}$/.test(to)) throw new HttpError(400, 'รูปแบบ to ต้องเป็น YYYY-MM')

  const page = Math.max(1, Math.trunc(Number(url.searchParams.get('page') ?? '1')) || 1)
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get('pageSize') ?? '20')) || 20))

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    gte: from ? `${from}-01` : null,
    lt: to ? `${nextMonth(to)}-01` : null,
  }
}
