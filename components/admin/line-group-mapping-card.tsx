'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Link2, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/client-api'
import { Badge, Button, Card, ErrorNote, Field, Spinner, inputCls } from '@/components/ui'

type Team = { id: string; code: string; name: string; isActive: boolean }
type ShiftType = { id: string; code: string; name: string; isActive: boolean }
type LineGroupOption = { id: string; lineGroupId: string; name: string | null; groupType: string; isApproved: boolean; isActive: boolean; dailyRosterEnabled: boolean; showPhoneInDailyRoster: boolean }
type Mapping = {
  id: string
  teamId: string
  teamCode: string | null
  teamName: string
  shiftTypeId: string | null
  shiftTypeCode: string | null
  shiftTypeName: string | null
  lineGroupRecordId: string
  lineGroupId: string | null
  lineGroupName: string | null
  groupApproved: boolean
  groupActive: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}
type MappingData = { teams: Team[]; shiftTypes: ShiftType[]; groups: LineGroupOption[]; mappings: Mapping[] }

function groupState(mapping: Mapping) {
  if (!mapping.groupApproved) return { label: 'รออนุมัติกลุ่ม', tone: 'amber' as const }
  if (!mapping.groupActive) return { label: 'กลุ่มปิดใช้งาน', tone: 'gray' as const }
  if (!mapping.isActive) return { label: 'ปิด mapping', tone: 'gray' as const }
  return { label: 'พร้อมส่งประกาศ', tone: 'green' as const }
}

