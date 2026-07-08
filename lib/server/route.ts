import { z } from 'zod'
import { HttpError } from '@/lib/server/errors'

export async function readJson<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  const body = await request.json().catch(() => null)
  return schema.parse(body)
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function respond<T>(handler: () => Promise<T>) {
  try {
    const data = await handler()
    return Response.json(data, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE })
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? 'Invalid request' }, { status: 400, headers: NO_STORE })
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return Response.json({ error: message }, { status: 500, headers: NO_STORE })
  }
}
