import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { requireEnv } from '@/lib/supabase/env'

type UntypedDatabase = {
  public: {
    Tables: Record<string, {
      Row: Record<string, unknown>
      Insert: Record<string, unknown>
      Update: Record<string, unknown>
      Relationships: []
    }>
    Views: Record<string, never>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

function createAdminClient() {
  return createClient<UntypedDatabase>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

let adminClient: ReturnType<typeof createAdminClient> | undefined

export function getAdminClient() {
  adminClient ??= createAdminClient()
  return adminClient
}
