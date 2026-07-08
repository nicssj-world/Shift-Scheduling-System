import { z } from 'zod'
import { HttpError } from '@/lib/server/errors'

export async function readJson<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  const body = await request.json().catch(() => null)
  return schema.parse(body)
}

export async function respond<T>(handler: () => Promise<T>) {
  try {
    const data = await handler()
    return Response.json(data)
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return Response.json({ error: message }, { status: 500 })
  }
}
