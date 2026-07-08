import { AppShell } from '@/components/app-shell'
import { requirePageActor } from '@/lib/server/auth'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor()
  return (
    <AppShell
      actor={{
        id: actor.id,
        name: actor.name,
        role: actor.role,
        isAdmin: actor.isAdmin,
        isManager: actor.isManager,
        isScheduler: actor.isScheduler,
      }}
    >
      {children}
    </AppShell>
  )
}
