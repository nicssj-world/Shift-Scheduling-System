export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

export const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
] as const

/** อา จ อ พ พฤ ศ ส indexed by JS getDay() (0 = Sunday) */
export const THAI_DAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const

export function toBE(gregorianYear: number) {
  return gregorianYear + 543
}

/** '2026-08' → 'สิงหาคม 2569' */
export function thaiMonthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return `${THAI_MONTHS[m - 1]} ${toBE(y)}`
}

/** '2026-08-05' → '5 ส.ค. 69' */
export function thaiShortDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${String(toBE(y)).slice(-2)}`
}

/** Format a Date in Asia/Bangkok as 'YYYY-MM-DD' regardless of server timezone. */
export function bangkokDateString(date: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', dateStyle: 'short' }).format(date)
}

export function bangkokTomorrowString(now: Date = new Date()) {
  return bangkokDateString(new Date(now.getTime() + 86400000))
}

/** Current month in Asia/Bangkok as 'YYYY-MM'. */
export function bangkokMonthNow() {
  return bangkokDateString().slice(0, 7)
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 0=Sunday … 6=Saturday, timezone-independent for a plain YYYY-MM-DD */
export function dayOfWeek(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export function isWeekend(date: string) {
  const dow = dayOfWeek(date)
  return dow === 0 || dow === 6
}

/** All dates of month 'YYYY-MM' as YYYY-MM-DD strings. */
export function datesOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** First day of previous month for 'YYYY-MM'. */
export function previousMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function nextMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Monday of the ISO week containing the date. */
export function mondayOfWeek(date: string) {
  const dow = dayOfWeek(date)
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}

/** List of months between two 'YYYY-MM' inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  while (cur <= to && out.length < 60) {
    out.push(cur)
    cur = nextMonth(cur)
  }
  return out
}

/** 'HH:MM[:SS]' → minutes since midnight. */
export function timeToMinutes(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** '16:00:00' → '16.00' (Thai roster style) */
export function thaiTime(time: string) {
  const [h, m] = time.split(':')
  return `${h}.${m}`
}
