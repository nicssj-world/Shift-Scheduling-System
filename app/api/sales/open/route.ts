import { requireActor } from '@/lib/server/auth'
import { getOpenSales } from '@/lib/server/open-sales'
import { getSaleSettings } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const settings = await getSaleSettings()
    if (!settings.openEnabled) throw new HttpError(403, 'ระบบยังไม่เปิดตลาดเวรเปิดขาย')
    const params = new URL(request.url).searchParams
    return getOpenSales(actor, {
      from: params.get('from'),
      to: params.get('to'),
      teamId: params.get('teamId'),
      page: Number(params.get('page') ?? 1),
      pageSize: Number(params.get('pageSize') ?? 20),
    })
  })
}
