import { z } from 'zod'
import { fiscalYearForDate } from '@/lib/attendance'
import { bangkokDateString } from '@/lib/dates'
import { canManageAttendance, getVacationBalances, upsertVacationBalance } from '@/lib/server/attendance'
import { requireActor, requireAttendanceRecorder } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'

const fiscalYearSchema = z.coerce.number().int().min(2000).max(2200)
const halfDayNumber = z.number().min(0).max(365).refine(
  (value) => Number.isInteger(value * 2),
  'จำนวนวันต้องเพิ่มทีละ 0.5 วัน',
)
const updateSchema = z.object({
  userId: z.string().uuid(),
  fiscalYear: fiscalYearSchema,
  previousDays: halfDayNumber,
  currentDays: halfDayNumber,
})

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const rawFiscalYear = new URL(request.url).searchParams.get('fiscalYear')
    const fiscalYear = rawFiscalYear
      ? fiscalYearSchema.parse(rawFiscalYear)
      : fiscalYearForDate(bangkokDateString())
    const [data, canManage] = await Promise.all([
      getVacationBalances(fiscalYear),
      canManageAttendance(actor),
    ])
    return { ...data, canManage }
  })
}

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireAttendanceRecorder()
    const body = await readJson(request, updateSchema)
    if (!Number.isInteger(body.previousDays * 2) || !Number.isInteger(body.currentDays * 2)) {
      throw new HttpError(400, 'จำนวนวันต้องเพิ่มทีละ 0.5 วัน')
    }
    return upsertVacationBalance(
      body.userId,
      body.fiscalYear,
      body.previousDays,
      body.currentDays,
      actor.id,
    )
  })
}
