import { z } from 'zod'
import { requireScheduler } from '@/lib/server/auth'
import { syncGoogleThaiHolidays } from '@/lib/server/google-holidays'
import { readJson, respond } from '@/lib/server/route'

const syncSchema = z.object({
  year: z.number().int().min(2000).max(2100),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireScheduler()
    const body = await readJson(request, syncSchema)
    return syncGoogleThaiHolidays(body.year, actor.id)
  })
}
