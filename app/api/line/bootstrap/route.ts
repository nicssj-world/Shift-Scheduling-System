import { requireLineSessionActor } from '@/lib/server/line-session'
import { getLineAccountByUserId } from '@/lib/server/line-accounts'
import { getLineSettings } from '@/lib/server/line-config'
import { getSaleSettings } from '@/lib/server/data'
import { respond } from '@/lib/server/route'
import { HttpError } from '@/lib/server/errors'

export async function GET() {
  return respond(async () => {
    const actor = await requireLineSessionActor()
    const [account, settings, saleSettings] = await Promise.all([
      getLineAccountByUserId(actor.id),
      getLineSettings(),
      getSaleSettings(),
    ])
    if (!settings.enabled) throw new HttpError(503, 'LINE Integration ยังไม่เปิดใช้งาน')
    return {
      actor: { id: actor.id, name: actor.name, role: actor.role, dept: actor.dept, isAdmin: actor.isAdmin, isScheduler: actor.isScheduler, isManager: actor.isManager },
      account: account ? { status: String(account.status), linkedAt: account.linked_at } : null,
      settings: {
        swapEnabled: settings.enabled && settings.swapEnabled,
        saleEnabled: settings.enabled && settings.saleEnabled,
        openSaleEnabled: settings.enabled && settings.openSaleEnabled,
        openMarketEnabled: settings.enabled && saleSettings.openEnabled,
        dailyRosterEnabled: settings.enabled && settings.dailyRosterEnabled,
      },
    }
  })
}
