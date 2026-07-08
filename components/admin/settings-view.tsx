'use client'

import { useCallback, useEffect, useState } from 'react'
import { Save, UserMinus, UserPlus } from 'lucide-react'
import { Button, Card, ErrorNote, Field, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import type { StaffProfile } from '@/lib/types'

type SchedulerConfig = {
  maxShiftsPerMonth: number
  allowAfternoonNightDouble: boolean
  minRestHoursAfterNight: number
  requireWeeklyDayOff: boolean
  weights: { total: number; type: number; weekend: number; consecutive: number }
}

type SettingsData = {
  scheduler: SchedulerConfig
  swap: { requiresApproval: boolean }
  schedulers: { userId: string; name: string }[]
}

export function SettingsView() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [staff, setStaff] = useState<StaffProfile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [addUser, setAddUser] = useState('')

  const load = useCallback(async () => {
    try {
      const [settingsRes, staffRes] = await Promise.all([
        api<SettingsData>('/api/settings'),
        api<{ staff: StaffProfile[] }>('/api/staff'),
      ])
      setData(settingsRes)
      setStaff(staffRes.staff)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) })
      await load()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <Spinner />
  const s = data.scheduler

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">ตั้งค่าระบบ</h1>
      <ErrorNote error={error} />
      {saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-700">บันทึกแล้ว ✓</div>}

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-bold">กฎการจัดเวรอัตโนมัติ</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="จำนวนเวรสูงสุดต่อคนต่อเดือน">
            <input type="number" min={1} max={31} className={inputCls} value={s.maxShiftsPerMonth}
              onChange={(e) => setData({ ...data, scheduler: { ...s, maxShiftsPerMonth: Number(e.target.value) } })} />
          </Field>
          <Field label="พักขั้นต่ำหลังเวรดึก (ชั่วโมง)">
            <input type="number" min={0} max={24} className={inputCls} value={s.minRestHoursAfterNight}
              onChange={(e) => setData({ ...data, scheduler: { ...s, minRestHoursAfterNight: Number(e.target.value) } })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.allowAfternoonNightDouble}
            onChange={(e) => setData({ ...data, scheduler: { ...s, allowAfternoonNightDouble: e.target.checked } })} />
          อนุญาตเวรควบ (บ่ายควบดึก = 16 ชม.พอดี) — ห้ามเกิน 16 ชม.ติดต่อกันเสมอ
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.requireWeeklyDayOff}
            onChange={(e) => setData({ ...data, scheduler: { ...s, requireWeeklyDayOff: e.target.checked } })} />
          ต้องมีวันหยุดอย่างน้อย 1 วันต่อสัปดาห์
        </label>
        <div>
          <div className="mb-1 text-[13px] font-semibold">น้ำหนักความสมดุล (ค่ามาก = เกลี่ยเรื่องนั้นมากขึ้น)</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ['total', 'จำนวนเวรรวม'],
              ['type', 'เวรประเภทเดียวกัน'],
              ['weekend', 'เวรวันหยุด'],
              ['consecutive', 'วันติดต่อกัน'],
            ] as [keyof SchedulerConfig['weights'], string][]).map(([key, label]) => (
              <Field key={key} label={label}>
                <input type="number" min={0} className={inputCls} value={s.weights[key]}
                  onChange={(e) => setData({ ...data, scheduler: { ...s, weights: { ...s.weights, [key]: Number(e.target.value) } } })} />
              </Field>
            ))}
          </div>
        </div>
        <Button disabled={busy} onClick={() => save({ scheduler: data.scheduler })}><Save size={15} /> บันทึกกฎการจัดเวร</Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-bold">การแลกเวร</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.swap.requiresApproval}
            onChange={(e) => setData({ ...data, swap: { requiresApproval: e.target.checked } })} />
          การแลกเวรต้องได้รับอนุมัติจากผู้จัดเวร (ปิด = คู่แลกตอบรับแล้วปรับตารางทันที)
        </label>
        <Button disabled={busy} onClick={() => save({ swap: data.swap })}><Save size={15} /> บันทึก</Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-bold">ผู้ได้รับมอบหมายจัดเวร (นอกเหนือจาก Admin/Manager)</h2>
        {data.schedulers.length === 0 && <div className="text-[13px] text-slate-400">ยังไม่มีผู้ได้รับมอบหมาย</div>}
        {data.schedulers.map((sch) => (
          <div key={sch.userId} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
            <span className="font-medium">{sch.name}</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => save({ removeScheduler: sch.userId })}>
              <UserMinus size={13} /> ถอนสิทธิ์
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <select className={inputCls} value={addUser} onChange={(e) => setAddUser(e.target.value)}>
            <option value="">— เลือกบุคลากร —</option>
            {staff.filter((p) => !data.schedulers.some((sch) => sch.userId === p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.role}</option>
            ))}
          </select>
          <Button disabled={!addUser || busy} onClick={() => { save({ addScheduler: addUser }); setAddUser('') }}>
            <UserPlus size={15} /> มอบหมาย
          </Button>
        </div>
      </Card>
    </div>
  )
}
