import { requireActor } from '@/lib/server/auth'
import { getStaffDirectory } from '@/lib/server/data'
import { respond } from '@/lib/server/route'

/** Staff directory served via service role (profiles RLS only allows self-read). */
export async function GET() {
  return respond(async () => {
    await requireActor()
    const staff = await getStaffDirectory()
    return { staff }
  })
}
