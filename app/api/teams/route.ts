import { z } from 'zod'
import { requireActor, requireManager } from '@/lib/server/auth'
import { getJobs, getRequirements, getShiftTypes, getTeamMembers, getTeams } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { ROLES } from '@/lib/types'

export async function GET() {
  return respond(async () => {
    await requireActor()
    const teams = await getTeams()
    const shiftTypes = await getShiftTypes()
    const requirements = await getRequirements()
    const bundles = await Promise.all(
      teams.map(async (team) => ({
        ...team,
        members: await getTeamMembers(team.id, false),
        jobs: await getJobs(team.id),
      })),
    )
    return { teams: bundles, shiftTypes, requirements }
  })
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(30).regex(/^[A-Za-z0-9_]+$/, 'ใช้ตัวอักษรอังกฤษ ตัวเลข และ _ เท่านั้น'),
  nameTh: z.string().min(1).max(80),
  usesJobs: z.boolean().default(false),
  allowedRoles: z.array(z.enum(ROLES)).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

export async function POST(request: Request) {
  return respond(async () => {
    await requireManager()
    const body = await readJson(request, upsertSchema)
    const admin = getAdminClient()
    const row = {
      code: body.code,
      name_th: body.nameTh,
      uses_jobs: body.usesJobs,
      allowed_roles: body.allowedRoles.length > 0 ? body.allowedRoles : null,
      is_active: body.isActive,
      sort_order: body.sortOrder,
    }
    if (body.id) {
      const { error } = await admin.from('shift_teams').update(row).eq('id', body.id)
      if (error) throw new HttpError(500, error.message)
    } else {
      const { error } = await admin.from('shift_teams').insert(row)
      if (error) throw new HttpError(409, error.message.includes('duplicate') ? 'รหัสทีมนี้มีอยู่แล้ว' : error.message)
    }
    return { ok: true }
  })
}
