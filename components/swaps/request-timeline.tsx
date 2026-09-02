import { ChevronDown, History } from 'lucide-react'

export type RequestTimelineEvent = {
  id: string
  fromStatus: string | null
  toStatus: string
  createdAt: string
}

type Props = {
  events: RequestTimelineEvent[]
  statusLabels: Record<string, string>
}

function thaiDateTime(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
}

function statusLabel(status: string, labels: Record<string, string>) {
  return labels[status] ?? status
}

export function RequestTimeline({ events, statusLabels }: Props) {
  if (events.length === 0) return null

  return (
    <details className="group border-t border-line px-4 sm:px-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <History size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
          <span>ประวัติการดำเนินการ</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{events.length}</span>
        </span>
        <ChevronDown size={17} className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="relative pb-4 pl-7 pt-1 before:absolute before:bottom-5 before:left-[6px] before:top-3 before:w-px before:bg-slate-200">
        {events.map((event) => (
          <div key={event.id} className="relative pb-3 last:pb-0">
            <span className="absolute -left-7 top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500 shadow-sm" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700">
              {event.fromStatus
                ? `${statusLabel(event.fromStatus, statusLabels)} → ${statusLabel(event.toStatus, statusLabels)}`
                : `สร้างคำขอ · ${statusLabel(event.toStatus, statusLabels)}`}
            </p>
            <time className="mt-0.5 block text-xs text-slate-500" dateTime={event.createdAt}>
              {thaiDateTime(event.createdAt)}
            </time>
          </div>
        ))}
      </div>
    </details>
  )
}
