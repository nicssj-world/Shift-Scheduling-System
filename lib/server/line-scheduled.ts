import 'server-only'

import { thaiShortDate } from '@/lib/dates'
import { getLineDailyRoster } from '@/lib/server/line-data'
import { getLineSettings } from '@/lib/server/line-config'
import { queueLineGroupMessage } from '@/lib/server/line-notify'
import { lineAppUrl } from '@/lib/server/line-client'
import { getMappedApprovedLineGroups } from '@/lib/server/line-group-mapping'
import type { Actor } from '@/lib/types'

const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000000', ephisId: '', name: 'system', role: 'Admin', dept: null, phone: null, isAdmin: true, isManager: false, isScheduler: true } satisfies Actor

export async function queueGroupRosters(date: string, showPhone: boolean) {
  const settings = await getLineSettings()
  if (!settings.enabled || !settings.dailyRosterEnabled) return 0
  const groups = (await getMappedApprovedLineGroups()).filter((group) => group.dailyRosterEnabled)
  let count = 0
  for (const group of groups) {
    const roster = await getLineDailyRoster(SYSTEM_ACTOR, date, showPhone && group.showPhoneInDailyRoster === true, group.scopes)
    const text = [`เวรประจำวันที่ ${roster.date}`, ...roster.teams.flatMap((team) => [team.teamName, ...team.shifts.map((shift) => `${shift.code} ${shift.typeName} · ${shift.userName}${shift.phone ? ` · ${shift.phone}` : ''}`)])].join('\n')
    const teamContents = roster.teams.slice(0, 10).map((team) => ({
      type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm', contents: [
        { type: 'text', text: team.teamName || 'ทีม', weight: 'bold', color: '#0c2f4a', size: 'sm' },
        { type: 'text', wrap: true, size: 'xs', color: '#475569', text: team.shifts.map((shift) => `${shift.code} ${shift.typeName} · ${shift.userName}${shift.phone ? ` · ${shift.phone}` : ''}  ${shift.startTime}-${shift.endTime}`).join('\n').slice(0, 1_800) || 'ไม่มีเวร' },
      ],
    }))
    const messages = [{
      type: 'flex', altText: `สรุปเวร ${thaiShortDate(date)}`,
      contents: {
        type: 'bubble', size: 'giga',
        body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: `เวรประจำวันที่ ${thaiShortDate(date)}`, weight: 'bold', size: 'lg', color: '#0c2f4a' },
          ...(teamContents.length ? teamContents : [{ type: 'text', text: 'ไม่มีข้อมูลเวร', color: '#64748b', size: 'sm' }]),
        ] },
        footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#0891b2', action: { type: 'uri', label: 'ดูตารางเวร', uri: lineAppUrl('/line/schedule') } }] },
      },
    }]
    await queueLineGroupMessage(String(group.lineGroupId), { type: 'daily_roster', title: `สรุปเวร ${thaiShortDate(date)}`, body: text, messages, dedupeKey: `daily-roster:${date}` })
    count += 1
  }
  return count
}
