import { SettingsView } from '@/components/admin/settings-view'
import { requireAdminPageActor } from '@/lib/server/auth'

export default async function AdminSettingsPage() {
  await requireAdminPageActor()
  return <SettingsView />
}
