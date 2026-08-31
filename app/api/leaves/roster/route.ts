import { z } from 'zod'
import { addAttendanceRosterPerson } from '@/lib/server/attendance'
import { requireAttendanceRecorder } from '@/lib/server/auth'
import { readJson, respond } from '@/lib/server/route'

const schema = z.object({ userId: z.string().uuid() })

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireAttendanceRecorder()
    const body = await readJson(request, schema)
    return addAttendanceRosterPerson(body.userId, actor.id)
  })
}
