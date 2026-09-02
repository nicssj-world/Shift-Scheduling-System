'use client'

import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { Button, inputCls } from '@/components/ui'

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
    <div className="rounded-2xl border border-line bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
        <div className="flex items-center gap-3 xl:mr-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <CalendarDays size={18} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink">ช่วงเวลาประวัติ</p>
            <p className="text-xs text-slate-500">กรองตามเดือนที่สร้างคำขอ</p>
          </div>
        </div>

        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:max-w-xl">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-slate-600">
            <span>ตั้งแต่เดือน</span>
            <input
              type="month" value={from} onChange={(e) => onFromChange(e.target.value)}
              aria-label="เดือนเริ่มต้น"
              className={inputCls}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-slate-600">
            <span>ถึงเดือน</span>
            <input
              type="month" value={to} onChange={(e) => onToChange(e.target.value)}
              aria-label="เดือนสิ้นสุด"
              className={inputCls}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 xl:ml-auto xl:border-t-0 xl:pt-0">
          {(from || to) && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <RotateCcw size={14} aria-hidden="true" />
              ล้างตัวกรอง
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500"><b className="text-sm text-ink">{total}</b> รายการ</span>
            <Button size="sm" variant="outline" className="!min-h-11 !min-w-11 !justify-center !p-0" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="หน้าก่อนหน้า">
              <ChevronLeft size={16} />
            </Button>
            <span className="whitespace-nowrap text-xs font-semibold text-slate-600">หน้า {page}/{totalPages}</span>
            <Button size="sm" variant="outline" className="!min-h-11 !min-w-11 !justify-center !p-0" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="หน้าถัดไป">
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
