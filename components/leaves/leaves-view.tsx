'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import { thaiShortDate } from '@/lib/dates'
import {
  LEAVE_STATUS_TH, LEAVE_TYPE_TH, leaveDays,
  type DayPart, type LeaveStatus, type LeaveType, type StaffProfile,
} from '@/lib/types'

type LeaveRow = {
  id: string
  user_id: string
  userName: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  day_part: DayPart
  note: string | null
  status: LeaveStatus
}

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray',
}

const DAY_PART_TH: Record<DayPart, string> = {
  full: 'เต็มวัน', half_am: 'ครึ่งวันเช้า', half_pm: 'ครึ่งวันบ่าย',
}

export function LeavesView({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<'mine' | 'all'>('mine')
  const [rows, setRows] = useState<LeaveRow[]>([])
  const [me, setMe] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [staff, setStaff] = useState<StaffProfile[]>([])

  // form state
  const [forUser, setForUser] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('vacation')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dayPart, setDayPart] = useState<DayPart>('full')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ leaves: LeaveRow[]; me: string }>(`/api/leaves?scope=${tab}`)
      setRows(data.leaves)
      setMe(data.me)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (canManage) {
      api<{ staff: StaffProfile[] }>('/api/staff').then((d) => setStaff(d.staff)).catch(() => {})
    }
  }, [canManage])

  function openForm() {
    setForUser('')
    setLeaveType('vacation')
    setStartDate('')
    setEndDate('')
    setDayPart('full')
    setNote('')
    setFormOpen(true)
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api('/api/leaves', {
        method: 'POST',
        body: JSON.stringify({
          userId: forUser || undefined,
          leaveType,
          startDate,
          endDate: dayPart === 'full' ? (endDate || startDate) : startDate,
          dayPart,
          note: note || undefined,
        }),
      })
      setFormOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function act(id: string, action: 'approve' | 'reject' | 'cancel', confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    try {
      await api(`/api/leaves/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const pending = rows.filter((r) => r.status === 'pending')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">วันลา</h1>
        <Button onClick={openForm}><Plus size={15} /> {canManage ? 'บันทึก/แจ้งลา' : 'แจ้งลา'}</Button>
      </div>

      {canManage && (
        <div className="flex gap-1">
          <button onClick={() => setTab('mine')} className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold ${tab === 'mine' ? 'bg-brand-600 text-white' : 'border border-line bg-white text-slate-600'}`}>
            วันลาของฉัน
          </button>
          <button onClick={() => setTab('all')} className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold ${tab === 'all' ? 'bg-brand-600 text-white' : 'border border-line bg-white text-slate-600'}`}>
            วันลาทุกคน {pending.length > 0 && tab !== 'all' ? `(${pending.length} รออนุมัติ)` : ''}
          </button>
        </div>
      )}

      <ErrorNote error={error} />
      {loading ? <Spinner /> : (
        <div className="flex flex-col gap-2">
          {rows.length === 0 && <Card><EmptyState text="ยังไม่มีรายการลา" /></Card>}
          {rows.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {tab === 'all' && <span>{r.userName}</span>}
                  <Badge tone="blue">{LEAVE_TYPE_TH[r.leave_type]}</Badge>
                  <Badge tone={STATUS_TONE[r.status]}>{LEAVE_STATUS_TH[r.status]}</Badge>
                </div>
                <div className="mt-0.5 text-[13px] text-slate-600">
                  {r.start_date === r.end_date ? thaiShortDate(r.start_date) : `${thaiShortDate(r.start_date)} – ${thaiShortDate(r.end_date)}`}
                  {' · '}{DAY_PART_TH[r.day_part]} · {leaveDays(r)} วัน
                  {r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                {canManage && tab === 'all' && r.status === 'pending' && (
                  <>
                    <Button size="sm" variant="success" disabled={busy} onClick={() => act(r.id, 'approve')}>อนุมัติ</Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => act(r.id, 'reject')}>ไม่อนุมัติ</Button>
                  </>
                )}
                {(r.user_id === me || canManage) && (r.status === 'pending' || r.status === 'approved') && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act(r.id, 'cancel', 'ยกเลิกรายการลานี้?')}>ยกเลิก</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={canManage ? 'บันทึกวันลา' : 'แจ้งลา'}>
        <div className="flex flex-col gap-3">
          {canManage && (
            <Field label="บุคลากร (เว้นว่าง = ตัวเอง)">
              <select className={inputCls} value={forUser} onChange={(e) => setForUser(e.target.value)}>
                <option value="">— ตัวเอง —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.dept ?? '-'})</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="ประเภทการลา">
            <select className={inputCls} value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
              {Object.entries(LEAVE_TYPE_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="ลักษณะ">
            <select className={inputCls} value={dayPart} onChange={(e) => setDayPart(e.target.value as DayPart)}>
              {Object.entries(DAY_PART_TH).map(([k, v]) => <option key={k} value={k}>{v} {k !== 'full' ? '(0.5 วัน)' : ''}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="วันที่เริ่ม">
              <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="ถึงวันที่">
              <input
                type="date"
                className={inputCls}
                value={dayPart === 'full' ? endDate : startDate}
                min={startDate}
                disabled={dayPart !== 'full'}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="หมายเหตุ (ไม่บังคับ)">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button disabled={!startDate || busy} onClick={submit}>บันทึก</Button>
          {canManage && <p className="text-xs text-slate-400">Admin/Manager บันทึกแล้วถืออนุมัติทันที · บุคลากรทั่วไปต้องรออนุมัติ</p>}
        </div>
      </Modal>
    </div>
  )
}
