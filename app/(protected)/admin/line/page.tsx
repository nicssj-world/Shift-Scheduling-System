import { LineIntegrationView } from '@/components/admin/line-integration-view'
import { requireAdminPageActor } from '@/lib/server/auth'

export default async function AdminLinePage() {
  await requireAdminPageActor()
  return <LineIntegrationView />
}
