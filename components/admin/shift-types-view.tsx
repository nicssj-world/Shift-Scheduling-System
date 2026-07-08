'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Save } from 'lucide-react'
import { Badge, Button, Card, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import { thaiTime } from '@/lib/dates'
import { TEAM_ELIGIBLE_ROLES, type DayClass, type Job, type Requirement, type Role, type ShiftType, type Team } from '@/lib/types'

type TeamBundle = Team & { jobs: Job[] }
type TeamDraft = Partial<Team> & { allowed_roles?: Role[] | null }

const DAY_CLASS_TH: Record<DayClass, string> = { weekday: 'จันทร์-ศุกร์', weekend: 'เสาร์-อาทิตย์', holiday: 'วันหยุดพิเศษ' }

export function ShiftTypesView() {
  const [types, setTypes] = useState<ShiftType[]>([])
  const [teams, setTeams] = useState<TeamBundle[]>([])
  const [reqs, setReqs] = useState<Requirement[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<ShiftType> | null>(null)
  const [editTeam, setEditTeam] = useState<TeamDraft | null>(null)
  const [reqDraft, setReqDraft] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ teams: TeamBundle[]; shiftTypes: ShiftType[]; requirements: Requirement[] }>('/api/teams')
      setTeams(data.teams.filter((t) => t.is_active))
      setTypes(data.shiftTypes)
      setReqs(data.requirements)
      const draft: Record<string, number> = {}
      for (const r of data.requirements) draft[`${r.team_id}|${r.shift_type_id}|${r.day_class}`] = r.required_count
      setReqDraft(draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveType() {
    if (!edit) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/shift-types', {
        method: 'POST',
        body: JSON.stringify({
          id: edit.id,
          code: edit.code,
          nameTh: edit.name_th,
          startTime: (edit.start_time ?? '08:00').slice(0, 5),
          endTime: (edit.end_time ?? '16:00').slice(0, 5),
          hours: Number(edit.hours ?? 8),
          color: edit.color ?? '#0284c7',
          isActive: edit.is_active ?? true,
          sortOrder: Number(edit.sort_order ?? 0),
        }),
      })
      setEdit(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function saveTeam() {
    if (!editTeam) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/teams', {
        method: 'POST',
        body: JSON.stringify({
          id: editTeam.id,
          code: editTeam.code,
          nameTh: editTeam.name_th,
          usesJobs: editTeam.uses_jobs ?? false,
          allowedRoles: editTeam.allowed_roles ?? [],
          isActive: editTeam.is_active ?? true,
          sortOrder: Number(editTeam.sort_order ?? teams.length + 1),
        }),
      })
      setEditTeam(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function toggleAllowedRole(role: Role) {
    setEditTeam((prev) => {
      if (!prev) return prev
      const current = prev.allowed_roles ?? []
      const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role]
      return { ...prev, allowed_roles: next }
    })
  }

  async function saveRequirements() {
    setBusy(true)
    setError(null)
    try {
      const rows = Object.entries(reqDraft).map(([key, count]) => {
        const [teamId, shiftTypeId, dayClass] = key.split('|')
        return { teamId, shiftTypeId, dayClass: dayClass as DayClass, requiredCount: count }
      })
      await api('/api/requirements', { method: 'PUT', body: JSON.stringify({ rows }) })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">ประเภทเวรและอัตรากำลัง</h1>
        <Button size="sm" onClick={() => setEdit({ code: '', name_th: '', start_time: '08:00', end_time: '16:00', hours: 8, color: '#0284c7', is_active: true, sort_order: types.length + 1 })}>
          <Plus size={14} /> เพิ่มประเภทเวร
        </Button>
      </div>
      <ErrorNote error={error} />

      <Card>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-slate-500">
              <th className="py-1.5">รหัส</th><th>ชื่อ</th><th>เวลา</th><th>ชม.</th><th>สี</th><th>สถานะ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className="border-b border-line/60">
                <td className="py-1.5 font-bold">{t.code}</td>
                <td>{t.name_th}</td>
                <td>{thaiTime(t.start_time)}–{t.end_time.startsWith('00') ? '24.00' : thaiTime(t.end_time)} น.</td>
                <td>{Number(t.hours)}</td>
                <td><span className="inline-block h-4 w-6 rounded" style={{ background: t.color }} /></td>
                <td>{t.is_active ? <Badge tone="green">ใช้งาน</Badge> : <Badge tone="gray">ปิด</Badge>}</td>
                <td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEdit({ ...t, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5) })}>
                    <Pencil size={13} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold">จำนวนคนต่อเวร (แยกตามทีม × ประเภทวัน)</h2>
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline" disabled={busy}
              onClick={() => setEditTeam({ uses_jobs: false, allowed_roles: [], is_active: true, sort_order: teams.length + 1 })}
            >
              <Plus size={14} /> เพิ่มตารางเวร
            </Button>
            <Button size="sm" variant="success" disabled={busy} onClick={saveRequirements}><Save size={14} /> บันทึก</Button>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {teams.map((team) => (
            <div key={team.id} className="overflow-x-auto">
              <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">
                {team.name_th}
                <button
                  className="text-slate-400 hover:text-brand-600"
                  onClick={() => setEditTeam({ ...team })}
                  aria-label={`แก้ไข ${team.name_th}`}
                >
                  <Pencil size={12} />
                </button>
              </div>
              <table className="text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-4">ประเภทเวร</th>
                    {(['weekday', 'weekend', 'holiday'] as DayClass[]).map((dc) => (
                      <th key={dc} className="px-2 text-center">{DAY_CLASS_TH[dc]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {types.filter((t) => t.is_active).map((t) => (
                    <tr key={t.id}>
                      <td className="py-1 pr-4 font-medium">{t.code} · {t.name_th}</td>
                      {(['weekday', 'weekend', 'holiday'] as DayClass[]).map((dc) => {
                        const key = `${team.id}|${t.id}|${dc}`
                        return (
                          <td key={dc} className="px-2 py-1 text-center">
                            <input
                              type="number" min={0} max={50}
                              className="w-16 rounded-lg border border-line px-2 py-1 text-center text-sm"
                              value={reqDraft[key] ?? 0}
                              onChange={(e) => setReqDraft((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">0 = เวรนั้นไม่เปิดในวันประเภทนั้น (เช่น เวรเช้าเปิดเฉพาะ ส-อา และวันหยุด)</p>
      </Card>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'แก้ไขประเภทเวร' : 'เพิ่มประเภทเวร'}>
        {edit && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="รหัส (เช่น M, A, N)">
                <input className={inputCls} value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
              </Field>
              <Field label="ชื่อ (ไทย)">
                <input className={inputCls} value={edit.name_th ?? ''} onChange={(e) => setEdit({ ...edit, name_th: e.target.value })} />
              </Field>
              <Field label="เวลาเริ่ม">
                <input type="time" className={inputCls} value={edit.start_time ?? ''} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} />
              </Field>
              <Field label="เวลาสิ้นสุด (00:00 = เที่ยงคืน)">
                <input type="time" className={inputCls} value={edit.end_time === '24:00' ? '00:00' : edit.end_time ?? ''} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} />
              </Field>
              <Field label="ชั่วโมง">
                <input type="number" min={1} max={24} step={0.5} className={inputCls} value={Number(edit.hours ?? 8)} onChange={(e) => setEdit({ ...edit, hours: Number(e.target.value) })} />
              </Field>
              <Field label="สี">
                <input type="color" className="h-10 w-full rounded-xl border border-line" value={edit.color ?? '#0284c7'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />
              เปิดใช้งาน
            </label>
            <Button disabled={busy || !edit.code || !edit.name_th} onClick={saveType}>บันทึก</Button>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(editTeam)} onClose={() => setEditTeam(null)} title={editTeam?.id ? 'แก้ไขตารางเวร' : 'เพิ่มตารางเวร'}>
        {editTeam && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="รหัสทีม (เช่น MT_ER)">
                <input
                  className={inputCls} value={editTeam.code ?? ''} disabled={Boolean(editTeam.id)}
                  onChange={(e) => setEditTeam({ ...editTeam, code: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="ชื่อตารางเวร (ไทย)">
                <input className={inputCls} value={editTeam.name_th ?? ''} onChange={(e) => setEditTeam({ ...editTeam, name_th: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={editTeam.uses_jobs ?? false}
                onChange={(e) => setEditTeam({ ...editTeam, uses_jobs: e.target.checked })}
              />
              หมุนเวียน Job ประจำเวร (เช่น Chem/Sero/Hemato/Micros)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={editTeam.is_active ?? true}
                onChange={(e) => setEditTeam({ ...editTeam, is_active: e.target.checked })}
              />
              เปิดใช้งาน
            </label>
            <Field label="Role ที่เพิ่มเข้าทีมนี้ได้ (ไม่เลือก = ไม่จำกัด)">
              <div className="flex flex-wrap gap-2">
                {TEAM_ELIGIBLE_ROLES.map((role) => {
                  const checked = (editTeam.allowed_roles ?? []).includes(role)
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => toggleAllowedRole(role)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-slate-600'
                      }`}
                    >
                      {role}
                    </button>
                  )
                })}
              </div>
            </Field>
            <Button disabled={busy || !editTeam.code || !editTeam.name_th} onClick={saveTeam}>บันทึก</Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
