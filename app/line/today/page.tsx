import { LineShell } from '@/components/line/line-shell'
import { LineView } from '@/components/line/line-views'

export default function LineTodayPage() {
  return <LineShell><LineView kind="today" /></LineShell>
}
