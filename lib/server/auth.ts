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
  // A designated scheduler (explicitly granted in shift_schedulers) has
  // rights equivalent to Admin for scheduling/settings, regardless of their
  // base profiles.role. Attendance uses requireAttendanceRecorder separately
  // because its recorder list is intentionally narrower.
  const isAdmin = role === 'Admin' || Boolean(schedulerRow)
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
    // Manager does NOT get schedule-management rights — only Admin/designated
    // schedulers do. Kept as a separate field (rather than just reusing
    // isAdmin) so schedule-management call sites stay self-documenting.
    isScheduler: isAdmin,
  }
}

export async function requireActor() {
  const actor = await getActor()
  if (!actor) throw new HttpError(401, 'Unauthorized')
  return actor
}

export async function requireScheduler() {
  const actor = await requireActor()
  if (!actor.isScheduler) throw new HttpError(403, 'ต้องเป็น Admin หรือผู้ได้รับมอบหมายจัดเวร')
  return actor
}

export async function requireAdmin() {
  const actor = await requireActor()
  if (!actor.isAdmin) throw new HttpError(403, 'ต้องเป็น Admin หรือผู้ได้รับมอบหมายจัดเวร')
  return actor
}

/** Attendance records have their own narrow permission list. Do not use
 * actor.isAdmin here: that flag intentionally includes designated schedulers
 * for the rest of the scheduling application. */
export async function requireAttendanceRecorder() {
  const actor = await requireActor()
  if (actor.role === 'Admin') return actor
  const { data, error } = await getAdminClient()
    .from('shift_leave_recorders')
    .select('user_id')
    .eq('user_id', actor.id)
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(403, 'ไม่มีสิทธิ์บันทึกทะเบียนวันลาและการมาปฏิบัติงาน')
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

/** Dashboard overview stays visible to Manager even though they can no
 *  longer manage schedules or settings. */
export async function requireDashboardPageActor() {
  const actor = await requirePageActor()
  if (!actor.isScheduler && !actor.isManager) redirect('/schedule')
  return actor
}

export async function requireAdminPageActor() {
  const actor = await requirePageActor()
  if (!actor.isAdmin) redirect('/schedule')
  return actor
}
