import 'server-only'

import {
  DEFAULT_GOOGLE_HOLIDAY_CALENDAR_ID,
  GOOGLE_HOLIDAY_SOURCE,
  parseGoogleThaiHolidayFeed,
  type ImportedGoogleHoliday,
} from '@/lib/google-holidays'
import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'

const FEED_TIMEOUT_MS = 15_000

type ExistingHoliday = {
  holiday_date: string
  source: string | null
  source_event_id: string | null
}

export type GoogleHolidaySyncResult = {
  source: typeof GOOGLE_HOLIDAY_SOURCE
  from: string
  to: string
  imported: number
  updated: number
  removed: number
  skippedManual: number
  totalFromGoogle: number
  syncedAt: string
}

function feedUrl() {
  const configuredUrl = process.env.GOOGLE_HOLIDAY_CALENDAR_ICS_URL?.trim()
  if (configuredUrl) return configuredUrl

  const calendarId = process.env.GOOGLE_HOLIDAY_CALENDAR_ID?.trim() || DEFAULT_GOOGLE_HOLIDAY_CALENDAR_ID
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`
}

async function fetchGoogleThaiHolidayFeed(fromDate: string, toDate: string): Promise<ImportedGoogleHoliday[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)

  try {
    const response = await fetch(feedUrl(), {
      cache: 'no-store',
      headers: { Accept: 'text/calendar' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new HttpError(502, `ดึงวันหยุดจาก Google ไม่สำเร็จ (${response.status})`)
    }

    const ics = await response.text()
    if (!ics.includes('BEGIN:VCALENDAR') || !ics.includes('BEGIN:VEVENT')) {
      throw new HttpError(502, 'Google ไม่ได้ส่งข้อมูลปฏิทินวันหยุดกลับมา')
    }
    try {
      return parseGoogleThaiHolidayFeed(ics, fromDate, toDate)
    } catch {
      throw new HttpError(502, 'ข้อมูลวันหยุดจาก Google มีรูปแบบไม่ถูกต้อง')
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, 'ดึงวันหยุดจาก Google หมดเวลา กรุณาลองใหม่')
    }
    throw new HttpError(502, 'ไม่สามารถเชื่อมต่อ Google Calendar ได้')
  } finally {
    clearTimeout(timeout)
  }
}

function yearBounds(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export async function syncGoogleThaiHolidays(year: number, actorId: string | null = null): Promise<GoogleHolidaySyncResult> {
  const { from, to } = yearBounds(year)
  const googleHolidays = await fetchGoogleThaiHolidayFeed(from, to)
  const admin = getAdminClient()

  const { data, error: existingError } = await admin
    .from('shift_holidays')
    .select('holiday_date,source,source_event_id')
    .gte('holiday_date', from)
    .lte('holiday_date', to)
  if (existingError) throw new HttpError(500, existingError.message)

  const existing = (data ?? []) as ExistingHoliday[]
  const existingByDate = new Map(existing.map((holiday) => [String(holiday.holiday_date), holiday]))
  const googleDates = new Set(googleHolidays.map((holiday) => holiday.holidayDate))
  const rowsToUpsert = []
  let imported = 0
  let updated = 0
  let skippedManual = 0
  const syncedAt = new Date().toISOString()

  for (const holiday of googleHolidays) {
    const current = existingByDate.get(holiday.holidayDate)
    const currentSource = current?.source ?? 'manual'
    if (current && currentSource !== GOOGLE_HOLIDAY_SOURCE) {
      skippedManual += 1
      continue
    }

    if (current) updated += 1
    else imported += 1
    rowsToUpsert.push({
      holiday_date: holiday.holidayDate,
      name_th: holiday.nameTh,
      kind: 'public',
      source: GOOGLE_HOLIDAY_SOURCE,
      source_event_id: holiday.sourceEventId,
      synced_at: syncedAt,
      created_by: actorId,
    })
  }

  if (rowsToUpsert.length > 0) {
    const { error } = await admin.from('shift_holidays').upsert(rowsToUpsert, { onConflict: 'holiday_date' })
    if (error) throw new HttpError(500, error.message)
  }

  const staleDates = existing
    .filter((holiday) => (holiday.source ?? 'manual') === GOOGLE_HOLIDAY_SOURCE && !googleDates.has(String(holiday.holiday_date)))
    .map((holiday) => String(holiday.holiday_date))

  if (staleDates.length > 0) {
    const { error } = await admin
      .from('shift_holidays')
      .delete()
      .eq('source', GOOGLE_HOLIDAY_SOURCE)
      .gte('holiday_date', from)
      .lte('holiday_date', to)
      .in('holiday_date', staleDates)
    if (error) throw new HttpError(500, error.message)
  }

  return {
    source: GOOGLE_HOLIDAY_SOURCE,
    from,
    to,
    imported,
    updated,
    removed: staleDates.length,
    skippedManual,
    totalFromGoogle: googleHolidays.length,
    syncedAt,
  }
}
