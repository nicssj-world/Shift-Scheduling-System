'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui'

type Props = {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onClear: () => void
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

/** Month-range filter + pagination for a history list. Only the general
 *  history query should ever be wired to this — pending items awaiting the
 *  user's own action must always be fetched separately, unpaginated. */
export function HistoryControls({ from, to, onFromChange, onToChange, onClear, page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[13px]">
      <span className="font-semibold text-slate-500">ช่วงเดือน:</span>
      <input
        type="month" value={from} onChange={(e) => onFromChange(e.target.value)}
        className="rounded-lg border border-line px-2 py-1 text-[13px]"
      />
      <span className="text-slate-400">ถึง</span>
      <input
        type="month" value={to} onChange={(e) => onToChange(e.target.value)}
        className="rounded-lg border border-line px-2 py-1 text-[13px]"
      />
      {(from || to) && (
        <button onClick={onClear} className="text-xs font-semibold text-brand-600 hover:underline">ล้างตัวกรอง</button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-slate-500">ทั้งหมด {total} รายการ</span>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="หน้าก่อนหน้า">
          <ChevronLeft size={14} />
        </Button>
        <span className="text-slate-500">หน้า {page}/{totalPages}</span>
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="หน้าถัดไป">
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}
