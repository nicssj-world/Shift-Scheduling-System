import { LeavesView } from '@/components/leaves/leaves-view'
import { requirePageActor } from '@/lib/server/auth'

export default async function LeavesPage() {
  await requirePageActor()
  return <LeavesView />
}
