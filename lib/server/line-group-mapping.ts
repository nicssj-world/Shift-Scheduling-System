import 'server-only'

import { getShiftTypes, getTeams } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { writeLineAudit } from '@/lib/server/line-audit'
import { getAdminClient } from '@/lib/supabase/admin'

export type LineGroupScope = {
  teamId: string
  shiftTypeId?: string | null
}

export type LineGroupMappingRow = {
  id: string
  team_id: string
  shift_type_id: string | null
  line_group_id: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type MappedLineGroup = {
  id: string
  lineGroupId: string
  name: string | null
  groupType: string
  isApproved: boolean
  isActive: boolean
  dailyRosterEnabled: boolean
  showPhoneInDailyRoster: boolean
  scopes: LineGroupScope[]
}

const MAPPING_SELECT = 'id,team_id,shift_type_id,line_group_id,is_active,created_by,created_at,updated_at'
const GROUP_SELECT = 'id,line_group_id,name,group_type,is_approved,is_active,daily_roster_enabled,show_phone_in_daily_roster,created_at,updated_at'

function scopeKey(scope: LineGroupScope) {
  return `${scope.teamId}|${scope.shiftTypeId ?? '*'}`
}

function normalizeScope(scope: LineGroupScope): LineGroupScope | null {
  const teamId = String(scope.teamId ?? '').trim()
  if (!teamId) return null
  const shiftTypeId = scope.shiftTypeId ? String(scope.shiftTypeId).trim() : null
  return { teamId, shiftTypeId: shiftTypeId || null }
}

function matchingMappings(mappings: LineGroupMappingRow[], scope: LineGroupScope) {
  const candidates = mappings.filter((mapping) => mapping.team_id === scope.teamId && mapping.is_active)
  if (!scope.shiftTypeId) return candidates.filter((mapping) => mapping.shift_type_id === null)
  const specific = candidates.filter((mapping) => mapping.shift_type_id === scope.shiftTypeId)
  return specific.length > 0 ? specific : candidates.filter((mapping) => mapping.shift_type_id === null)
}

export async function readLineGroupMappings() {
  const { data, error } = await getAdminClient()
    .from('shift_line_group_mappings')
    .select(MAPPING_SELECT)
    .order('created_at', { ascending: false })
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as unknown as LineGroupMappingRow[]
}

export async function getLineGroupMappingAdminData() {
  const admin = getAdminClient()
  const [{ data: groups, error: groupError }, mappings, teams, shiftTypes] = await Promise.all([
    admin.from('shift_line_groups').select(GROUP_SELECT).order('created_at', { ascending: false }).limit(500),
    readLineGroupMappings(),
    getTeams(),
    getShiftTypes(),
  ])
  if (groupError) throw new HttpError(500, groupError.message)

  const groupById = new Map((groups ?? []).map((group) => [String(group.id), group]))
  const teamById = new Map(teams.map((team) => [String(team.id), team]))
  const shiftTypeById = new Map(shiftTypes.map((type) => [String(type.id), type]))

  return {
    teams: teams.map((team) => ({
      id: String(team.id), code: team.code, name: team.name_th, isActive: team.is_active,
    })),
    shiftTypes: shiftTypes.map((type) => ({
      id: String(type.id), code: type.code, name: type.name_th, isActive: type.is_active,
    })),
    groups: (groups ?? []).map((group) => ({
      id: String(group.id), lineGroupId: String(group.line_group_id), name: group.name ? String(group.name) : null,
      groupType: String(group.group_type), isApproved: Boolean(group.is_approved), isActive: Boolean(group.is_active),
      dailyRosterEnabled: Boolean(group.daily_roster_enabled), showPhoneInDailyRoster: Boolean(group.show_phone_in_daily_roster),
    })),
    mappings: mappings.map((mapping) => {
      const group = groupById.get(mapping.line_group_id)
      const team = teamById.get(mapping.team_id)
      const shiftType = mapping.shift_type_id ? shiftTypeById.get(mapping.shift_type_id) : null
      return {
        id: mapping.id,
        teamId: mapping.team_id,
        teamCode: team?.code ?? null,
        teamName: team?.name_th ?? 'ไม่พบกลุ่มงาน',
        shiftTypeId: mapping.shift_type_id,
        shiftTypeCode: shiftType?.code ?? null,
        shiftTypeName: shiftType?.name_th ?? null,
        lineGroupRecordId: mapping.line_group_id,
        lineGroupId: group ? String(group.line_group_id) : null,
        lineGroupName: group?.name ? String(group.name) : null,
        groupApproved: Boolean(group?.is_approved),
        groupActive: Boolean(group?.is_active),
        isActive: mapping.is_active,
        createdAt: mapping.created_at,
        updatedAt: mapping.updated_at,
      }
    }),
  }
}

export async function getMappedApprovedLineGroups(): Promise<MappedLineGroup[]> {
  try {
    const admin = getAdminClient()
    const [{ data: groups, error: groupError }, mappings] = await Promise.all([
      admin.from('shift_line_groups').select(GROUP_SELECT).eq('is_active', true).eq('is_approved', true),
      readLineGroupMappings(),
    ])
    if (groupError) throw groupError
    const mappingsByGroup = new Map<string, LineGroupMappingRow[]>()
    for (const mapping of mappings) {
      if (!mapping.is_active) continue
      mappingsByGroup.set(mapping.line_group_id, [...(mappingsByGroup.get(mapping.line_group_id) ?? []), mapping])
    }
    return (groups ?? []).flatMap((group) => {
      const rows = mappingsByGroup.get(String(group.id)) ?? []
      const scopes = [...new Map(rows.map((row) => [scopeKey({ teamId: row.team_id, shiftTypeId: row.shift_type_id }), {
        teamId: row.team_id, shiftTypeId: row.shift_type_id,
      }])).values()]
      if (scopes.length === 0) return []
      return [{
        id: String(group.id), lineGroupId: String(group.line_group_id), name: group.name ? String(group.name) : null,
        groupType: String(group.group_type), isApproved: true, isActive: true,
        dailyRosterEnabled: Boolean(group.daily_roster_enabled), showPhoneInDailyRoster: Boolean(group.show_phone_in_daily_roster),
        scopes,
      }]
    })
  } catch (error) {
    console.error('LINE group mapping lookup failed', error instanceof Error ? error.message : 'unknown')
    return []
  }
}

export async function resolveMappedLineGroupIds(scopes: LineGroupScope[]) {
  const normalized = [...new Map(scopes.map(normalizeScope).filter((scope): scope is LineGroupScope => Boolean(scope)).map((scope) => [scopeKey(scope), scope])).values()]
  if (normalized.length === 0) return []
  try {
    const admin = getAdminClient()
    const teamIds = [...new Set(normalized.map((scope) => scope.teamId))]
    const [{ data: mappings, error: mappingError }, { data: groups, error: groupError }] = await Promise.all([
      admin.from('shift_line_group_mappings').select(MAPPING_SELECT).in('team_id', teamIds).eq('is_active', true),
      admin.from('shift_line_groups').select('id,line_group_id,is_approved,is_active').eq('is_approved', true).eq('is_active', true),
    ])
    if (mappingError) throw mappingError
    if (groupError) throw groupError
    const approvedGroups = new Map((groups ?? []).map((group) => [String(group.id), String(group.line_group_id)]))
    const activeApprovedMappings = ((mappings ?? []) as unknown as LineGroupMappingRow[]).filter((mapping) => approvedGroups.has(mapping.line_group_id))
    const out = new Set<string>()
    for (const scope of normalized) {
      for (const mapping of matchingMappings(activeApprovedMappings, scope)) {
        const lineGroupId = approvedGroups.get(mapping.line_group_id)
        if (lineGroupId) out.add(lineGroupId)
      }
    }
    return [...out]
  } catch (error) {
    console.error('LINE group destination lookup failed', error instanceof Error ? error.message : 'unknown')
    return []
  }
}

async function findOrCreateLineGroup(lineGroupId: string) {
  const admin = getAdminClient()
  const { data: existing, error: findError } = await admin.from('shift_line_groups').select(GROUP_SELECT).eq('line_group_id', lineGroupId).maybeSingle()
  if (findError) throw new HttpError(500, findError.message)
  if (existing) return existing
  const groupType = lineGroupId.toUpperCase().startsWith('R') ? 'room' : 'group'
  const { data: created, error: createError } = await admin.from('shift_line_groups').insert({
    line_group_id: lineGroupId,
    group_type: groupType,
    is_active: false,
    is_approved: false,
  }).select(GROUP_SELECT).maybeSingle()
  if (!createError && created) return created
  if (createError?.code !== '23505') throw new HttpError(409, createError?.message ?? 'สร้างกลุ่ม LINE ไม่สำเร็จ')
  const { data: raced, error: raceError } = await admin.from('shift_line_groups').select(GROUP_SELECT).eq('line_group_id', lineGroupId).maybeSingle()
  if (raceError || !raced) throw new HttpError(409, raceError?.message ?? 'ไม่พบกลุ่ม LINE ที่ระบุ')
  return raced
}

export async function saveLineGroupMapping(actorUserId: string, input: {
  id?: string
  teamId: string
  shiftTypeId?: string | null
  lineGroupId: string
  isActive?: boolean
}) {
  const admin = getAdminClient()
  const lineGroupId = input.lineGroupId.trim()
  if (!lineGroupId) throw new HttpError(400, 'กรุณาระบุ LINE Group ID')
  const [{ data: team }, { data: shiftType }] = await Promise.all([
    admin.from('shift_teams').select('id,code,name_th').eq('id', input.teamId).maybeSingle(),
    input.shiftTypeId ? admin.from('shift_shift_types').select('id,code,name_th').eq('id', input.shiftTypeId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!team) throw new HttpError(400, 'ไม่พบกลุ่มงาน/ห้องเวรที่ระบุ')
  if (input.shiftTypeId && !shiftType) throw new HttpError(400, 'ไม่พบประเภทเวรที่ระบุ')
  const group = await findOrCreateLineGroup(lineGroupId)
  let oldValue: unknown = null
  let mapping: LineGroupMappingRow | null = null

  if (input.id) {
    const { data: existing, error: existingError } = await admin.from('shift_line_group_mappings').select(MAPPING_SELECT).eq('id', input.id).maybeSingle()
    if (existingError) throw new HttpError(500, existingError.message)
    if (!existing) throw new HttpError(404, 'ไม่พบ mapping ที่ต้องการแก้ไข')
    oldValue = existing
    const { data: updated, error: updateError } = await admin.from('shift_line_group_mappings').update({
      team_id: input.teamId,
      shift_type_id: input.shiftTypeId ?? null,
      line_group_id: String(group.id),
      is_active: input.isActive ?? true,
      updated_at: new Date().toISOString(),
    }).eq('id', input.id).select(MAPPING_SELECT).maybeSingle()
    if (updateError || !updated) throw new HttpError(updateError?.code === '23505' ? 409 : 500, updateError?.code === '23505' ? 'mapping นี้ซ้ำกับรายการเดิม' : updateError?.message ?? 'บันทึก mapping ไม่สำเร็จ')
    mapping = updated as unknown as LineGroupMappingRow
  } else {
    let query = admin.from('shift_line_group_mappings').select(MAPPING_SELECT)
      .eq('team_id', input.teamId).eq('line_group_id', String(group.id))
    query = input.shiftTypeId ? query.eq('shift_type_id', input.shiftTypeId) : query.is('shift_type_id', null)
    const { data: existing, error: existingError } = await query.maybeSingle()
    if (existingError) throw new HttpError(500, existingError.message)
    if (existing) {
      oldValue = existing
      const { data: updated, error: updateError } = await admin.from('shift_line_group_mappings').update({ is_active: input.isActive ?? true, updated_at: new Date().toISOString() }).eq('id', String(existing.id)).select(MAPPING_SELECT).maybeSingle()
      if (updateError || !updated) throw new HttpError(500, updateError?.message ?? 'บันทึก mapping ไม่สำเร็จ')
      mapping = updated as unknown as LineGroupMappingRow
    } else {
      const { data: created, error: createError } = await admin.from('shift_line_group_mappings').insert({
        team_id: input.teamId,
        shift_type_id: input.shiftTypeId ?? null,
        line_group_id: String(group.id),
        is_active: input.isActive ?? true,
        created_by: actorUserId,
      }).select(MAPPING_SELECT).maybeSingle()
      if (createError || !created) throw new HttpError(createError?.code === '23505' ? 409 : 500, createError?.code === '23505' ? 'mapping นี้ซ้ำกับรายการเดิม' : createError?.message ?? 'บันทึก mapping ไม่สำเร็จ')
      mapping = created as unknown as LineGroupMappingRow
    }
  }
  await writeLineAudit({ actorUserId, source: 'admin', action: oldValue ? 'line_group_mapping_updated' : 'line_group_mapping_created', referenceType: 'shift_line_group_mapping', referenceId: String(mapping.id), oldValue, newValue: mapping })
  return mapping
}

export async function deleteLineGroupMapping(actorUserId: string, id: string) {
  const admin = getAdminClient()
  const { data: existing, error: findError } = await admin.from('shift_line_group_mappings').select(MAPPING_SELECT).eq('id', id).maybeSingle()
  if (findError) throw new HttpError(500, findError.message)
  if (!existing) throw new HttpError(404, 'ไม่พบ mapping ที่ต้องการล้าง')
  const { error } = await admin.from('shift_line_group_mappings').delete().eq('id', id)
  if (error) throw new HttpError(500, error.message)
  await writeLineAudit({ actorUserId, source: 'admin', action: 'line_group_mapping_deleted', referenceType: 'shift_line_group_mapping', referenceId: id, oldValue: existing, newValue: null })
}
