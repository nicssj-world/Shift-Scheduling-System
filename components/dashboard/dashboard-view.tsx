'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Palmtree, ShieldCheck, UserCheck, Users } from 'lucide-react'
import {
  Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Badge, Card, EmptyState, ErrorNote, Spinner } from '@/components/ui'
import { api } from '@/lib/client-api'
import { bangkokMonthNow, thaiMonthLabel } from '@/lib/dates'

type DashboardData = {
  month: string
  today: string
  staffCount: number
  todayByType: { code: string; name: string; color: string; people: string[] }[]
  onLeaveToday: { name: string; type: string }[]
  coverage: { filled: number; required: number }
  shiftsByType: { code: string; name: string; color: string; count: number }[]
  leavesByType: { name: string; days: number }[]
  workload: { userId: string; name: string; team: string; total: number; byDate: Record<string, number> }[]
  teams: { id: string; name: string; members: number; required: number; filled: number; scheduleStatus: string | null }[]
  dates: string[]
}

const PIE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

export function DashboardView() {
  const [month, setMonth] = useState(bangkokMonthNow())
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api<DashboardData>(`/api/dashboard?month=${month}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    }
  }, [month])

  useEffect(() => { load() }, [load])

  function shiftMonth(delta: number) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  if (!data && !error) return <Spinner />

  const coverageRate = data && data.coverage.required > 0
    ? Math.round((data.coverage.filled / data.coverage.required) * 100)
    : 0
  const todayOnDuty = data?.todayByType.reduce((sum, t) => sum + t.people.length, 0) ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Dashboard ผู้บริหาร</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-line bg-white p-1.5 hover:bg-brand-50" aria-label="เดือนก่อน"><ChevronLeft size={14} /></button>
          <div className="min-w-32 text-center text-sm font-bold">{thaiMonthLabel(month)}</div>
          <button onClick={() => shiftMonth(1)} className="rounded-lg border border-line bg-white p-1.5 hover:bg-brand-50" aria-label="เดือนถัดไป"><ChevronRight size={14} /></button>
        </div>
      </div>
      <ErrorNote error={error} />
      {data && (
        <>
          {/* stat cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="glass">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-brand-100 p-2.5 text-brand-700"><Users size={20} /></div>
                <div>
                  <div className="text-2xl font-bold">{data.staffCount}</div>
                  <div className="text-xs text-slate-500">บุคลากรในทีมเวร</div>
                </div>
              </div>
            </Card>
            <Card className="glass">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-mint-100 p-2.5 text-emerald-700"><UserCheck size={20} /></div>
                <div>
                  <div className="text-2xl font-bold">{todayOnDuty}</div>
                  <div className="text-xs text-slate-500">เข้าเวรวันนี้</div>
                </div>
              </div>
            </Card>
            <Card className="glass">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-amber-100 p-2.5 text-amber-700"><Palmtree size={20} /></div>
                <div>
                  <div className="text-2xl font-bold">{data.onLeaveToday.length}</div>
                  <div className="text-xs text-slate-500">ลางานวันนี้</div>
                </div>
              </div>
            </Card>
            <Card className="glass">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-violet-100 p-2.5 text-violet-700"><ShieldCheck size={20} /></div>
                <div>
                  <div className="text-2xl font-bold">{coverageRate}%</div>
                  <div className="text-xs text-slate-500">ครอบคลุมเวร ({data.coverage.filled}/{data.coverage.required})</div>
                </div>
              </div>
            </Card>
          </div>

          {/* today + teams */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-sm font-bold">อัตรากำลังวันนี้</h2>
              {data.todayByType.length === 0 ? <EmptyState text="ไม่มีเวรวันนี้ (ยังไม่เผยแพร่ตาราง?)" /> : (
                <div className="flex flex-col gap-2">
                  {data.todayByType.map((t) => (
                    <div key={t.code} className="rounded-xl border border-line p-2.5">
                      <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
                        <span className="h-3 w-3 rounded" style={{ background: t.color }} />
                        {t.name} · {t.people.length} คน
                      </div>
                      <div className="text-xs text-slate-600">{t.people.join(', ')}</div>
                    </div>
                  ))}
                </div>
              )}
              {data.onLeaveToday.length > 0 && (
                <div className="mt-3 rounded-xl bg-amber-50 p-2.5 text-xs">
                  <b>ลาวันนี้:</b> {data.onLeaveToday.map((l) => `${l.name} (${l.type})`).join(', ')}
                </div>
              )}
            </Card>
            <Card>
              <h2 className="mb-2 text-sm font-bold">สถานะทีมเวรเดือนนี้</h2>
              <div className="flex flex-col gap-2">
                {data.teams.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-xl border border-line p-2.5 text-[13px]">
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-xs text-slate-500">{t.members} คน · จัดแล้ว {t.filled}/{t.required} เวร</div>
                    </div>
                    <Badge tone={t.scheduleStatus === 'locked' ? 'red' : t.scheduleStatus === 'published' ? 'green' : t.scheduleStatus === 'draft' ? 'gray' : 'amber'}>
                      {t.scheduleStatus === 'locked' ? 'ล็อคแล้ว' : t.scheduleStatus === 'published' ? 'เผยแพร่แล้ว' : t.scheduleStatus === 'draft' ? 'ฉบับร่าง' : 'ยังไม่จัด'}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* charts */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-sm font-bold">จำนวนเวรแต่ละประเภท (เดือนนี้)</h2>
              {data.shiftsByType.length === 0 ? <EmptyState text="ยังไม่มีข้อมูล" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.shiftsByType}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="จำนวนเวร" radius={[6, 6, 0, 0]}>
                      {data.shiftsByType.map((t) => <Cell key={t.code} fill={t.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
            <Card>
              <h2 className="mb-2 text-sm font-bold">วันลาแยกตามประเภท (เดือนนี้)</h2>
              {data.leavesByType.length === 0 ? <EmptyState text="ไม่มีการลาเดือนนี้" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={data.leavesByType} dataKey="days" nameKey="name" innerRadius={45} outerRadius={80} label={({ name, value }) => `${name} ${value}`}>
                      {data.leavesByType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* heatmap */}
          <Card>
            <h2 className="mb-2 text-sm font-bold">Heatmap ภาระงานรายบุคคล (คน × วัน)</h2>
            {data.workload.length === 0 ? <EmptyState text="ยังไม่มีข้อมูล" /> : (
              <div className="overflow-x-auto">
                <table className="text-[11px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-white pr-2 text-left font-semibold">ชื่อ</th>
                      {data.dates.map((d) => (
                        <th key={d} className="px-0.5 font-normal text-slate-400">{Number(d.slice(8, 10))}</th>
                      ))}
                      <th className="pl-2 font-semibold">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workload.map((w) => (
                      <tr key={w.userId}>
                        <td className="sticky left-0 whitespace-nowrap bg-white pr-2 font-medium">{w.name}</td>
                        {data.dates.map((d) => {
                          const n = w.byDate[d] ?? 0
                          const bg = n === 0 ? '#f1f5f9' : n === 1 ? '#7dd3fc' : '#0369a1'
                          return (
                            <td key={d} className="p-0.5">
                              <div className="h-4 w-4 rounded-sm" style={{ background: bg }} title={`${w.name} · ${d} · ${n} เวร`} />
                            </td>
                          )
                        })}
                        <td className="pl-2 font-bold">{w.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="h-3 w-3 rounded-sm bg-[#f1f5f9]" /> ว่าง
                  <span className="h-3 w-3 rounded-sm bg-[#7dd3fc]" /> 1 เวร
                  <span className="h-3 w-3 rounded-sm bg-[#0369a1]" /> 2 เวร (ควบ)
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
