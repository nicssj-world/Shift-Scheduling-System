'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import { thaiShortDate, toBE } from '@/lib/dates'
import type { Holiday } from '@/lib/types'

export function HolidaysView() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [holidays, setHolidays] = useState<Holiday[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'public' | 'special'>('public')

  const load = useCallback(async () => {
    try {
      const data = await api<{ holidays: Holiday[] }>(`/api/holidays?from=${year}-01-01&to=${year}-12-31`)
      setHolidays(data.holidays)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    }
  }, [year])

  useEffect(() => { load() }, [load])

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await api('/api/holidays', { method: 'POST', body: JSON.stringify({ holidayDate: date, nameTh: name, kind }) })
      setDate('')
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function remove(holidayDate: string) {
    if (!window.confirm(`ลบวันหยุด ${thaiShortDate(holidayDate)}?`)) return
    setBusy(true)
    try {
      await api('/api/holidays', { method: 'DELETE', body: JSON.stringify({ holidayDate }) })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">วันหยุดพิเศษ</h1>
        <select className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {Array.from({ length: 5 }, (_, i) => currentYear - 1 + i).map((y) => (
            <option key={y} value={y}>พ.ศ. {toBE(y)}</option>
          ))}
        </select>
      </div>
      <p className="text-[13px] text-slate-500">วันหยุดที่กำหนดจะมีเวรเช้าเหมือนวันเสาร์-อาทิตย์ และแสดงแรเงาในตาราง</p>
      <ErrorNote error={error} />

      <Card className="grid gap-3 sm:grid-cols-4">
        <Field label="วันที่">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="ชื่อวันหยุด">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น วันสงกรานต์" />
        </Field>
        <Field label="ประเภท">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'public' | 'special')}>
            <option value="public">วันหยุดราชการ</option>
            <option value="special">วันหยุดพิเศษ</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button disabled={!date || !name || busy} onClick={add}><Plus size={15} /> เพิ่ม</Button>
        </div>
      </Card>

      {!holidays ? <Spinner /> : holidays.length === 0 ? <Card><EmptyState text={`ยังไม่มีวันหยุดปี ${toBE(year)}`} /></Card> : (
        <Card>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-slate-500">
                <th className="py-1.5">วันที่</th><th>ชื่อ</th><th>ประเภท</th><th></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.holiday_date} className="border-b border-line/60">
                  <td className="py-1.5 font-semibold">{thaiShortDate(h.holiday_date)}</td>
                  <td>{h.name_th}</td>
                  <td>{h.kind === 'special' ? <Badge tone="amber">พิเศษ</Badge> : <Badge tone="blue">ราชการ</Badge>}</td>
                  <td className="text-right">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(h.holiday_date)}>
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
