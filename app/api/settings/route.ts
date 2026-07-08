import { z } from 'zod'
import { requireActor, requireAdmin } from '@/lib/server/auth'
import { getSchedulerConfig, getSwapSettings } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  return respond(async () => {
    await requireActor()
    const [scheduler, swap] = await Promise.all([getSchedulerConfig(), getSwapSettings()])
    const admin = getAdminClient()
    const { data: schedulers } = await admin.from('shift_schedulers').select('user_id,created_at')
    const ids = (schedulers ?? []).map((s) => String(s.user_id))
    let names: Record<string, string> = {}
    if (ids.length > 0) {
      const { data: profiles } = await admin.from('profiles').select('id,name').in('id', ids)
      names = Object.fromEntries((profiles ?? []).map((p) => [String(p.id), String(p.name)]))
    }
    return {
      scheduler,
      swap,
      schedulers: (schedulers ?? []).map((s) => ({ userId: String(s.user_id), name: names[String(s.user_id)] ?? '' })),
    }
  })
}

const putSchema = z.object({
  scheduler: z.object({
    maxShiftsPerMonth: z.number().int().min(1).max(31),
    allowAfternoonNightDouble: z.boolean(),
    minRestHoursAfterNight: z.number().min(0).max(24),
    requireWeeklyDayOff: z.boolean(),
    weights: z.object({
      total: z.number().min(0), type: z.number().min(0),
      weekend: z.number().min(0), consecutive: z.number().min(0),
      pairing: z.number().min(0),
    }),
  }).optional(),
  swap: z.object({ requiresApproval: z.boolean() }).optional(),
  addScheduler: z.string().uuid().optional(),
  removeScheduler: z.string().uuid().optional(),
})

export async function PUT(request: Request) {
  return respond(async () => {
    const actor = await requireAdmin()
    const body = await readJson(request, putSchema)
    const admin = getAdminClient()
    const now = new Date().toISOString()

    if (body.scheduler) {
      const { error } = await admin.from('shift_settings')
        .upsert({ key: 'scheduler', value: body.scheduler, updated_by: actor.id, updated_at: now })
      if (error) throw new HttpError(500, error.message)
    }
    if (body.swap) {
      const { error } = await admin.from('shift_settings')
        .upsert({ key: 'swap', value: body.swap, updated_by: actor.id, updated_at: now })
      if (error) throw new HttpError(500, error.message)
    }
    if (body.addScheduler) {
      const { error } = await admin.from('shift_schedulers')
        .upsert({ user_id: body.addScheduler, granted_by: actor.id })
      if (error) throw new HttpError(500, error.message)
    }
    if (body.removeScheduler) {
      const { error } = await admin.from('shift_schedulers').delete().eq('user_id', body.removeScheduler)
      if (error) throw new HttpError(500, error.message)
    }
    return { ok: true }
  })
}
