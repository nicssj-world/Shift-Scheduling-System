'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Download, Edit3, Filter, Lock, Plus, RefreshCw, Save, Search, Trash2, UserMinus, Users,
} from 'lucide-react'
import { Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import {
  bangkokDateString, bangkokMonthNow, datesOfMonth, dayOfWeek, nextMonth,
  previousMonth, thaiMonthLabel, thaiShortDate, THAI_DAYS_SHORT,
} from '@/lib/dates'
import {
  ATTENDANCE_CODE_SHORT, ATTENDANCE_CODE_TH, ATTENDANCE_CODES, ATTENDANCE_REPORT_CATEGORIES,
  ATTENDANCE_REPORT_CATEGORY_TH, DEPARTMENTS, type AttendanceCode, type AttendanceReportCategory,
  type Holiday,
} from '@/lib/types'
import {
  expandIsoDateRange, fiscalYearForDate, fiscalYearRange, thaiFiscalYear, type AttendanceReportRow,
} from '@/lib/attendance'

type AttendancePerson = {
  id: string
  name: string
  role: string
  dept: string | null
  position_title: string | null
  employment_type: string | null
  isActive: boolean
}

type AttendanceRecordView = {
  id: string
  user_id: string
  record_date: string
  code: AttendanceCode
  note: string | null
  source: 'manual' | 'excel'
  source_ref: string | null
  created_by: string
  created_at: string
  updated_by: string | null
  updated_at: string
  deleted_by: string | null
  deleted_at: string | null
  userName: string
  userDept: string | null
  positionTitle: string | null
  employmentType: string | null
}

type GridResponse = {
  scope: 'all'
  month: string
  me: string
  canManage: boolean
  canManageHolidays: boolean
  people: AttendancePerson[]
  availablePeople: AttendancePerson[]
  records: AttendanceRecordView[]
  holidays: Holiday[]
}

type HistoryResponse = {
  scope: 'mine'
  me: string
  canManage: boolean
  from: string | null
  to: string | null
  records: AttendanceRecordView[]
  totals: AttendanceReportRow | null
  nextCursor: string | null
}

type ReportResponse = { from: string; to: string; rows: AttendanceReportRow[] }
type HolidayResponse = { holidays: Holiday[] }

type VacationBalanceRow = {
  userId: string
  name: string
  dept: string | null
  positionTitle: string | null
  employmentType: string | null
  fiscalYear: number
  previousDays: number
  currentDays: number
  totalDays: number
  usedDays: number
  remainingDays: number
  updatedAt: string | null
}

type VacationBalancesResponse = {
  fiscalYear: number
  from: string
  to: string
  canManage: boolean
  rows: VacationBalanceRow[]
}

type VacationDraft = { previousDays: string; currentDays: string }

type FormState = {
  mode: 'create' | 'edit'
  id?: string
  userId: string
  code: AttendanceCode
  fromDate: string
  toDate: string
  selectedDates: string[]
  note: string
  source?: 'manual' | 'excel'
}

type HolidayFormState = {
  mode: 'create' | 'edit'
  holidayDate: string
  nameTh: string
  kind: 'public' | 'special'
}

type Preset = 'half1' | 'half2' | 'fiscal'

const UNKNOWN_DEPT = 'ไม่ระบุงาน'

const CODE_SURFACE: Record<AttendanceCode, string> = {
  vacation: 'border-sky-200 bg-sky-50 text-sky-800',
  sick: 'border-rose-200 bg-rose-50 text-rose-800',
  sick_half: 'border-rose-200 bg-rose-50 text-rose-800',
  personal: 'border-amber-200 bg-amber-50 text-amber-900',
  personal_half: 'border-amber-200 bg-amber-50 text-amber-900',
  absent: 'border-red-300 bg-red-100 text-red-900',
  late: 'border-violet-200 bg-violet-50 text-violet-800',
  early: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  vacation_half: 'border-sky-200 bg-sky-50 text-sky-800',
  maternity: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
}

function emptyTotals(): Record<AttendanceReportCategory, number> {
  return Object.fromEntries(ATTENDANCE_REPORT_CATEGORIES.map((key) => [key, 0])) as Record<AttendanceReportCategory, number>
}

function fiscalRange(baseDate: string) {
  const year = Number(baseDate.slice(0, 4))
  const month = Number(baseDate.slice(5, 7))
  const startYear = month >= 10 ? year : year - 1
  return { start: `${startYear}-10-01`, end: `${startYear + 1}-09-30` }
}

function halfRange(baseDate: string, half: 1 | 2) {
  const { start, end } = fiscalRange(baseDate)
  return half === 1
    ? { start, end: `${Number(start.slice(0, 4)) + 1}-03-31` }
    : { start: `${Number(start.slice(0, 4)) + 1}-04-01`, end }
}

function groupName(dept: string | null) {
  return dept && (DEPARTMENTS as readonly string[]).includes(dept) ? dept : UNKNOWN_DEPT
}

function formatCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function isWeekendDate(date: string) {
  const weekday = dayOfWeek(date)
  return weekday === 0 || weekday === 6
}

function SyncedTableScroll({ children, label, className = '' }: {
  children: ReactNode
  label: string
  className?: string
}) {
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bottom = bottomRef.current
    const spacer = spacerRef.current
    if (!bottom || !spacer) return
    const updateWidth = () => { spacer.style.width = `${bottom.scrollWidth}px` }
    updateWidth()
    const frame = window.requestAnimationFrame(updateWidth)
    const observer = new ResizeObserver(updateWidth)
    observer.observe(bottom)
    if (bottom.firstElementChild) observer.observe(bottom.firstElementChild)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[11px] font-medium text-slate-500">
        <span>เลื่อนตารางซ้าย–ขวา</span>
        <span className="hidden sm:inline">แถบเลื่อนด้านบน</span>
      </div>
      <div
        ref={topRef}
        className="mb-2 h-5 overflow-x-auto overflow-y-hidden rounded-md border border-line bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        style={{ scrollbarGutter: 'stable' }}
        tabIndex={0}
        aria-label={`${label} แถบเลื่อนด้านบน`}
        onScroll={(event) => {
          if (bottomRef.current) bottomRef.current.scrollLeft = event.currentTarget.scrollLeft
        }}
      >
        <div ref={spacerRef} className="h-px" />
      </div>
      <div
        ref={bottomRef}
        className={`overflow-x-auto ${className}`}
        style={{ scrollbarGutter: 'stable' }}
        tabIndex={0}
        aria-label={label}
        onScroll={(event) => {
          if (topRef.current) topRef.current.scrollLeft = event.currentTarget.scrollLeft
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function LeavesView() {
  const [tab, setTab] = useState<'all' | 'mine' | 'vacation'>('all')
  const [month, setMonth] = useState(bangkokMonthNow())
  const [grid, setGrid] = useState<GridResponse | null>(null)
  const [mineRecords, setMineRecords] = useState<AttendanceRecordView[]>([])
  const [mineTotals, setMineTotals] = useState<Record<AttendanceReportCategory, number>>(emptyTotals())
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [mineFrom, setMineFrom] = useState('')
  const [mineTo, setMineTo] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mineLoading, setMineLoading] = useState(false)
  const [vacationLoading, setVacationLoading] = useState(false)
  const [vacationFiscalYear, setVacationFiscalYear] = useState(() => fiscalYearForDate(bangkokDateString()))
  const [vacationData, setVacationData] = useState<VacationBalancesResponse | null>(null)
  const [vacationDrafts, setVacationDrafts] = useState<Record<string, VacationDraft>>({})
  const [savingVacationUserId, setSavingVacationUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [formHolidays, setFormHolidays] = useState<Holiday[]>([])
  const [holidaysLoading, setHolidaysLoading] = useState(false)
  const [holidayForm, setHolidayForm] = useState<HolidayFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AttendanceRecordView | null>(null)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [rosterAddUserId, setRosterAddUserId] = useState('')
  const [removePersonTarget, setRemovePersonTarget] = useState<AttendancePerson | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportFrom, setReportFrom] = useState(halfRange(bangkokDateString(), 2).start)
  const [reportTo, setReportTo] = useState(halfRange(bangkokDateString(), 2).end)
  const holidayRequestId = useRef(0)

  const dates = useMemo(() => datesOfMonth(month), [month])

  const loadGrid = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<GridResponse>(`/api/leaves?scope=all&month=${month}`)
      setGrid(data)
      setCanManage(data.canManage)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดทะเบียนไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [month])

  const loadMine = useCallback(async (cursor: string | null = null, append = false) => {
    setMineLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ scope: 'mine', limit: '50' })
      if (mineFrom) params.set('from', mineFrom)
      if (mineTo) params.set('to', mineTo)
      if (cursor) params.set('cursor', cursor)
      const data = await api<HistoryResponse>(`/api/leaves?${params.toString()}`)
      setMineRecords((current) => append ? [...current, ...data.records] : data.records)
      setMineTotals(data.totals ? ATTENDANCE_REPORT_CATEGORIES.reduce((totals, key) => {
        totals[key] = Number(data.totals?.[key] ?? 0)
        return totals
      }, emptyTotals()) : emptyTotals())
      setNextCursor(data.nextCursor)
      setCanManage(data.canManage)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดประวัติไม่สำเร็จ')
    } finally {
      setMineLoading(false)
    }
  }, [mineFrom, mineTo])

  const loadVacation = useCallback(async () => {
    setVacationLoading(true)
    setError(null)
    try {
      const data = await api<VacationBalancesResponse>(`/api/leaves/vacation-balances?fiscalYear=${vacationFiscalYear}`)
      setVacationData(data)
      setVacationDrafts(Object.fromEntries(data.rows.map((row) => [row.userId, {
        previousDays: formatCount(row.previousDays),
        currentDays: formatCount(row.currentDays),
      }])))
      setCanManage(data.canManage)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลสิทธิ์พักร้อนไม่สำเร็จ')
    } finally {
      setVacationLoading(false)
    }
  }, [vacationFiscalYear])

  const loadFormHolidays = useCallback(async (from: string, to: string) => {
    const requestId = ++holidayRequestId.current
    if (!from || !to || from > to) {
      setFormHolidays([])
      setHolidaysLoading(false)
      return
    }

    setHolidaysLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const data = await api<HolidayResponse>(`/api/holidays?${params.toString()}`)
      if (requestId === holidayRequestId.current) {
        const holidayDates = new Set(data.holidays.map((holiday) => holiday.holiday_date))
        setFormHolidays(data.holidays)
        setForm((current) => current ? {
          ...current,
          selectedDates: current.selectedDates.filter((date) => !isWeekendDate(date) && !holidayDates.has(date)),
        } : current)
      }
    } catch (e) {
      if (requestId === holidayRequestId.current) {
        setFormHolidays([])
        setError(e instanceof Error ? e.message : 'โหลดข้อมูลวันหยุดที่ sync แล้วไม่สำเร็จ')
      }
    } finally {
      if (requestId === holidayRequestId.current) setHolidaysLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'all') void loadGrid()
    else if (tab === 'mine') void loadMine()
    else void loadVacation()
  }, [tab, loadGrid, loadMine, loadVacation])

  function notify(message: string) {
    setSuccess(message)
    window.setTimeout(() => setSuccess(null), 2500)
  }

  function openCreate(userId = '', date = bangkokDateString()) {
    setError(null)
    setForm({
      mode: 'create', userId, code: 'vacation', fromDate: date, toDate: date,
      selectedDates: isWeekendDate(date) ? [] : [date], note: '',
    })
    void loadFormHolidays(date, date)
  }

  function openEdit(record: AttendanceRecordView) {
    setError(null)
    setForm({
      mode: 'edit', id: record.id, userId: record.user_id, code: record.code,
      fromDate: record.record_date, toDate: record.record_date,
      selectedDates: isWeekendDate(record.record_date) ? [] : [record.record_date], note: record.note ?? '', source: record.source,
    })
    void loadFormHolidays(record.record_date, record.record_date)
  }

  function updateRange(field: 'fromDate' | 'toDate', value: string) {
    if (!form) return
    const fromDate = field === 'fromDate' ? value : form.fromDate
    const toDate = field === 'toDate' ? value : form.toDate
    const selectedDates = expandIsoDateRange(fromDate, toDate).filter((date) => !isWeekendDate(date))
    setForm({ ...form, fromDate, toDate, selectedDates })
    void loadFormHolidays(fromDate, toDate)
  }

  function updateSingleDate(value: string) {
    setForm((current) => current ? {
      ...current,
      fromDate: value,
      toDate: value,
      selectedDates: value && !isWeekendDate(value) ? [value] : [],
    } : current)
    void loadFormHolidays(value, value)
  }

  function toggleDate(date: string) {
    if (isWeekendDate(date) || formHolidayByDate.has(date)) return
    setForm((current) => {
      if (!current || current.mode === 'edit') return current
      const selectedDates = current.selectedDates.includes(date)
        ? current.selectedDates.filter((item) => item !== date)
        : [...current.selectedDates, date].sort()
      return { ...current, selectedDates }
    })
  }

  function setAllRangeDates(selected: boolean) {
    setForm((current) => {
      if (!current || current.mode === 'edit') return current
      return {
        ...current,
        selectedDates: selected
          ? expandIsoDateRange(current.fromDate, current.toDate).filter((date) => !isWeekendDate(date) && !formHolidayByDate.has(date))
          : [],
      }
    })
  }

  async function submitForm() {
    if (!form) return
    if (!form.userId) {
      setError('กรุณาเลือกบุคลากรที่จะบันทึก')
      return
    }
    if (form.selectedDates.length === 0) {
      setError('กรุณาเลือกอย่างน้อยหนึ่งวันที่')
      return
    }
    if (form.selectedDates.length > 366) {
      setError('ช่วงที่บันทึกได้ไม่เกิน 366 วันต่อครั้ง')
      return
    }
    if (form.selectedDates.some((date) => isWeekendDate(date) || formHolidayByDate.has(date))) {
      setError('ไม่สามารถบันทึกวันเสาร์–อาทิตย์หรือวันหยุดได้')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (form.mode === 'edit' && form.id) {
        await api(`/api/leaves/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ recordDate: form.selectedDates[0], code: form.code, note: form.note || null }),
        })
        notify('แก้ไขรายการแล้ว')
      } else {
        await api('/api/leaves', {
          method: 'POST',
          body: JSON.stringify({ userId: form.userId, code: form.code, dates: form.selectedDates, note: form.note || undefined }),
        })
        notify(`บันทึก ${form.selectedDates.length} วันแล้ว`)
      }
      setForm(null)
      await loadGrid()
      if (tab === 'mine') await loadMine()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกรายการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function removeRecord() {
    if (!deleteTarget) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/leaves/${deleteTarget.id}`, { method: 'DELETE' })
      setDeleteTarget(null)
      notify('ลบรายการออกจากทะเบียนแล้ว')
      await loadGrid()
      if (tab === 'mine') await loadMine()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลบรายการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function updateVacationDraft(userId: string, field: keyof VacationDraft, value: string) {
    setVacationDrafts((current) => ({
      ...current,
      [userId]: { ...(current[userId] ?? { previousDays: '0', currentDays: '0' }), [field]: value },
    }))
  }

  function vacationDraftValues(row: VacationBalanceRow) {
    const draft = vacationDrafts[row.userId]
    const previousDays = Number(draft?.previousDays ?? row.previousDays)
    const currentDays = Number(draft?.currentDays ?? row.currentDays)
    return { previousDays, currentDays }
  }

  async function saveVacationBalance(row: VacationBalanceRow) {
    const { previousDays, currentDays } = vacationDraftValues(row)
    const values = [previousDays, currentDays]
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 365 || !Number.isInteger(value * 2))) {
      setError('ยอดพักร้อนต้องเป็น 0–365 วัน และเพิ่มทีละ 0.5 วัน')
      return
    }

    setSavingVacationUserId(row.userId)
    setError(null)
    try {
      await api('/api/leaves/vacation-balances', {
        method: 'POST',
        body: JSON.stringify({
          userId: row.userId,
          fiscalYear: vacationFiscalYear,
          previousDays,
          currentDays,
        }),
      })
      await loadVacation()
      notify(`บันทึกสิทธิ์พักร้อนของ ${row.name} แล้ว`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกสิทธิ์พักร้อนไม่สำเร็จ')
    } finally {
      setSavingVacationUserId(null)
    }
  }

  function openRosterManager() {
    setError(null)
    setRosterAddUserId(grid?.availablePeople[0]?.id ?? '')
    setRosterOpen(true)
  }

  async function addRosterPerson() {
    if (!rosterAddUserId) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/leaves/roster', {
        method: 'POST',
        body: JSON.stringify({ userId: rosterAddUserId }),
      })
      await loadGrid()
      setRosterAddUserId('')
      notify('เพิ่มบุคลากรเข้าตารางแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เพิ่มบุคลากรเข้าตารางไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function removeRosterPerson() {
    if (!removePersonTarget) return
    const target = removePersonTarget
    setBusy(true)
    setError(null)
    try {
      await api(`/api/leaves/roster/${target.id}`, { method: 'DELETE' })
      setRemovePersonTarget(null)
      await loadGrid()
      notify('นำบุคลากรออกจากตารางแล้ว ประวัติเดิมยังคงอยู่')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'นำบุคลากรออกจากตารางไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function openHolidayEditor(date = `${month}-01`) {
    const holiday = (grid?.holidays ?? []).find((item) => item.holiday_date === date)
    setError(null)
    setHolidayForm({
      mode: holiday ? 'edit' : 'create',
      holidayDate: date,
      nameTh: holiday?.name_th ?? '',
      kind: holiday?.kind ?? 'public',
    })
  }

  function updateHolidayDate(date: string) {
    const holiday = (grid?.holidays ?? []).find((item) => item.holiday_date === date)
    setHolidayForm((current) => current ? {
      mode: holiday ? 'edit' : 'create',
      holidayDate: date,
      nameTh: holiday?.name_th ?? '',
      kind: holiday?.kind ?? 'public',
    } : current)
  }

  async function saveHoliday() {
    if (!holidayForm || !holidayForm.holidayDate || !holidayForm.nameTh.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/holidays', {
        method: 'POST',
        body: JSON.stringify({
          holidayDate: holidayForm.holidayDate,
          nameTh: holidayForm.nameTh.trim(),
          kind: holidayForm.kind,
        }),
      })
      const wasEditing = holidayForm.mode === 'edit'
      setHolidayForm(null)
      await loadGrid()
      if (form) await loadFormHolidays(form.fromDate, form.toDate)
      notify(wasEditing ? 'แก้ไขวันหยุดแล้ว' : 'เพิ่มวันหยุดแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกวันหยุดไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function syncHolidays() {
    const year = Number(month.slice(0, 4))
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ imported: number; updated: number; removed: number; totalFromGoogle: number }>('/api/holidays/sync', {
        method: 'POST',
        body: JSON.stringify({ year }),
      })
      await loadGrid()
      if (form) await loadFormHolidays(form.fromDate, form.toDate)
      notify(`Sync วันหยุด พ.ศ. ${year + 543} แล้ว · เพิ่ม ${result.imported} ปรับปรุง ${result.updated} ลบเก่า ${result.removed}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync วันหยุดไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function setReportPreset(preset: Preset) {
    const range = preset === 'fiscal' ? fiscalRange(bangkokDateString()) : halfRange(bangkokDateString(), preset === 'half1' ? 1 : 2)
    setReportFrom(range.start)
    setReportTo(range.end)
  }

  async function downloadReport() {
    if (!reportFrom || !reportTo || reportFrom > reportTo) {
      setError('กรุณาตรวจสอบช่วงวันที่รายงาน')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const data = await api<ReportResponse>(`/api/reports/leaves?from=${reportFrom}&to=${reportTo}`)
      const { exportAttendancePdf } = await import('@/lib/reports/pdf')
      exportAttendancePdf(data.rows, reportFrom, reportTo)
      setReportOpen(false)
      notify('สร้าง PDF แล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้าง PDF ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const people = useMemo(() => grid?.people ?? [], [grid])
  const availablePeople = useMemo(() => grid?.availablePeople ?? [], [grid])
  const formRangeDates = form ? expandIsoDateRange(form.fromDate, form.toDate) : []
  const monthHolidayByDate = useMemo(() => new Map((grid?.holidays ?? []).map((holiday) => [holiday.holiday_date, holiday])), [grid])
  const formHolidayByDate = new Map(formHolidays.map((holiday) => [holiday.holiday_date, holiday]))
  const formSingleDate = formRangeDates.length === 1 ? formRangeDates[0] : null
  const formSingleHoliday = formSingleDate ? formHolidayByDate.get(formSingleDate) : null
  const formSingleIsWeekend = formSingleDate ? isWeekendDate(formSingleDate) : false
  const formAllowedRangeDates = formRangeDates.filter((date) => !isWeekendDate(date) && !formHolidayByDate.has(date))
  const formBlockedDateCount = formRangeDates.length - formAllowedRangeDates.length
  const filteredPeople = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('th')
    return people.filter((person) => {
      const matchesName = !query || person.name.toLocaleLowerCase('th').includes(query)
      const matchesDept = !filterDept || groupName(person.dept) === filterDept
      return matchesName && matchesDept
    })
  }, [filterDept, people, search])

  const filteredVacationRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('th')
    return (vacationData?.rows ?? []).filter((row) => {
      const matchesName = !query || row.name.toLocaleLowerCase('th').includes(query)
      const matchesDept = !filterDept || groupName(row.dept) === filterDept
      return matchesName && matchesDept
    })
  }, [filterDept, search, vacationData?.rows])

  const groupedPeople = useMemo(() => {
    const groups = new Map<string, AttendancePerson[]>()
    for (const person of filteredPeople) {
      const name = groupName(person.dept)
      groups.set(name, [...(groups.get(name) ?? []), person])
    }
    return [...groups.entries()].sort((a, b) => {
      const aIndex = DEPARTMENTS.indexOf(a[0] as (typeof DEPARTMENTS)[number])
      const bIndex = DEPARTMENTS.indexOf(b[0] as (typeof DEPARTMENTS)[number])
      if (aIndex === -1 && bIndex === -1) return a[0].localeCompare(b[0], 'th')
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
  }, [filteredPeople])

  const groupedVacationRows = useMemo(() => {
    const groups = new Map<string, VacationBalanceRow[]>()
    for (const row of filteredVacationRows) {
      const name = groupName(row.dept)
      groups.set(name, [...(groups.get(name) ?? []), row])
    }
    return [...groups.entries()].sort((a, b) => {
      const aIndex = DEPARTMENTS.indexOf(a[0] as (typeof DEPARTMENTS)[number])
      const bIndex = DEPARTMENTS.indexOf(b[0] as (typeof DEPARTMENTS)[number])
      if (aIndex === -1 && bIndex === -1) return a[0].localeCompare(b[0], 'th')
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
  }, [filteredVacationRows])

  const recordsByCell = useMemo(() => {
    const map = new Map<string, AttendanceRecordView[]>()
    for (const record of grid?.records ?? []) {
      const key = `${record.user_id}|${record.record_date}`
      map.set(key, [...(map.get(key) ?? []), record])
    }
    return map
  }, [grid?.records])

  const departments = useMemo(() => {
    const source = tab === 'vacation' ? (vacationData?.rows ?? []) : people
    const values = new Set(source.map((person) => groupName(person.dept)))
    const result: string[] = DEPARTMENTS.filter((department) => values.has(department))
    if (values.has(UNKNOWN_DEPT)) result.push(UNKNOWN_DEPT)
    return result
  }, [people, tab, vacationData?.rows])

  const vacationSummary = useMemo(() => (vacationData?.rows ?? []).reduce((summary, row) => ({
    total: summary.total + row.totalDays,
    used: summary.used + row.usedDays,
    remaining: summary.remaining + row.remainingDays,
  }), { total: 0, used: 0, remaining: 0 }), [vacationData?.rows])

  function handleCellKeyDown(event: KeyboardEvent<HTMLDivElement>, userId: string, date: string) {
    if (!canManage || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    openCreate(userId, date)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-[-0.02em]">
            <CalendarDays size={20} className="text-brand-700" /> ทะเบียนวันลาและการมาปฏิบัติงาน
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] text-slate-600">ธุรการบันทึกข้อมูลแทนบุคลากร เพื่อให้ทุกคนตรวจสอบวันลา มาสาย และกลับก่อนของตนเองได้ ข้อมูลนี้ไม่มีผลต่อการจัดเวร</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <>
            {tab !== 'vacation' && <Button className="min-h-11" onClick={() => openCreate()}><Plus size={16} /> เพิ่มรายการ</Button>}
            <Button variant="outline" className="min-h-11" onClick={openRosterManager}><Users size={16} /> จัดการรายชื่อ</Button>
          </>}
          {tab === 'all' && grid?.canManageHolidays && <>
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => openHolidayEditor()}><CalendarPlus size={16} /> เพิ่มวันหยุด</Button>
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={syncHolidays}><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Sync วันหยุด</Button>
          </>}
          {tab === 'all' && <Button variant="outline" className="min-h-11" onClick={() => setReportOpen(true)}><Download size={16} /> PDF สรุป</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2" role="tablist" aria-label="มุมมองทะเบียน">
        <button
          role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}
          className={`min-h-11 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tab === 'all' ? 'bg-brand-700 text-white shadow-sm' : 'border border-line bg-white text-slate-700 hover:bg-brand-50'}`}
        >วันลาทุกคน</button>
        <button
          role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}
          className={`min-h-11 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tab === 'mine' ? 'bg-brand-700 text-white shadow-sm' : 'border border-line bg-white text-slate-700 hover:bg-brand-50'}`}
        >วันลาของฉัน</button>
        <button
          role="tab" aria-selected={tab === 'vacation'} onClick={() => setTab('vacation')}
          className={`min-h-11 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tab === 'vacation' ? 'bg-brand-700 text-white shadow-sm' : 'border border-line bg-white text-slate-700 hover:bg-brand-50'}`}
        >วันลาพักร้อน</button>
        {canManage && <span className="ml-auto text-xs text-mint-700">คุณมีสิทธิ์บันทึกทะเบียน</span>}
      </div>

      <ErrorNote error={error} />
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800" role="status">{success}</div>}

      {tab === 'all' ? (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto flex items-center gap-2">
              <button onClick={() => setMonth(previousMonth(month))} className="min-h-11 min-w-11 rounded-xl border border-line bg-white p-2 text-slate-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="เดือนก่อน"><ChevronLeft size={17} /></button>
              <div className="min-w-36 text-center text-sm font-bold">{thaiMonthLabel(month)}</div>
              <button onClick={() => setMonth(nextMonth(month))} className="min-h-11 min-w-11 rounded-xl border border-line bg-white p-2 text-slate-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="เดือนถัดไป"><ChevronRight size={17} /></button>
            </div>
            <div className="relative min-w-56 flex-1 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
              <input aria-label="ค้นหาชื่อ" className={`${inputCls} pl-9`} placeholder="ค้นหาชื่อบุคลากร" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="relative min-w-52 flex-1 sm:flex-none">
              <Filter size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
              <select aria-label="กรองตามงาน" className={`${inputCls} pl-9`} value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                <option value="">ทุกงาน</option>
                {departments.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-slate-50 px-3 py-2" aria-label="คำอธิบายรหัสทะเบียน">
            <span className="text-xs font-bold text-slate-700">รหัส:</span>
            {ATTENDANCE_CODES.map((code) => (
              <span key={code} className="inline-flex items-center gap-1 text-xs text-slate-700">
                <span className={`inline-flex min-h-6 min-w-7 items-center justify-center rounded-md border px-1 font-bold ${CODE_SURFACE[code]}`}>{ATTENDANCE_CODE_SHORT[code]}</span>
                <span>{ATTENDANCE_CODE_TH[code]}</span>
              </span>
            ))}
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-800"><Lock size={12} aria-hidden="true" />ส–อา · ปิดรับข้อมูล</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900"><Lock size={12} aria-hidden="true" />วันหยุด · ปิดรับข้อมูล</span>
          </div>

          {loading ? <Spinner /> : groupedPeople.length === 0 ? <EmptyState text="ไม่พบบุคลากรตามตัวกรอง" /> : (
            <SyncedTableScroll label="ตารางทะเบียนรายเดือน เลื่อนซ้ายขวาเพื่อดูวันที่" className="rounded-xl border border-line bg-white">
              <table className="min-w-[1780px] border-separate border-spacing-0 text-xs tabular-nums">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 min-w-[250px] border-b border-r border-line bg-slate-100 px-3 py-2 text-left font-bold text-slate-700">บุคลากร / งาน</th>
                    {dates.map((date) => {
                      const holiday = monthHolidayByDate.get(date)
                      const weekend = isWeekendDate(date)
                      return (
                        <th
                          key={date}
                          title={holiday?.name_th}
                          className={`sticky top-0 z-20 w-12 min-w-12 border-b border-line p-0 text-center font-bold ${holiday ? 'bg-amber-100 text-amber-950' : weekend ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-700'}`}
                        >
                          {grid?.canManageHolidays ? (
                            <button
                              type="button"
                              className="min-h-14 w-full px-1 py-2 hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
                              onClick={() => openHolidayEditor(date)}
                              aria-label={`${holiday ? 'แก้ไข' : 'เพิ่ม'}วันหยุด วันที่ ${thaiShortDate(date)}${holiday ? ` ${holiday.name_th}` : ''}`}
                            >
                              <span className="block">{Number(date.slice(8, 10))}</span>
                              <span className="mt-0.5 block text-[10px] font-normal">{THAI_DAYS_SHORT[dayOfWeek(date)]}</span>
                              {holiday && <span className="mt-0.5 block text-[9px] font-semibold leading-none">หยุด</span>}
                            </button>
                          ) : (
                            <div className="min-h-14 px-1 py-2">
                              <div>{Number(date.slice(8, 10))}</div>
                              <div className="mt-0.5 text-[10px] font-normal">{THAI_DAYS_SHORT[dayOfWeek(date)]}</div>
                              {holiday && <div className="mt-0.5 text-[9px] font-semibold leading-none">หยุด</div>}
                            </div>
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {groupedPeople.map(([department, departmentPeople]) => (
                    <Fragment key={department}>
                      <tr>
                        <th colSpan={dates.length + 1} className="border-b border-t border-amber-200 bg-amber-100 px-3 py-2 text-left font-bold text-amber-950">{department} <span className="font-normal text-amber-800">· {departmentPeople.length} คน</span></th>
                      </tr>
                      {departmentPeople.map((person) => (
                        <tr key={person.id}>
                          <th className="sticky left-0 z-10 min-w-[250px] border-b border-r border-line bg-white px-3 py-2 text-left align-top">
                            <div className="truncate text-[13px] font-semibold text-slate-800">{person.name}</div>
                            <div className="mt-0.5 truncate text-[11px] font-normal text-slate-500">{person.position_title ?? person.role ?? 'ไม่ระบุตำแหน่ง'}</div>
                          </th>
                          {dates.map((date) => {
                            const records = recordsByCell.get(`${person.id}|${date}`) ?? []
                            const holiday = monthHolidayByDate.get(date)
                            const weekend = isWeekendDate(date)
                            const blocked = Boolean(holiday) || weekend
                            const dayDescription = holiday ? ` วันหยุด ${holiday.name_th}` : weekend ? ' วันเสาร์หรืออาทิตย์' : ''
                            return (
                              <td key={date} className="border-b border-line p-0 text-center align-middle">
                                <div
                                  className={`flex min-h-12 min-w-12 items-center justify-center gap-0.5 px-0.5 py-1 ${holiday ? 'bg-amber-50' : weekend ? 'bg-sky-50/80' : ''} ${canManage && !blocked ? 'cursor-pointer hover:bg-brand-50 focus-visible:bg-brand-50' : blocked ? 'cursor-not-allowed' : ''}`}
                                  role={canManage && !blocked ? 'button' : undefined}
                                  tabIndex={canManage && !blocked ? 0 : undefined}
                                  onClick={() => canManage && !blocked && openCreate(person.id, date)}
                                  onKeyDown={(event) => !blocked && handleCellKeyDown(event, person.id, date)}
                                  aria-label={blocked ? `${person.name} วันที่ ${thaiShortDate(date)}${dayDescription} ปิดรับข้อมูล` : canManage ? `เพิ่มรายการ ${person.name} วันที่ ${thaiShortDate(date)}` : `${person.name} วันที่ ${thaiShortDate(date)}`}
                                >
                                  {records.length === 0 ? (blocked ? <Lock size={12} className={holiday ? 'text-amber-500' : 'text-sky-400'} aria-hidden="true" /> : <span className="text-slate-300">·</span>) : records.map((record) => canManage ? (
                                    <button
                                      key={record.id}
                                      type="button"
                                      className={`min-h-8 min-w-8 rounded-md border px-0.5 text-[11px] font-bold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${CODE_SURFACE[record.code]}`}
                                      title={`${ATTENDANCE_CODE_TH[record.code]}${record.note ? ` · ${record.note}` : ''}${blocked ? ' · วันปิดรับข้อมูล แก้ไขไม่ได้ แต่ลบได้' : ' · คลิกเพื่อแก้ไข'}`}
                                      aria-label={`${ATTENDANCE_CODE_TH[record.code]} ${thaiShortDate(record.record_date)}${blocked ? ' วันปิดรับข้อมูล เปิดเพื่อลบรายการ' : ' แก้ไข'}`}
                                      onClick={(event) => { event.stopPropagation(); openEdit(record) }}
                                    >{ATTENDANCE_CODE_SHORT[record.code]}</button>
                                  ) : (
                                    <span key={record.id} className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border px-0.5 text-[11px] font-bold leading-tight ${CODE_SURFACE[record.code]}`} title={`${ATTENDANCE_CODE_TH[record.code]}${record.note ? ` · ${record.note}` : ''}`}>
                                      {ATTENDANCE_CODE_SHORT[record.code]}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </SyncedTableScroll>
          )}
          <p className="text-xs text-slate-500">แสดง {filteredPeople.length} จาก {people.length} คน · ช่องเสาร์–อาทิตย์และวันหยุดปิดรับข้อมูล รายการเก่ายังคงแสดงเพื่อการตรวจสอบ</p>
        </Card>
      ) : tab === 'mine' ? (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="ตั้งแต่วันที่"><input type="date" className={inputCls} value={mineFrom} onChange={(e) => setMineFrom(e.target.value)} /></Field>
              <Field label="ถึงวันที่"><input type="date" className={inputCls} value={mineTo} min={mineFrom} onChange={(e) => setMineTo(e.target.value)} /></Field>
              <Button className="min-h-11" onClick={() => loadMine()} disabled={mineLoading}><Filter size={15} /> แสดงประวัติ</Button>
            </div>
            <p className="text-xs text-slate-500">ประวัตินี้เป็นรายการที่ธุรการบันทึกในทะเบียน ไม่ใช่คำขอลาหรือสถานะอนุมัติ</p>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-bold">สรุปของฉันในช่วงที่เลือก</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {ATTENDANCE_REPORT_CATEGORIES.map((category) => (
                <div key={category} className="rounded-xl border border-line bg-slate-50 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-slate-900">{formatCount(mineTotals[category])}</div>
                  <div className="text-xs text-slate-600">{ATTENDANCE_REPORT_CATEGORY_TH[category]}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="overflow-x-auto">
            <h2 className="mb-3 text-sm font-bold">ประวัติย้อนหลัง</h2>
            {mineLoading && mineRecords.length === 0 ? <Spinner /> : mineRecords.length === 0 ? <EmptyState text="ยังไม่มีรายการในช่วงที่เลือก" /> : (
              <table className="w-full min-w-[680px] text-[13px]">
                <thead><tr className="border-b border-line text-left text-xs text-slate-600"><th className="py-2">วันที่</th><th>รหัส</th><th>รายละเอียด</th><th>แหล่งข้อมูล</th><th className="text-right">การจัดการ</th></tr></thead>
                <tbody>
                  {mineRecords.map((record) => (
                    <tr key={record.id} className="border-b border-line/70 align-top">
                      <td className="py-2 font-semibold tabular-nums">{thaiShortDate(record.record_date)}</td>
                      <td className="py-2"><span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-bold ${CODE_SURFACE[record.code]}`}>{ATTENDANCE_CODE_SHORT[record.code]} <span className="font-normal">{ATTENDANCE_CODE_TH[record.code]}</span></span></td>
                      <td className="py-2 text-slate-700">{record.note ?? <span className="text-slate-400">ไม่มีหมายเหตุ</span>}</td>
                      <td className="py-2 text-slate-600">{record.source === 'excel' ? 'นำเข้าจาก Excel' : 'ธุรการบันทึก'}</td>
                      <td className="py-2 text-right">{canManage && <span className="inline-flex gap-1"><Button size="sm" variant="outline" className="min-h-11 min-w-11 justify-center" onClick={() => openEdit(record)} aria-label={`แก้ไขรายการ ${thaiShortDate(record.record_date)}`}><Edit3 size={14} /></Button><Button size="sm" variant="danger" className="min-h-11 min-w-11 justify-center" onClick={() => setDeleteTarget(record)} aria-label={`ลบรายการ ${thaiShortDate(record.record_date)}`}><Trash2 size={14} /></Button></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {nextCursor && <div className="mt-3 flex justify-center"><Button variant="outline" className="min-h-11" disabled={mineLoading} onClick={() => loadMine(nextCursor, true)}>{mineLoading ? 'กำลังโหลด…' : 'โหลดรายการถัดไป'}</Button></div>}
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-auto">
                <h2 className="text-sm font-bold text-slate-900">สิทธิ์ลาพักร้อน ปีงบประมาณ พ.ศ. {thaiFiscalYear(vacationFiscalYear)}</h2>
                <p className="mt-1 text-xs text-slate-600">
                  {fiscalYearRange(vacationFiscalYear).from} ถึง {fiscalYearRange(vacationFiscalYear).to} · รวมพักร้อนคำนวณจากยอดปีก่อนหน้าและสิทธิ์ปีปัจจุบัน
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="min-h-11 min-w-11 rounded-xl border border-line bg-white p-2 text-slate-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  onClick={() => setVacationFiscalYear((year) => Math.max(2000, year - 1))}
                  aria-label="ปีงบประมาณก่อนหน้า"
                ><ChevronLeft size={17} /></button>
                <div className="min-w-24 text-center text-sm font-bold tabular-nums">พ.ศ. {thaiFiscalYear(vacationFiscalYear)}</div>
                <button
                  type="button"
                  className="min-h-11 min-w-11 rounded-xl border border-line bg-white p-2 text-slate-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  onClick={() => setVacationFiscalYear((year) => Math.min(2200, year + 1))}
                  aria-label="ปีงบประมาณถัดไป"
                ><ChevronRight size={17} /></button>
                {vacationFiscalYear !== fiscalYearForDate(bangkokDateString()) && (
                  <Button variant="outline" className="min-h-11" onClick={() => setVacationFiscalYear(fiscalYearForDate(bangkokDateString()))}>ปีปัจจุบัน</Button>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
              กรอก “คงเหลือจากปีงบก่อน” และ “สิทธิ์ปีงบปัจจุบัน” ทีละ 0.5 วัน ระบบจะรวมสิทธิ์และหักยอดพักร้อนจากทะเบียนรายวันให้อัตโนมัติ
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-56 flex-1 sm:flex-none">
                <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
                <input aria-label="ค้นหาชื่อในตารางสิทธิ์พักร้อน" className={`${inputCls} pl-9`} placeholder="ค้นหาชื่อบุคลากร" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="relative min-w-52 flex-1 sm:flex-none">
                <Filter size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
                <select aria-label="กรองสิทธิ์พักร้อนตามงาน" className={`${inputCls} pl-9`} value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                  <option value="">ทุกงาน</option>
                  {departments.map((department) => <option key={department} value={department}>{department}</option>)}
                </select>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Card className="border-sky-200 bg-sky-50">
              <div className="text-xs font-semibold text-sky-800">รวมสิทธิ์ทั้งหมด</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-sky-950">{formatCount(vacationSummary.total)} <span className="text-sm font-semibold">วัน</span></div>
            </Card>
            <Card className="border-violet-200 bg-violet-50">
              <div className="text-xs font-semibold text-violet-800">ใช้พักร้อนแล้ว</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-violet-950">{formatCount(vacationSummary.used)} <span className="text-sm font-semibold">วัน</span></div>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50">
              <div className="text-xs font-semibold text-emerald-800">คงเหลือทั้งหมด</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-950">{formatCount(vacationSummary.remaining)} <span className="text-sm font-semibold">วัน</span></div>
            </Card>
          </div>

          <Card className="p-0">
            {vacationLoading ? <Spinner /> : groupedVacationRows.length === 0 ? <EmptyState text="ไม่พบบุคลากรตามตัวกรอง" /> : (
              <SyncedTableScroll label="ตารางสิทธิ์ลาพักร้อน เลื่อนซ้ายขวาเพื่อดูทุกคอลัมน์" className="rounded-xl">
                <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px] tabular-nums">
                  <thead>
                    <tr className="text-left text-xs text-slate-700">
                      <th className="sticky left-0 top-0 z-20 min-w-[260px] border-b border-r border-line bg-slate-100 px-3 py-3">บุคลากร / งาน</th>
                      <th className="min-w-[150px] border-b border-line bg-slate-100 px-3 py-3 text-right">คงเหลือจากปีงบก่อน</th>
                      <th className="min-w-[150px] border-b border-line bg-slate-100 px-3 py-3 text-right">สิทธิ์ปีงบปัจจุบัน</th>
                      <th className="min-w-[130px] border-b border-line bg-sky-100 px-3 py-3 text-right text-sky-950">รวมพักร้อน</th>
                      <th className="min-w-[110px] border-b border-line bg-slate-100 px-3 py-3 text-right">ใช้แล้ว</th>
                      <th className="min-w-[120px] border-b border-line bg-emerald-100 px-3 py-3 text-right text-emerald-950">คงเหลือ</th>
                      <th className="min-w-[110px] border-b border-line bg-slate-100 px-3 py-3 text-right">บันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedVacationRows.map(([department, departmentRows]) => (
                      <Fragment key={department}>
                        <tr><th colSpan={7} className="border-b border-amber-200 bg-amber-100 px-3 py-2 text-left font-bold text-amber-950">{department} <span className="font-normal text-amber-800">· {departmentRows.length} คน</span></th></tr>
                        {departmentRows.map((row) => {
                          const values = vacationDraftValues(row)
                          const validDraft = [values.previousDays, values.currentDays].every((value) => Number.isFinite(value))
                          const totalDays = validDraft ? values.previousDays + values.currentDays : row.totalDays
                          const remainingDays = totalDays - row.usedDays
                          const dirty = values.previousDays !== row.previousDays || values.currentDays !== row.currentDays
                          return (
                            <tr key={row.userId} className="align-middle">
                              <th className="sticky left-0 z-10 border-b border-r border-line bg-white px-3 py-2 text-left">
                                <div className="font-semibold text-slate-800">{row.name}</div>
                                <div className="mt-0.5 text-[11px] font-normal text-slate-500">{row.positionTitle ?? 'ไม่ระบุตำแหน่ง'} · {department}</div>
                              </th>
                              <td className="border-b border-line px-3 py-2 text-right">
                                {canManage ? <input
                                  type="number" inputMode="decimal" min="0" max="365" step="0.5"
                                  className={`${inputCls} ml-auto min-h-11 w-28 text-right tabular-nums`}
                                  value={vacationDrafts[row.userId]?.previousDays ?? formatCount(row.previousDays)}
                                  onChange={(e) => updateVacationDraft(row.userId, 'previousDays', e.target.value)}
                                  aria-label={`คงเหลือจากปีงบก่อนของ ${row.name}`}
                                /> : formatCount(row.previousDays)}
                              </td>
                              <td className="border-b border-line px-3 py-2 text-right">
                                {canManage ? <input
                                  type="number" inputMode="decimal" min="0" max="365" step="0.5"
                                  className={`${inputCls} ml-auto min-h-11 w-28 text-right tabular-nums`}
                                  value={vacationDrafts[row.userId]?.currentDays ?? formatCount(row.currentDays)}
                                  onChange={(e) => updateVacationDraft(row.userId, 'currentDays', e.target.value)}
                                  aria-label={`สิทธิ์ปีงบปัจจุบันของ ${row.name}`}
                                /> : formatCount(row.currentDays)}
                              </td>
                              <td className="border-b border-sky-100 bg-sky-50 px-3 py-2 text-right font-bold text-sky-950">{formatCount(totalDays)}</td>
                              <td className="border-b border-line px-3 py-2 text-right font-semibold text-violet-800">{formatCount(row.usedDays)}</td>
                              <td className={`border-b px-3 py-2 text-right font-bold ${remainingDays < 0 ? 'border-red-100 bg-red-50 text-red-800' : 'border-emerald-100 bg-emerald-50 text-emerald-900'}`}>
                                {formatCount(remainingDays)}{remainingDays < 0 && <span className="ml-1 block text-[10px] font-semibold">เกินสิทธิ์</span>}
                              </td>
                              <td className="border-b border-line px-3 py-2 text-right">
                                {canManage ? <Button
                                  size="sm" className="min-h-11"
                                  disabled={!dirty || savingVacationUserId === row.userId || !validDraft}
                                  onClick={() => saveVacationBalance(row)}
                                ><Save size={14} />{savingVacationUserId === row.userId ? 'กำลังบันทึก…' : 'บันทึก'}</Button> : <span className="text-xs text-slate-400">ดูอย่างเดียว</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </SyncedTableScroll>
            )}
            <div className="border-t border-line px-4 py-3 text-xs text-slate-500">
              แสดง {filteredVacationRows.length} จาก {vacationData?.rows.length ?? 0} คน · ยอดใช้แล้วรวมพักร้อนเต็มวันและครึ่งวันจากทะเบียนในปีงบประมาณนี้
            </div>
          </Card>
        </div>
      )}

      <Modal open={rosterOpen} onClose={() => !busy && setRosterOpen(false)} title="จัดการรายชื่อในตาราง" wide>
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-900">
            เพิ่มหรือนำบุคลากรออกจากมุมมอง “วันลาทุกคน” ได้ภายหลัง โดยไม่ลบบัญชีและไม่ลบประวัติเดิม แผนกดึงจาก <code>profiles.dept</code> อัตโนมัติ
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-slate-50 p-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Field label="เพิ่มบุคลากรเข้าตาราง">
                <select className={inputCls} value={rosterAddUserId} onChange={(e) => setRosterAddUserId(e.target.value)}>
                  <option value="">— เลือกบุคลากร —</option>
                  {availablePeople.map((person) => <option key={person.id} value={person.id}>{person.name} · {groupName(person.dept)}</option>)}
                </select>
              </Field>
            </div>
            <Button className="min-h-11" disabled={busy || !rosterAddUserId} onClick={addRosterPerson}><Plus size={15} /> เพิ่มเข้าตาราง</Button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-800">รายชื่อที่อยู่ในตาราง ({people.length} คน)</h4>
              <span className="text-xs text-slate-500">แผนกแสดงตามข้อมูลบุคลากรปัจจุบัน</span>
            </div>
            {people.length === 0 ? <EmptyState text="ยังไม่มีบุคลากรในตาราง" /> : (
              <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
                {people.map((person) => (
                  <div key={person.id} className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-white px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-slate-800">{person.name}</div>
                      <div className="truncate text-[11px] text-slate-500">{groupName(person.dept)} · {person.position_title ?? person.role ?? 'ไม่ระบุตำแหน่ง'}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 min-w-11 justify-center text-red-700 hover:bg-red-50"
                      disabled={busy}
                      onClick={() => setRemovePersonTarget(person)}
                      aria-label={`นำ ${person.name} ออกจากตาราง`}
                      title="นำออกจากตาราง"
                    ><UserMinus size={15} /></Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(removePersonTarget)} onClose={() => !busy && setRemovePersonTarget(null)} title="ยืนยันการนำบุคลากรออกจากตาราง">
        {removePersonTarget && <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-700">ต้องการนำ <b>{removePersonTarget.name}</b> ออกจากมุมมองตารางวันลาทุกคนหรือไม่</p>
          <p className="text-xs text-slate-500">ระบบจะซ่อนรายชื่อจากตารางรายเดือนเท่านั้น ประวัติวันลาเดิมยังคงอยู่ในประวัติส่วนตัวและรายงาน</p>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setRemovePersonTarget(null)}>ยกเลิก</Button><Button variant="danger" disabled={busy} onClick={removeRosterPerson}>{busy ? 'กำลังนำออก…' : 'นำออกจากตาราง'}</Button></div>
        </div>}
      </Modal>

      <Modal open={Boolean(holidayForm)} onClose={() => !busy && setHolidayForm(null)} title={holidayForm?.mode === 'edit' ? 'แก้ไขวันหยุด' : 'เพิ่มวันหยุดในตาราง'}>
        {holidayForm && <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            วันหยุดมีผลต่อการจำแนกวันในตารางเวร ผู้มีสิทธิ์จัดเวร/Admin เท่านั้นที่แก้ไขได้ รายการที่แก้เองจะไม่ถูก Google Sync ทับ
          </div>
          <Field label="วันที่">
            <input
              type="date"
              className={inputCls}
              value={holidayForm.holidayDate}
              min={dates[0]}
              max={dates[dates.length - 1]}
              disabled={holidayForm.mode === 'edit'}
              onChange={(e) => updateHolidayDate(e.target.value)}
            />
          </Field>
          <Field label="ชื่อวันหยุด">
            <input className={inputCls} maxLength={120} value={holidayForm.nameTh} placeholder="เช่น วันหยุดราชการเพิ่มเติม" onChange={(e) => setHolidayForm({ ...holidayForm, nameTh: e.target.value })} />
          </Field>
          <Field label="ประเภท">
            <select className={inputCls} value={holidayForm.kind} onChange={(e) => setHolidayForm({ ...holidayForm, kind: e.target.value as 'public' | 'special' })}>
              <option value="public">วันหยุดราชการ</option>
              <option value="special">วันหยุดพิเศษ</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setHolidayForm(null)}>ยกเลิก</Button>
            <Button disabled={busy || !holidayForm.holidayDate || !holidayForm.nameTh.trim()} onClick={saveHoliday}>{busy ? 'กำลังบันทึก…' : holidayForm.mode === 'edit' ? 'บันทึกการแก้ไข' : 'เพิ่มวันหยุด'}</Button>
          </div>
        </div>}
      </Modal>

      <Modal open={Boolean(form)} onClose={() => !busy && setForm(null)} title={form?.mode === 'edit' ? 'แก้ไขรายการทะเบียน' : 'เพิ่มรายการทะเบียน'} wide>
        {form && <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-900">บันทึกในฐานะทะเบียนตรวจสอบ ไม่ส่งแจ้งเตือน และไม่เปลี่ยนผลการจัดเวร</div>
          <Field label="บุคลากร">
            <select className={inputCls} value={form.userId} disabled={form.mode === 'edit'} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">— เลือกบุคลากร —</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name} · {groupName(person.dept)}</option>)}
            </select>
          </Field>
          <Field label="รหัสทะเบียน">
            <select className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value as AttendanceCode })}>
              {ATTENDANCE_CODES.map((code) => <option key={code} value={code}>{ATTENDANCE_CODE_SHORT[code]} — {ATTENDANCE_CODE_TH[code]}</option>)}
            </select>
          </Field>
          {form.mode === 'edit' ? (
            <Field label="วันที่"><input type="date" className={inputCls} value={form.fromDate} onChange={(e) => updateSingleDate(e.target.value)} /></Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="วันที่เริ่ม"><input type="date" className={inputCls} value={form.fromDate} onChange={(e) => updateRange('fromDate', e.target.value)} /></Field>
              <Field label="ถึงวันที่"><input type="date" className={inputCls} value={form.toDate} min={form.fromDate} onChange={(e) => updateRange('toDate', e.target.value)} /></Field>
            </div>
          )}
          {holidaysLoading && <div className="text-xs text-slate-500" role="status">กำลังโหลดวันหยุดที่ sync ไว้…</div>}
          {!holidaysLoading && formSingleDate && (formSingleHoliday || formSingleIsWeekend) && (
            <div className={`rounded-xl border px-3 py-2 text-xs ${formSingleHoliday ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>
              <span className="inline-flex items-center gap-1 font-bold"><Lock size={12} aria-hidden="true" />{formSingleHoliday ? 'วันหยุด' : 'เสาร์–อาทิตย์'} · ปิดรับข้อมูล</span>
              {formSingleHoliday && <span> · {formSingleHoliday.name_th}</span>}
              {formSingleHoliday && formSingleIsWeekend && <span> · ตรงกับวันเสาร์–อาทิตย์</span>}
            </div>
          )}
          {form.mode === 'create' && formRangeDates.length > 1 && (
            <fieldset className="rounded-xl border border-line bg-slate-50 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-700">เลือกวันที่จากช่วงนี้</legend>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="mr-auto text-xs text-slate-600">
                  เลือกแล้ว <b className="text-slate-800">{form.selectedDates.length}</b> จาก {formAllowedRangeDates.length} วันที่เปิดรับข้อมูล
                  {formBlockedDateCount > 0 && <span className="ml-1 font-semibold text-amber-800">· ปิด {formBlockedDateCount} วัน (ส–อา/วันหยุด)</span>}
                </div>
                <div className="flex flex-wrap gap-2" aria-label="จัดการวันที่ในช่วง">
                  <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={formAllowedRangeDates.length === 0 || form.selectedDates.length === formAllowedRangeDates.length} onClick={() => setAllRangeDates(true)}>เลือกวันที่เปิดทั้งหมด</Button>
                  <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={form.selectedDates.length === 0} onClick={() => setAllRangeDates(false)}>ยกเลิกทั้งหมด</Button>
                </div>
              </div>
              <div className="grid max-h-52 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {formRangeDates.map((date) => {
                  const holiday = formHolidayByDate.get(date)
                  const weekend = isWeekendDate(date)
                  const blocked = Boolean(holiday) || weekend
                  return (
                    <label
                      key={date}
                      title={holiday?.name_th}
                      className={`flex min-h-11 items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${blocked ? 'cursor-not-allowed opacity-70' : 'hover:brightness-95'} ${holiday ? 'border-amber-300 bg-amber-50 text-amber-950' : weekend ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-transparent bg-white/60 text-slate-700'}`}
                    >
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-sky-600" checked={form.selectedDates.includes(date)} disabled={blocked} onChange={() => toggleDate(date)} />
                      <span className="min-w-0">
                        <span className="block font-medium">{thaiShortDate(date)} <span className="font-normal opacity-70">({THAI_DAYS_SHORT[dayOfWeek(date)]})</span></span>
                        {holiday ? <span className="block truncate text-[10px] font-semibold">วันหยุด · {holiday.name_th} · ปิดรับข้อมูล</span> : weekend ? <span className="block text-[10px] font-semibold">เสาร์–อาทิตย์ · ปิดรับข้อมูล</span> : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}
          <Field label="หมายเหตุ (ไม่บังคับ)"><textarea className={`${inputCls} min-h-20 resize-y`} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          {form.source && <p className="text-xs text-slate-500">แหล่งข้อมูลเดิม: {form.source === 'excel' ? 'นำเข้าจาก Excel' : 'ธุรการบันทึก'}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {form.mode === 'edit' && form.id && <Button variant="danger" disabled={busy} onClick={() => { const record = (grid?.records ?? []).find((item) => item.id === form.id) ?? mineRecords.find((item) => item.id === form.id); setForm(null); if (record) setDeleteTarget(record) }}><Trash2 size={15} /> ลบรายการ</Button>}
            <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>ยกเลิก</Button>
            <Button disabled={busy || holidaysLoading || !form.userId || form.selectedDates.length === 0} onClick={submitForm}>{busy ? 'กำลังบันทึก…' : 'บันทึกทะเบียน'}</Button>
          </div>
        </div>}
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => !busy && setDeleteTarget(null)} title="ยืนยันการลบรายการ">
        {deleteTarget && <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-700">ต้องการลบ <b>{ATTENDANCE_CODE_TH[deleteTarget.code]}</b> ของ <b>{deleteTarget.userName || 'บุคลากร'}</b> วันที่ <b>{thaiShortDate(deleteTarget.record_date)}</b> ออกจากทะเบียนหรือไม่</p>
          <p className="text-xs text-slate-500">ระบบจะเก็บรายการไว้เป็นประวัติภายใน แต่จะไม่แสดงในตารางและรายงานอีก</p>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDeleteTarget(null)}>ยกเลิก</Button><Button variant="danger" disabled={busy} onClick={removeRecord}>{busy ? 'กำลังลบ…' : 'ลบรายการ'}</Button></div>
        </div>}
      </Modal>

      <Modal open={reportOpen} onClose={() => !busy && setReportOpen(false)} title="ส่งออก PDF สรุปทะเบียน" wide>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">รูปแบบ A4 แนวนอน แยกกลุ่มงานตามงานปัจจุบันของบุคลากร และรวมคนที่ยอดเป็นศูนย์ในช่วงที่เลือก</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-h-11" onClick={() => setReportPreset('half1')}>ครึ่งปีแรก</Button>
            <Button size="sm" variant="outline" className="min-h-11" onClick={() => setReportPreset('half2')}>ครึ่งปีหลัง</Button>
            <Button size="sm" variant="outline" className="min-h-11" onClick={() => setReportPreset('fiscal')}>ปีงบประมาณ</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="วันเริ่ม"><input type="date" className={inputCls} value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} /></Field>
            <Field label="วันสิ้นสุด"><input type="date" className={inputCls} value={reportTo} min={reportFrom} onChange={(e) => setReportTo(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setReportOpen(false)}>ยกเลิก</Button><Button disabled={busy} onClick={downloadReport}><Download size={15} /> {busy ? 'กำลังสร้าง…' : 'ดาวน์โหลด PDF'}</Button></div>
        </div>
      </Modal>
    </div>
  )
}
