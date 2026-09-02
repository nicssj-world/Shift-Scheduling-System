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
    let realtimeConnected = false
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
      .subscribe((status) => {
        realtimeConnected = status === 'SUBSCRIBED'
      })

    // Poll only while Realtime is disconnected. Polling while the channel is
    // healthy made the create modal look like it refreshed every 10 seconds,
    // even when no reservation had changed.
    const fallbackTimer = window.setInterval(() => {
      if (!realtimeConnected) scheduleRefresh()
    }, 10_000)
    return () => {
      window.clearTimeout(refreshTimer ?? undefined)
      window.clearInterval(fallbackTimer)
      supabase.removeChannel(channel)
    }
  }, [enabled])
}