export function LineGroupMappingCard() {
  const [data, setData] = useState<MappingData | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newTypeMapping, setNewTypeMapping] = useState({ teamId: '', shiftTypeId: '', lineGroupId: '' })
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const result = await api<MappingData>('/api/admin/line/mappings')
      setData(result)
      setDrafts(Object.fromEntries(result.mappings.map((mapping) => [mapping.id, mapping.lineGroupId ?? ''])))
      setNewTypeMapping((current) => ({
        ...current,
        teamId: current.teamId || result.teams.find((team) => team.isActive)?.id || '',
        shiftTypeId: current.shiftTypeId || result.shiftTypes.find((type) => type.isActive)?.id || '',
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'โหลด mapping ไม่สำเร็จ')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const activeTypes = useMemo(() => (data?.shiftTypes ?? []).filter((type) => type.isActive), [data?.shiftTypes])
  const activeTeams = useMemo(() => (data?.teams ?? []).filter((team) => team.isActive), [data?.teams])
  const teamWideMappings = useMemo(() => {
    const byTeam = new Map<string, Mapping>()
    for (const mapping of data?.mappings ?? []) {
      if (mapping.shiftTypeId === null) byTeam.set(mapping.teamId, mapping)
    }
    return byTeam
  }, [data?.mappings])

  function setDraft(key: string, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }))
  }

  async function saveMapping(input: { key: string; id?: string; teamId: string; shiftTypeId: string | null; lineGroupId: string }) {
    const lineGroupId = input.lineGroupId.trim()
    if (!lineGroupId) {
      setError('กรุณาระบุ LINE Group ID ก่อนบันทึก')
      return
    }
    setBusyKey(input.key)
    setError(null)
    setSaved(null)
    try {
      await api(input.id ? `/api/admin/line/mappings/${input.id}` : '/api/admin/line/mappings', {
        method: input.id ? 'PATCH' : 'POST',
        body: JSON.stringify({ teamId: input.teamId, shiftTypeId: input.shiftTypeId, lineGroupId, isActive: true }),
      })
      await load()
      setSaved(input.shiftTypeId ? 'บันทึก mapping ประเภทเวรแล้ว' : 'บันทึก mapping กลุ่มงานแล้ว')
      if (!input.id && input.shiftTypeId) setNewTypeMapping((current) => ({ ...current, lineGroupId: '' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึก mapping ไม่สำเร็จ')
    } finally {
      setBusyKey(null)
    }
  }

  async function removeMapping(mapping: Mapping) {
    if (!window.confirm(`ล้าง mapping ของ ${mapping.teamName}${mapping.shiftTypeName ? ` · ${mapping.shiftTypeName}` : ''} หรือไม่?`)) return
    setBusyKey(`delete:${mapping.id}`)
    setError(null)
    setSaved(null)
    try {
      await api(`/api/admin/line/mappings/${mapping.id}`, { method: 'DELETE' })
      await load()
      setSaved('ล้าง mapping แล้ว กลุ่มนี้จะไม่รับประกาศจากกลุ่มงานนี้')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ล้าง mapping ไม่สำเร็จ')
    } finally {
      setBusyKey(null)
    }
  }

  async function toggleMapping(mapping: Mapping) {
    const lineGroupId = drafts[mapping.id] ?? mapping.lineGroupId ?? ''
    setBusyKey(`toggle:${mapping.id}`)
    setError(null)
    setSaved(null)
    try {
      await api(`/api/admin/line/mappings/${mapping.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ teamId: mapping.teamId, shiftTypeId: mapping.shiftTypeId, lineGroupId, isActive: !mapping.isActive }),
      })
      await load()
      setSaved(mapping.isActive ? 'ปิด mapping แล้ว' : 'เปิด mapping แล้ว')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'เปลี่ยนสถานะ mapping ไม่สำเร็จ')
    } finally {
      setBusyKey(null)
    }
  }

  if (!data) return (
    <Card>
      {error ? <div className="flex flex-col items-start gap-3"><ErrorNote error={error} /><Button size="sm" className="min-h-11" onClick={() => { setError(null); void load() }}>ลองโหลดใหม่</Button></div> : <Spinner />}
    </Card>
  )

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700" aria-hidden="true"><Link2 size={19} /></div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold">จับคู่กลุ่มงานกับ LINE Group</h2>
            <Badge tone="blue">{data.teams.length} กลุ่มงาน</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">ประกาศขายเวรแบบรับคนแรกจะส่งเฉพาะกลุ่ม LINE ที่ตรงกับห้อง/กลุ่มงานของเวรนั้น</p>
        </div>
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs leading-5 text-brand-900">
        เชิญ LINE OA เข้า group ก่อน แล้วกรอก Group ID ที่นี่ กลุ่มใหม่จะเริ่มเป็น “รออนุมัติ” จนกว่า Admin จะอนุมัติและเปิดใช้งานในส่วนกลุ่ม LINE ด้านล่าง
      </div>
      <datalist id="line-group-id-options">
        {data.groups.map((group) => <option key={group.id} value={group.lineGroupId}>{group.name || group.lineGroupId}</option>)}
      </datalist>
      <ErrorNote error={error} />
      {saved && <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800"><Check size={15} />{saved}</div>}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-bold">ระดับกลุ่มงาน/ห้อง</h3>
            <p className="text-xs text-slate-500">ใช้กับทุกประเภทเวรของกลุ่มงานนั้น</p>
          </div>
          <Badge tone="gray">{teamWideMappings.size}/{data.teams.length} ผูกแล้ว</Badge>
        </div>

        <div className="flex flex-col gap-2">
          {data.teams.length === 0 && <p className="rounded-xl border border-dashed border-line px-3 py-4 text-sm text-slate-500">ยังไม่มีกลุ่มงานในระบบ รายการจะปรากฏอัตโนมัติเมื่อ Admin สร้างกลุ่มงานใหม่</p>}
          {data.teams.map((team) => {
            const mapping = teamWideMappings.get(team.id)
            const key = mapping?.id ?? `new:${team.id}`
            const value = mapping ? (drafts[mapping.id] ?? mapping.lineGroupId ?? '') : (drafts[key] ?? '')
            const state = mapping ? groupState(mapping) : null
            return (
              <div key={team.id} className="rounded-xl border border-line bg-white p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <div className="min-w-0 lg:w-56 lg:shrink-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{team.name}</p>
                      {!team.isActive && <Badge tone="gray">ปิดกลุ่มงาน</Badge>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">รหัส {team.code} · ทุกประเภทเวร</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Field label={`LINE Group ID สำหรับ ${team.name}`}>
                      <input
                        className={inputCls}
                        value={value}
                        onChange={(event) => setDraft(key, event.target.value)}
                        aria-describedby={`line-group-help-${team.id}`}
                        list="line-group-id-options"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </Field>
                    <p id={`line-group-help-${team.id}`} className="mt-1 text-[11px] text-slate-500">เช่น Cxxxxxxxx… · เว้นว่างเพื่อยังไม่ส่งประกาศ</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:pb-0.5">
                    {state && <Badge tone={state.tone}>{state.label}</Badge>}
                    <Button size="sm" className="min-h-11" disabled={busyKey !== null || !value.trim()} onClick={() => saveMapping({ key, id: mapping?.id, teamId: team.id, shiftTypeId: null, lineGroupId: value })}>
                      <Check size={14} />บันทึก
                    </Button>
                    {mapping && <Button size="sm" variant="outline" className="min-h-11" disabled={busyKey !== null} onClick={() => toggleMapping(mapping)}>{mapping.isActive ? 'ปิด mapping' : 'เปิด mapping'}</Button>}
                    {mapping && <Button size="sm" variant="danger" className="min-h-11" disabled={busyKey !== null} onClick={() => removeMapping(mapping)}><Trash2 size={14} />ล้าง</Button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <div className="mb-3 flex items-center gap-2">
          <Plus size={17} className="text-brand-700" aria-hidden="true" />
          <div>
            <h3 className="text-[13px] font-bold">เพิ่ม mapping เฉพาะประเภทเวร (ตัวเลือก)</h3>
            <p className="text-xs text-slate-500">ถ้ามีรายการนี้ ระบบจะใช้กลุ่มเฉพาะประเภทเวรนี้แทน mapping ระดับกลุ่มงาน</p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr_auto] lg:items-end">
          <Field label="กลุ่มงาน/ห้อง">
            <select className={inputCls} value={newTypeMapping.teamId} onChange={(event) => setNewTypeMapping({ ...newTypeMapping, teamId: event.target.value })}>
              <option value="">— เลือกกลุ่มงาน —</option>
              {activeTeams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.code}</option>)}
            </select>
          </Field>
          <Field label="ประเภทเวร">
            <select className={inputCls} value={newTypeMapping.shiftTypeId} onChange={(event) => setNewTypeMapping({ ...newTypeMapping, shiftTypeId: event.target.value })}>
              <option value="">— เลือกประเภทเวร —</option>
              {activeTypes.map((type) => <option key={type.id} value={type.id}>{type.code} · {type.name}</option>)}
            </select>
          </Field>
          <Field label="LINE Group ID เฉพาะประเภทนี้">
                    <input className={inputCls} value={newTypeMapping.lineGroupId} onChange={(event) => setNewTypeMapping({ ...newTypeMapping, lineGroupId: event.target.value })} list="line-group-id-options" autoCapitalize="none" spellCheck={false} />
          </Field>
          <Button className="min-h-11" disabled={busyKey !== null || !newTypeMapping.teamId || !newTypeMapping.shiftTypeId || !newTypeMapping.lineGroupId.trim()} onClick={() => saveMapping({ key: 'new:type', teamId: newTypeMapping.teamId, shiftTypeId: newTypeMapping.shiftTypeId, lineGroupId: newTypeMapping.lineGroupId })}>
            <Plus size={14} />เพิ่ม
          </Button>
        </div>
      </div>

      {(data.mappings.some((mapping) => mapping.shiftTypeId !== null)) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-bold">Mapping เฉพาะประเภทเวรที่ตั้งไว้</h3>
            <Badge tone="gray">{data.mappings.filter((mapping) => mapping.shiftTypeId !== null).length} รายการ</Badge>
          </div>
          {data.mappings.filter((mapping) => mapping.shiftTypeId !== null).map((mapping) => {
            const state = groupState(mapping)
            const value = drafts[mapping.id] ?? mapping.lineGroupId ?? ''
            return (
              <div key={mapping.id} className="rounded-xl border border-line bg-slate-50 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <div className="min-w-0 lg:w-56 lg:shrink-0"><p className="truncate text-sm font-semibold">{mapping.teamName}</p><p className="mt-0.5 text-[11px] text-slate-500">{mapping.shiftTypeCode} · {mapping.shiftTypeName}</p></div>
                  <div className="min-w-0 flex-1"><Field label={`LINE Group ID สำหรับ ${mapping.teamName} · ${mapping.shiftTypeName}`}><input className={inputCls} value={value} onChange={(event) => setDraft(mapping.id, event.target.value)} list="line-group-id-options" autoCapitalize="none" spellCheck={false} /></Field></div>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={state.tone}>{state.label}</Badge><Button size="sm" className="min-h-11" disabled={busyKey !== null || !value.trim()} onClick={() => saveMapping({ key: mapping.id, id: mapping.id, teamId: mapping.teamId, shiftTypeId: mapping.shiftTypeId, lineGroupId: value })}><Check size={14} />บันทึก</Button><Button size="sm" variant="outline" className="min-h-11" disabled={busyKey !== null} onClick={() => toggleMapping(mapping)}>{mapping.isActive ? 'ปิด mapping' : 'เปิด mapping'}</Button><Button size="sm" variant="danger" className="min-h-11" disabled={busyKey !== null} onClick={() => removeMapping(mapping)}><Trash2 size={14} />ล้าง</Button></div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
