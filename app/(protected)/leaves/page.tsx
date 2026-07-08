import { LeavesView } from '@/components/leaves/leaves-view'
import { requirePageActor } from '@/lib/server/auth'

export default async function LeavesPage() {
  const actor = await requirePageActor()
  return <LeavesView canManage={actor.isAdmin || actor.isManager} />
}
