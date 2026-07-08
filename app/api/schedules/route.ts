import { z } from 'zod'
import { requireActor, requireScheduler } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { assertMonth, getScheduleBundle } from '@/lib/server/schedule-service'
import { getAdminClient } from '@/lib/supabase/admin'
import { bangkokDateString } from '@/lib/dates'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const url = new URL(request.url)
    const month = url.searchParams.get('month') ?? bangkokDateString().slice(0, 7)
    const teamId = url.searchParams.get('team')
    return getScheduleBundle(month, teamId, actor)
  })
}

const createSchema = z.object({
  teamId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireScheduler()
    const body = await readJson(request, createSchema)
    assertMonth(body.month)
    const admin = getAdminClient()
    const { data: existing } = await admin
      .from('shift_schedules').select('id')
      .eq('team_id', body.teamId).eq('month', `${body.month}-01`)
      .maybeSingle()
    if (existing) throw new HttpError(409, 'มีตารางเวรของเดือนนี้อยู่แล้ว')
    const { data, error } = await admin
      .from('shift_schedules')
      .insert({ team_id: body.teamId, month: `${body.month}-01`, status: 'draft', generated_by: actor.id })
      .select('*')
      .single()
    if (error) throw new HttpError(500, error.message)
    return { schedule: data }
  })
}
