import 'server-only'

import { redirect } from 'next/navigation'
import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { normalizeRole, type Actor } from '@/lib/types'

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export async function getActor(): Promise<Actor | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = getAdminClient()
  const [{ data: profile, error: profileError }, { data: schedulerRow }] = await Promise.all([
    admin.from('profiles').select('id,name,role,dept,status,ephis_id,phone').eq('id', user.id).maybeSingle(),
    admin.from('shift_schedulers').select('user_id').eq('user_id', user.id).maybeSingle(),
  ])
  if (profileError || !profile) return null
  const status = asString(profile.status).toLowerCase()
  if (status && status !== 'active') return null

  const role = normalizeRole(asString(profile.role))
  const isAdmin = role === 'Admin'
  const isManager = role === 'Manager'
  return {
    id: asString(profile.id),
    ephisId: asString(profile.ephis_id),
    name: asString(profile.name),
    role,
    dept: asString(profile.dept) || null,
    phone: asString(profile.phone) || null,
    isAdmin,
    isManager,
    isScheduler: isAdmin || isManager || Boolean(schedulerRow),
  }
}

export async function requireActor() {
  const actor = await getActor()
  if (!actor) throw new HttpError(401, 'Unauthorized')
  return actor
}

export async function requireScheduler() {
  const actor = await requireActor()
  if (!actor.isScheduler) throw new HttpError(403, 'ต้องเป็นผู้จัดเวร (Admin/Manager/ผู้ได้รับมอบหมาย)')
  return actor
}

export async function requireManager() {
  const actor = await requireActor()
  if (!actor.isAdmin && !actor.isManager) throw new HttpError(403, 'ต้องเป็น Admin หรือ Manager')
  return actor
}

export async function requireAdmin() {
  const actor = await requireActor()
  if (!actor.isAdmin) throw new HttpError(403, 'ต้องเป็น Admin')
  return actor
}

export async function requirePageActor() {
  const actor = await getActor()
  if (!actor) redirect('/login')
  return actor
}

export async function requireSchedulerPageActor() {
  const actor = await requirePageActor()
  if (!actor.isScheduler) redirect('/schedule')
  return actor
}

export async function requireAdminPageActor() {
  const actor = await requirePageActor()
  if (!actor.isAdmin && !actor.isManager) redirect('/schedule')
  return actor
}
