import { z } from 'zod'
import { requireScheduler } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

const addSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
})

export async function POST(request: Request) {
  return respond(async () => {
    await requireScheduler()
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
  chemSeroWeight: z.number().int().min(0).max(100).optional(),
  hematoMicrosWeight: z.number().int().min(0).max(100).optional(),
}).superRefine((body, ctx) => {
  const hasChemSero = body.chemSeroWeight !== undefined
  const hasHematoMicros = body.hematoMicrosWeight !== undefined
  if (hasChemSero !== hasHematoMicros) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasChemSero ? 'hematoMicrosWeight' : 'chemSeroWeight'],
      message: 'ต้องส่งน้ำหนักทั้งสอง section พร้อมกัน',
    })
  }
  if (hasChemSero && hasHematoMicros
    && body.chemSeroWeight! + body.hematoMicrosWeight! !== 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chemSeroWeight'],
      message: 'น้ำหนักทั้งสอง section ต้องรวมกันเป็น 100%',
    })
  }
})

export async function PATCH(request: Request) {
  return respond(async () => {
    await requireScheduler()
    const body = await readJson(request, updateSchema)
    const patch: Record<string, unknown> = {}
    if (body.displayLabel !== undefined) patch.display_label = body.displayLabel || null
    if (body.isActive !== undefined) patch.is_active = body.isActive
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder
    const admin = getAdminClient()
    if (body.chemSeroWeight !== undefined && body.hematoMicrosWeight !== undefined) {
      const { data: member, error: memberError } = await admin
        .from('shift_team_members').select('team_id').eq('id', body.memberId).maybeSingle()
      if (memberError) throw new HttpError(500, memberError.message)
      if (!member) throw new HttpError(404, 'ไม่พบสมาชิกทีม')
      const teamId = String((member as { team_id: string }).team_id)
      const { data: team, error: teamError } = await admin
        .from('shift_teams').select('code').eq('id', teamId).maybeSingle()
      if (teamError) throw new HttpError(500, teamError.message)
      if (!team || team.code !== 'MT_CENTRAL') {
        throw new HttpError(400, 'ตั้งค่า section weight ได้เฉพาะทีมเจ้าหน้าที่ Central Lab')
      }
      patch.chem_sero_weight = body.chemSeroWeight
      patch.hemato_micros_weight = body.hematoMicrosWeight
    }
    const { error } = await admin.from('shift_team_members').update(patch).eq('id', body.memberId)
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}

const removeSchema = z.object({ memberId: z.string().uuid() })

export async function DELETE(request: Request) {
  return respond(async () => {
    await requireScheduler()
    const body = await readJson(request, removeSchema)
    const admin = getAdminClient()
    // deactivate instead of delete (history references the person)
    const { error } = await admin.from('shift_team_members')
      .update({ is_active: false }).eq('id', body.memberId)
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}
