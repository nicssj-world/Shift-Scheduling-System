import { requireActor } from '@/lib/server/auth'
import { datesOfMonth } from '@/lib/dates'
import { isIsoDate, isIsoMonth } from '@/lib/attendance'
import { getAttendanceReport } from '@/lib/server/attendance'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'

function toBoundary(value: string, end: boolean) {
  if (isIsoDate(value)) return value
  if (isIsoMonth(value)) {
    const dates = datesOfMonth(value)
    return end ? dates[dates.length - 1] : dates[0]
  }
  throw new HttpError(400, 'วันที่ต้องเป็น YYYY-MM-DD หรือเดือน YYYY-MM')
}

/** Summary rows for the informational attendance register. */
export async function GET(request: Request) {
  return respond(async () => {
    await requireActor()
    const url = new URL(request.url)
    const fromValue = url.searchParams.get('from')
    const toValue = url.searchParams.get('to')
    if (!fromValue || !toValue) throw new HttpError(400, 'ต้องระบุ from/to')
    const from = toBoundary(fromValue, false)
    const to = toBoundary(toValue, true)
    if (from > to) throw new HttpError(400, 'ช่วงวันที่ไม่ถูกต้อง')
    const rows = await getAttendanceReport(from, to)
    return { from, to, rows }
  })
}
