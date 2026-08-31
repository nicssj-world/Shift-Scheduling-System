'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Refresh immediately when a reservation changes, with a slow polling
 * fallback for browsers that lose their Realtime connection. */
export function useAssignmentReservationRealtime(enabled: boolean, onChange: () => void) {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled) return

    const supabase = createClient()
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        onChangeRef.current()
      }, 250)
    }

    const channel = supabase
      .channel(`shift-assignment-live-locks-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shift_assignment_live_locks' },
        scheduleRefresh,
      )
      .subscribe()

    const fallbackTimer = window.setInterval(scheduleRefresh, 10_000)
    return () => {
      window.clearTimeout(refreshTimer ?? undefined)
      window.clearInterval(fallbackTimer)
      supabase.removeChannel(channel)
    }
  }, [enabled])
}
