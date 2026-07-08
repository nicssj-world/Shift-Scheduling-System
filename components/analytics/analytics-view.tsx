'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Info, Sparkles, TrendingUp } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, EmptyState, ErrorNote, Spinner } from '@/components/ui'
import { api } from '@/lib/client-api'
import { thaiMonthLabel } from '@/lib/dates'

type AnalyticsData = {
  trend: { month: string; label: string; filled: number; required: number; leaves: number }[]
  insights: { severity: 'info' | 'warning' | 'error'; text: string }[]
  overStandard: { userId: string; name: string; count: number }[]
  maxShiftsPerMonth: number
  workloadRanking: { userId: string; name: string; current: number; sixMonths: number }[]
  forecast: { month: string; demand: number; capacity: number; utilization: number }
}

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<AnalyticsData>('/api/analytics')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ'))
  }, [])

  if (!data && !error) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-lg font-bold"><Sparkles size={20} className="text-brand-600" /> วิเคราะห์กำลังคนและภาระงาน</h1>
      <ErrorNote error={error} />
      {data && (
        <>
          {/* insights */}
          <div className="flex flex-col gap-2">
            {data.insights.map((ins, i) => (
              <Card key={i} className={`flex items-start gap-2.5 text-[13px] ${
                ins.severity === 'error' ? 'border-red-200 bg-red-50/70' : ins.severity === 'warning' ? 'border-amber-200 bg-amber-50/70' : ''
              }`}>
                {ins.severity === 'info'
                  ? <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
                  : <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${ins.severity === 'error' ? 'text-red-500' : 'text-amber-500'}`} />}
                <span>{ins.text}</span>
              </Card>
            ))}
          </div>

          {/* forecast */}
          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <TrendingUp size={15} /> คาดการณ์เดือน{thaiMonthLabel(data.forecast.month)}
            </h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-brand-50 p-3">
                <div className="text-xl font-bold">{data.forecast.demand}</div>
                <div className="text-xs text-slate-500">เวรที่ต้องการ</div>
              </div>
              <div className="rounded-xl bg-mint-100 p-3">
                <div className="text-xl font-bold">{data.forecast.capacity}</div>
                <div className="text-xs text-slate-500">ความจุสูงสุด (คน × {data.maxShiftsPerMonth} เวร)</div>
              </div>
              <div className={`rounded-xl p-3 ${data.forecast.utilization > 85 ? 'bg-red-100' : data.forecast.utilization > 70 ? 'bg-amber-100' : 'bg-slate-100'}`}>
                <div className="text-xl font-bold">{data.forecast.utilization}%</div>
                <div className="text-xs text-slate-500">อัตราใช้กำลังคน</div>
              </div>
            </div>
          </Card>

          {/* trend */}
          <Card>
            <h2 className="mb-2 text-sm font-bold">แนวโน้ม 6 เดือน: เวรที่จัดได้ vs ที่ต้องการ</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5eef5" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="required" name="ที่ต้องการ" stroke="#94a3b8" strokeDasharray="5 3" />
                <Line type="monotone" dataKey="filled" name="จัดได้" stroke="#0284c7" strokeWidth={2} />
                <Line type="monotone" dataKey="leaves" name="ใบลา" stroke="#f59e0b" />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* workload ranking */}
          <Card>
            <h2 className="mb-2 text-sm font-bold">ภาระงานสะสม 6 เดือน (Top 30)</h2>
            {data.workloadRanking.length === 0 ? <EmptyState text="ยังไม่มีข้อมูล" /> : (
              <ResponsiveContainer width="100%" height={Math.max(240, data.workloadRanking.length * 22)}>
                <BarChart data={data.workloadRanking} layout="vertical" margin={{ left: 24 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sixMonths" name="6 เดือน" fill="#7dd3fc" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="current" name="เดือนนี้" fill="#0369a1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
