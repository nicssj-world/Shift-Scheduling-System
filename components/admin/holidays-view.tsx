'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
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
  const [notice, setNotice] = useState<string | null>(null)
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

  async function syncGoogle() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api<{
        imported: number
        updated: number
        removed: number
        skippedManual: number
        totalFromGoogle: number
      }>('/api/holidays/sync', {
        method: 'POST',
        body: JSON.stringify({ year }),
      })
      const manualText = result.skippedManual > 0 ? ` ข้ามรายการที่คีย์เอง ${result.skippedManual} วัน` : ''
      setNotice(`Sync สำเร็จ: เพิ่ม ${result.imported} วัน ปรับปรุง ${result.updated} วัน ลบรายการเก่า ${result.removed} วัน จาก Google ${result.totalFromGoogle} วัน${manualText}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">วันหยุดพิเศษ</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={syncGoogle}>
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Sync จาก Google
          </Button>
          <select className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 5 }, (_, i) => currentYear - 1 + i).map((y) => (
              <option key={y} value={y}>พ.ศ. {toBE(y)}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[13px] text-slate-500">วันหยุดที่กำหนดจะมีเวรเช้าเหมือนวันเสาร์-อาทิตย์ และแสดงแรเงาในตาราง · Sync จะดึงเฉพาะวันหยุดราชการจากปฏิทินไทย</p>
      <ErrorNote error={error} />
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-700">{notice}</div>}

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
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{h.name_th}</span>
                      {h.source === 'google_th_holidays' && <Badge tone="gray">Google</Badge>}
                    </div>
                  </td>
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
