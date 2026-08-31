import { describe, expect, it } from 'vitest'
import { parseGoogleThaiHolidayFeed } from '@/lib/google-holidays'

describe('parseGoogleThaiHolidayFeed', () => {
  it('imports official all-day holidays, expands date ranges, and ignores observances', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:official-1',
      'DTSTART;VALUE=DATE:20260413',
      'DTEND;VALUE=DATE:20260416',
      'SUMMARY:วันสงกรานต์',
      'DESCRIPTION:วันหยุดนักขัตฤกษ์',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:observance-1',
      'DTSTART;VALUE=DATE:20260214',
      'DTEND;VALUE=DATE:20260215',
      'SUMMARY:วันวาเลนไทน์',
      'DESCRIPTION:วันสำคัญ',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    expect(parseGoogleThaiHolidayFeed(ics, '2026-01-01', '2026-12-31')).toEqual([
      { holidayDate: '2026-04-13', nameTh: 'วันสงกรานต์', sourceEventId: 'official-1' },
      { holidayDate: '2026-04-14', nameTh: 'วันสงกรานต์', sourceEventId: 'official-1' },
      { holidayDate: '2026-04-15', nameTh: 'วันสงกรานต์', sourceEventId: 'official-1' },
    ])
  })

  it('handles folded Thai text and date filtering', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:folded-1',
      'DTSTART;VALUE=DATE:20260101',
      'DTEND;VALUE=DATE:20260102',
      'SUMMARY:วันหยุดชดเชยวันสิ้นปี',
      ' วันหยุดราชการ',
      'DESCRIPTION:วันหยุด',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    expect(parseGoogleThaiHolidayFeed(ics, '2026-01-01', '2026-01-31')).toEqual([
      { holidayDate: '2026-01-01', nameTh: 'วันหยุดชดเชยวันสิ้นปีวันหยุดราชการ', sourceEventId: 'folded-1' },
    ])
    expect(parseGoogleThaiHolidayFeed(ics, '2025-01-01', '2025-12-31')).toEqual([])
  })
})
