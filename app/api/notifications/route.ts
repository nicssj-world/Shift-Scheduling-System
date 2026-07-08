import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 100)
    const admin = getAdminClient()
    const [{ data, error }, { count }] = await Promise.all([
      admin.from('shift_notifications').select('*')
        .eq('user_id', actor.id).order('created_at', { ascending: false }).limit(limit),
      admin.from('shift_notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', actor.id).is('read_at', null),
    ])
    if (error) throw new HttpError(500, error.message)
    return { notifications: data ?? [], unreadCount: count ?? 0 }
  })
}

const markSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
})

export async function PATCH(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const body = await readJson(request, markSchema)
    const admin = getAdminClient()
    const now = new Date().toISOString()
    let query = admin.from('shift_notifications').update({ read_at: now })
      .eq('user_id', actor.id).is('read_at', null)
    if (!body.all) {
      if (!body.ids || body.ids.length === 0) return { ok: true }
      query = query.in('id', body.ids)
    }
    const { error } = await query
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}
