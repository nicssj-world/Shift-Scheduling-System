import { getOpenSales } from '@/lib/server/open-sales'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { respond } from '@/lib/server/route'
import { getLineSettings } from '@/lib/server/line-config'
import { getSaleSettings } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor()
    const settings = await getLineSettings()
    const saleSettings = await getSaleSettings()
    if (!saleSettings.openEnabled) throw new HttpError(403, 'ระบบยังไม่เปิดตลาดเวรเปิดขาย')
    if (!settings.enabled || !settings.saleEnabled || !settings.openSaleEnabled) throw new HttpError(403, 'การประกาศขายเวรผ่าน LINE ยังไม่เปิดใช้งาน')
    const params = new URL(request.url).searchParams
    const month = params.get('month')
    return getOpenSales(actor, {
      from: params.get('from') ?? month,
      to: params.get('to') ?? month,
      teamId: params.get('teamId'),
      page: Number(params.get('page') ?? 1),
      pageSize: Number(params.get('pageSize') ?? 20),
    })
  })
}
