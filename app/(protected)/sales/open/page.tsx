import { OpenSalesView } from '@/components/sales/open-sales-view'
import { requirePageActor } from '@/lib/server/auth'

export default async function OpenSalesPage() {
  const actor = await requirePageActor()
  return <OpenSalesView actorId={actor.id} />
}
