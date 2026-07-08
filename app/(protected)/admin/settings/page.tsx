import { SettingsView } from '@/components/admin/settings-view'
import { redirect } from 'next/navigation'
import { requirePageActor } from '@/lib/server/auth'

export default async function AdminSettingsPage() {
  const actor = await requirePageActor()
  if (!actor.isAdmin) redirect('/schedule')
  return <SettingsView />
}
