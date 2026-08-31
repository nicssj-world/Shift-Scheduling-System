import { addDays } from '@/lib/dates'

export const DEFAULT_GOOGLE_HOLIDAY_CALENDAR_ID = 'th.th#holiday@group.v.calendar.google.com'
export const GOOGLE_HOLIDAY_SOURCE = 'google_th_holidays' as const

export type ImportedGoogleHoliday = {
  holidayDate: string
  nameTh: string
  sourceEventId: string
}

type IcsProperty = {
  name: string
  value: string
  params: Record<string, string>
}

type IcsEvent = {
  uid: string
  summary: string
  description: string
  start: string
  end: string | null
  allDay: boolean
  status: string
}

function unfoldIcs(ics: string) {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').replace(/\r[ \t]/g, '')
}

function parseProperty(line: string): IcsProperty | null {
  const colon = line.indexOf(':')
  if (colon <= 0) return null

  const nameAndParams = line.slice(0, colon).split(';')
  const name = nameAndParams[0].toUpperCase()
  const params: Record<string, string> = {}
  for (const rawParam of nameAndParams.slice(1)) {
    const equals = rawParam.indexOf('=')
    if (equals <= 0) continue
    params[rawParam.slice(0, equals).toUpperCase()] = rawParam.slice(equals + 1).replace(/^"|"$/g, '')
  }

  return { name, value: line.slice(colon + 1), params }
}

function decodeIcsText(value: string) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

function parseIcsDate(value: string) {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!match) return null

  const date = `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null
  return date
}

function firstProperty(properties: IcsProperty[], name: string) {
  return properties.find((property) => property.name === name) ?? null
}

function parseEvents(ics: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let current: IcsProperty[] | null = null

  for (const rawLine of unfoldIcs(ics).split(/\r\n|\n|\r/)) {
    const line = rawLine.trimEnd()
    if (line === 'BEGIN:VEVENT') {
      current = []
      continue
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const startProperty = firstProperty(current, 'DTSTART')
        if (startProperty) {
          const start = parseIcsDate(startProperty.value)
          const end = parseIcsDate(firstProperty(current, 'DTEND')?.value ?? '')
          if (start) {
            events.push({
              uid: decodeIcsText(firstProperty(current, 'UID')?.value ?? ''),
              summary: decodeIcsText(firstProperty(current, 'SUMMARY')?.value ?? ''),
              description: decodeIcsText(firstProperty(current, 'DESCRIPTION')?.value ?? ''),
              start,
              end,
              allDay: startProperty.params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(startProperty.value.trim()),
              status: decodeIcsText(firstProperty(current, 'STATUS')?.value ?? ''),
            })
          }
        }
      }
      current = null
      continue
    }

    if (current) {
      const property = parseProperty(line)
      if (property) current.push(property)
    }
  }

  return events
}

function isOfficialThaiHoliday(event: IcsEvent) {
  const searchableText = `${event.summary}\n${event.description}`
  return [
    'วันหยุดนักขัตฤกษ์',
    'วันหยุดราชการ',
    'วันหยุดพิเศษ',
  ].some((marker) => searchableText.includes(marker))
}

function isDateInRange(date: string, fromDate: string, toDate: string) {
  return date >= fromDate && date <= toDate
}

/**
 * Parse the public Google Thailand holiday calendar and keep only events that
 * Google marks as an actual holiday. The calendar also contains observances
 * such as Valentine's Day and Chinese New Year, which must not become roster
 * holidays.
 */
export function parseGoogleThaiHolidayFeed(ics: string, fromDate: string, toDate: string): ImportedGoogleHoliday[] {
  const byDate = new Map<string, { names: string[]; eventIds: string[] }>()

  for (const event of parseEvents(ics)) {
    if (!event.allDay || event.status.toUpperCase() === 'CANCELLED' || !isOfficialThaiHoliday(event)) continue

    const eventEnd = event.end && event.end > event.start ? event.end : addDays(event.start, 1)
    const sourceEventId = event.uid || `${event.start}:${event.summary}`
    const name = event.summary || 'วันหยุดราชการ'

    for (let date = event.start; date < eventEnd; date = addDays(date, 1)) {
      if (!isDateInRange(date, fromDate, toDate)) continue
      const existing = byDate.get(date) ?? { names: [], eventIds: [] }
      if (!existing.names.includes(name)) existing.names.push(name)
      if (!existing.eventIds.includes(sourceEventId)) existing.eventIds.push(sourceEventId)
      byDate.set(date, existing)
    }
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([holidayDate, value]) => ({
      holidayDate,
      nameTh: value.names.join(' / '),
      sourceEventId: value.eventIds.join('|'),
    }))
}
