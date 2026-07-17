import 'server-only'

import { HttpError } from '@/lib/server/errors'

type DatabaseError = { code?: string; message?: string }

/** Convert deliberate database concurrency failures into stable API errors
 * instead of exposing Postgres/PostgREST details to the browser. */
export function throwRequestRpcError(error: DatabaseError, fallback: string): never {
  if (error.code === '23505') {
    throw new HttpError(409, 'มีเวรอย่างน้อยหนึ่งรายการอยู่ในคำขอที่รอดำเนินการแล้ว')
  }
  if (error.code === '40001') {
    throw new HttpError(409, error.message || 'ข้อมูลมีการเปลี่ยนแปลงพร้อมกัน กรุณารีเฟรชแล้วลองใหม่')
  }
  if (error.code === 'P0001') {
    throw new HttpError(409, error.message || fallback)
  }
  throw new HttpError(500, fallback)
}
