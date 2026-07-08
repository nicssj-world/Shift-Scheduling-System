import { z } from 'zod'
import { requireManager } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

const putSchema = z.object({
  rows: z.array(z.object({
    teamId: z.string().uuid(),
    shiftTypeId: z.string().uuid(),
    dayClass: z.enum(['weekday', 'weekend', 'holiday']),
    requiredCount: z.number().int().min(0).max(50),
  })).max(200),
})

export async function PUT(request: Request) {
  return respond(async () => {
    await requireManager()
    const body = await readJson(request, putSchema)
    const admin = getAdminClient()
    const rows = body.rows.map((r) => ({
      team_id: r.teamId,
      shift_type_id: r.shiftTypeId,
      day_class: r.dayClass,
      required_count: r.requiredCount,
    }))
    const { error } = await admin.from('shift_requirements')
      .upsert(rows, { onConflict: 'team_id,shift_type_id,day_class' })
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}
