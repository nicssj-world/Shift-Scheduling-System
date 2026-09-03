'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, UserMinus, UserPlus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, inputCls } from '@/components/ui'
import { api } from '@/lib/client-api'
import type { Job, StaffProfile, Team } from '@/lib/types'

type MemberRow = {
  id: string
  team_id: string
  user_id: string
  display_label: string | null
  is_active: boolean
  chem_sero_weight: number
  hemato_micros_weight: number
  displayName: string
  profile: StaffProfile
}

type TeamBundle = Team & { members: MemberRow[]; jobs: Job[] }

export function StaffAdminView() {
  const [teams, setTeams] = useState<TeamBundle[]>([])
  const [staff, setStaff] = useState<StaffProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addTeam, setAddTeam] = useState<TeamBundle | null>(null)
  const [addUser, setAddUser] = useState('')
  const [editMember, setEditMember] = useState<MemberRow | null>(null)
  const [label, setLabel] = useState('')
  const [chemSeroWeight, setChemSeroWeight] = useState(50)
  const [hematoMicrosWeight, setHematoMicrosWeight] = useState(50)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [teamsRes, staffRes] = await Promise.all([
        api<{ teams: TeamBundle[] }>('/api/teams'),
        api<{ staff: StaffProfile[] }>('/api/staff'),
      ])
      setTeams(teamsRes.teams)
      setStaff(staffRes.staff)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const editTeam = editMember ? teams.find((team) => team.id === editMember.team_id) : null
  const isCentralLabMember = editTeam?.code === 'MT_CENTRAL'
  const sectionWeightsValid = Number.isInteger(chemSeroWeight)
    && Number.isInteger(hematoMicrosWeight)
    && chemSeroWeight >= 0 && chemSeroWeight <= 100
    && hematoMicrosWeight >= 0 && hematoMicrosWeight <= 100
    && chemSeroWeight + hematoMicrosWeight === 100

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">บุคลากรและทีมเวร</h1>
      <p className="text-[13px] text-slate-500">
        ข้อมูลบุคลากรดึงจากฐานข้อมูล Lab Management Portal โดยตรง — เพิ่มคนเข้าทีมเวรเพื่อให้ระบบจัดเวรให้
      </p>
      <ErrorNote error={error} />

      {teams.map((team) => (
        <Card key={team.id}>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold">{team.name_th}</div>
              <div className="text-xs text-slate-500">
                {team.uses_jobs ? `หมุนเวียน Job: ${team.jobs.map((j) => j.name_th).join(' → ')}` : 'ไม่มี Job ประจำเวร'}
                {' · '}สมาชิก {team.members.filter((m) => m.is_active).length} คน
              </div>
            </div>
            <Button size="sm" onClick={() => { setAddTeam(team); setAddUser('') }}>
              <UserPlus size={14} /> เพิ่มคน
            </Button>
          </div>
          {team.members.length === 0 ? <EmptyState text="ยังไม่มีสมาชิก" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-slate-500">
                    <th className="py-1.5">ชื่อแสดงในตาราง</th>
                    <th>ชื่อ-สกุล</th>
                    <th>รหัส Ephis</th>
                    <th>Role</th>
                    <th>เบอร์โทร</th>
                    {team.code === 'MT_CENTRAL' && <th>Section weight</th>}
                    <th>สถานะ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {team.members.map((m) => (
                    <tr key={m.id} className={`border-b border-line/60 ${m.is_active ? '' : 'opacity-45'}`}>
                      <td className="py-1.5 font-semibold">{m.displayName}</td>
                      <td>{m.profile?.name}</td>
                      <td>{m.profile?.ephis_id ?? '-'}</td>
                      <td className="text-xs">{m.profile?.role}</td>
                      <td className="text-xs">{m.profile?.phone ?? '-'}</td>
                      {team.code === 'MT_CENTRAL' && (
                        <td className="whitespace-nowrap text-xs">
                          Chem/Sero {m.chem_sero_weight ?? 50}% · Hemato/Micros {m.hemato_micros_weight ?? 50}%
                        </td>
                      )}
                      <td>{m.is_active ? <Badge tone="green">ใช้งาน</Badge> : <Badge tone="gray">พัก</Badge>}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" disabled={busy}
                            aria-label={`แก้ไข ${m.profile?.name ?? m.displayName}`}
                            onClick={() => {
                              setEditMember(m)
                              setLabel(m.display_label ?? '')
                              setChemSeroWeight(m.chem_sero_weight ?? 50)
                              setHematoMicrosWeight(m.hemato_micros_weight ?? 50)
                            }}>
                            <Pencil size={13} />
                          </Button>
                          {m.is_active ? (
                            <Button size="sm" variant="outline" disabled={busy}
                              onClick={() => run(() => api('/api/teams/members', { method: 'DELETE', body: JSON.stringify({ memberId: m.id }) }))}>
                              <UserMinus size={13} /> พัก
                            </Button>
                          ) : (
                            <Button size="sm" variant="success" disabled={busy}
                              onClick={() => run(() => api('/api/teams/members', { method: 'PATCH', body: JSON.stringify({ memberId: m.id, isActive: true }) }))}>
                              <Plus size={13} /> ใช้งาน
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}

      {/* add member */}
      <Modal open={Boolean(addTeam)} onClose={() => setAddTeam(null)} title={`เพิ่มคนเข้า ${addTeam?.name_th ?? ''}`}>
        <div className="flex flex-col gap-3">
          <Field label="เลือกบุคลากร (จากฐานข้อมูล Portal)">
            <select className={inputCls} value={addUser} onChange={(e) => setAddUser(e.target.value)}>
              <option value="">— เลือก —</option>
              {staff
                .filter((s) => !addTeam?.members.some((m) => m.user_id === s.id && m.is_active))
                .filter((s) => !addTeam?.allowed_roles?.length || addTeam.allowed_roles.includes(s.role))
                .filter((s) => !addTeam?.allowed_depts?.length || (s.dept && addTeam.allowed_depts.includes(s.dept)))
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {s.role} · {s.dept ?? '-'}</option>
                ))}
            </select>
            {Boolean(addTeam?.allowed_roles?.length || addTeam?.allowed_depts?.length) && (
              <p className="mt-1.5 text-xs text-slate-500">
                {addTeam?.allowed_roles?.length ? `Role: ${addTeam.allowed_roles.join(', ')}` : ''}
                {addTeam?.allowed_roles?.length && addTeam?.allowed_depts?.length ? ' · ' : ''}
                {addTeam?.allowed_depts?.length ? `แผนก: ${addTeam.allowed_depts.join(', ')}` : ''}
              </p>
            )}
          </Field>
          <Button
            disabled={!addUser || busy}
            onClick={() => run(async () => {
              await api('/api/teams/members', { method: 'POST', body: JSON.stringify({ teamId: addTeam!.id, userId: addUser }) })
              setAddTeam(null)
            })}
          >
            เพิ่มเข้าทีม
          </Button>
        </div>
      </Modal>

      {/* edit display label */}
      <Modal open={Boolean(editMember)} onClose={() => setEditMember(null)} title={`ชื่อแสดงในตาราง: ${editMember?.profile?.name ?? ''}`}>
        <div className="flex flex-col gap-3">
          <Field label="ชื่อที่แสดง (เว้นว่าง = อัตโนมัติ เช่น นฤมล(งาม))">
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="อัตโนมัติ" />
          </Field>
          {isCentralLabMember && (
            <div className="rounded-lg border border-line bg-slate-50 p-3">
              <div className="mb-2 text-sm font-semibold">Central Lab section preference</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Chem / Sero (%)">
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={chemSeroWeight}
                    aria-label="Chem / Sero section weight"
                    onChange={(e) => setChemSeroWeight(Number(e.target.value))}
                  />
                </Field>
                <Field label="Hemato / Micros (%)">
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={hematoMicrosWeight}
                    aria-label="Hemato / Micros section weight"
                    onChange={(e) => setHematoMicrosWeight(Number(e.target.value))}
                  />
                </Field>
              </div>
              <div className={`mt-2 text-xs ${sectionWeightsValid ? 'text-emerald-700' : 'text-red-600'}`}>
                รวม {chemSeroWeight + hematoMicrosWeight}% {sectionWeightsValid ? '(ถูกต้อง)' : '(ต้องรวม 100%)'}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                น้ำหนักใช้เลือก section; Job ภายใน section จะหมุนให้สมดุลกัน · 0% เป็นความสำคัญต่ำสุด ไม่ได้ห้ามจัดลง section นี้
              </p>
            </div>
          )}
          <Button
            disabled={busy || (isCentralLabMember && !sectionWeightsValid)}
            onClick={() => run(async () => {
              await api('/api/teams/members', {
                method: 'PATCH',
                body: JSON.stringify({
                  memberId: editMember!.id,
                  displayLabel: label || null,
                  ...(isCentralLabMember ? { chemSeroWeight, hematoMicrosWeight } : {}),
                }),
              })
              setEditMember(null)
            })}
          >
            บันทึก
          </Button>
        </div>
      </Modal>
    </div>
  )
}
