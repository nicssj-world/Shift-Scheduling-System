import { z } from 'zod'
import { requireActor, requireManager } from '@/lib/server/auth'
import { getHolidays } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  return respond(async () => {
    await requireActor()
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? '2020-01-01'
    const to = url.searchParams.get('to') ?? '2099-12-31'
    return { holidays: await getHolidays(from, to) }
  })
}

const createSchema = z.object({
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nameTh: z.string().min(1).max(120),
  kind: z.enum(['public', 'special']).default('public'),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireManager()
    const body = await readJson(request, createSchema)
    const admin = getAdminClient()
    const { error } = await admin.from('shift_holidays').upsert({
      holiday_date: body.holidayDate,
      name_th: body.nameTh,
      kind: body.kind,
      created_by: actor.id,
    })
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}

const deleteSchema = z.object({ holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export async function DELETE(request: Request) {
  return respond(async () => {
    await requireManager()
    const body = await readJson(request, deleteSchema)
    const admin = getAdminClient()
    const { error } = await admin.from('shift_holidays').delete().eq('holiday_date', body.holidayDate)
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}
