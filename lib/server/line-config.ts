import 'server-only'

import { getSetting } from '@/lib/server/data'

export type LineSettings = {
  enabled: boolean
  swapEnabled: boolean
  saleEnabled: boolean
  openSaleEnabled: boolean
  dailyRosterEnabled: boolean
  personalReminderEnabled: boolean
  showPhoneInDailyRoster: boolean
  dailyRosterHour: number
  personalReminderHour: number
}

export const DEFAULT_LINE_SETTINGS: LineSettings = {
  enabled: false,
  swapEnabled: false,
  saleEnabled: false,
  openSaleEnabled: false,
  dailyRosterEnabled: false,
  personalReminderEnabled: false,
  showPhoneInDailyRoster: false,
  dailyRosterHour: 6,
  personalReminderHour: 20,
}

export async function getLineSettings() {
  const settings = await getSetting<LineSettings>('line', DEFAULT_LINE_SETTINGS)
  const hour = (value: unknown, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.min(23, parsed)) : fallback
  }
  return {
    ...DEFAULT_LINE_SETTINGS,
    ...settings,
    dailyRosterHour: hour(settings.dailyRosterHour, DEFAULT_LINE_SETTINGS.dailyRosterHour),
    personalReminderHour: hour(settings.personalReminderHour, DEFAULT_LINE_SETTINGS.personalReminderHour),
  }
}
