import { z } from 'zod'
import { removeAttendanceRosterPerson } from '@/lib/server/attendance'
import { requireAttendanceRecorder } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'

const userIdSchema = z.string().uuid()

export async function DELETE(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  return respond(async () => {
    const actor = await requireAttendanceRecorder()
    const { userId } = await params
    const parsed = userIdSchema.safeParse(userId)
    if (!parsed.success) throw new HttpError(400, 'รหัสบุคลากรไม่ถูกต้อง')
    return removeAttendanceRosterPerson(parsed.data, actor.id)
  })
}
