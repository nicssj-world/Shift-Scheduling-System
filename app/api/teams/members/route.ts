import { z } from 'zod'
import { requireAdmin } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

const addSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
})

export async function POST(request: Request) {
  return respond(async () => {
    await requireAdmin()
    const body = await readJson(request, addSchema)
    const admin = getAdminClient()
    const { data, error } = await admin.from('shift_team_members')
      .upsert(
        { team_id: body.teamId, user_id: body.userId, is_active: true },
        { onConflict: 'team_id,user_id' },
      )
      .select('*')
      .single()
    if (error) throw new HttpError(500, error.message)
    return { member: data }
  })
}

const updateSchema = z.object({
  memberId: z.string().uuid(),
  displayLabel: z.string().max(60).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export async function PATCH(request: Request) {
  return respond(async () => {
    await requireAdmin()
    const body = await readJson(request, updateSchema)
    const patch: Record<string, unknown> = {}
    if (body.displayLabel !== undefined) patch.display_label = body.displayLabel || null
    if (body.isActive !== undefined) patch.is_active = body.isActive
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder
    const admin = getAdminClient()
    const { error } = await admin.from('shift_team_members').update(patch).eq('id', body.memberId)
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}

const removeSchema = z.object({ memberId: z.string().uuid() })

export async function DELETE(request: Request) {
  return respond(async () => {
    await requireAdmin()
    const body = await readJson(request, removeSchema)
    const admin = getAdminClient()
    // deactivate instead of delete (history references the person)
    const { error } = await admin.from('shift_team_members')
      .update({ is_active: false }).eq('id', body.memberId)
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}
