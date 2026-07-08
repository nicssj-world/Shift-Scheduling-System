export const ROLES = [
  'Admin',
  'Manager',
  'Document Controller',
  'Medical Technologist',
  'Medical Science Technician',
  'Assistant',
] as const

export type Role = (typeof ROLES)[number]

/** Roles that can realistically staff a shift-scheduling team (excludes
 *  'Document Controller' — that's a document-management role in the
 *  portal, unrelated to lab-bench/shift work). Used for the allowed_roles
 *  picker so it doesn't offer irrelevant choices. */
export const TEAM_ELIGIBLE_ROLES = ['Admin', 'Manager', 'Medical Technologist', 'Medical Science Technician', 'Assistant'] as const

/** Canonical profiles.dept values from the shared portal database. */
export const DEPARTMENTS = [
  'สำนักงานกลุ่มงานเทคนิคการแพทย์',
  'งานเคมีคลินิก',
  'งานโลหิตวิทยาคลินิก',
  'งานภูมิคุ้มกันวิทยาคลินิก',
  'งานจุลทรรศนศาสตร์คลินิก',
  'งานอณูชีววิทยา',
  'งานจุลชีววิทยา',
  'งานคลังเลือด',
  'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ',
  'งานบริการผู้ป่วยนอก',
  'ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี',
] as const

/** Map legacy lowercase roles still present in the shared profiles table. */
const LEGACY_ROLES: Record<string, Role> = {
  admin: 'Admin',
  staff: 'Manager',
  editor: 'Medical Technologist',
  viewer: 'Assistant',
}

export function normalizeRole(role: string | null | undefined): Role {
  if (!role) return 'Assistant'
  if ((ROLES as readonly string[]).includes(role)) return role as Role
  return LEGACY_ROLES[role.toLowerCase()] ?? 'Assistant'
}

export type Actor = {
  id: string
  ephisId: string
  name: string
  role: Role
  dept: string | null
  phone: string | null
  isAdmin: boolean
  isManager: boolean
  /** Admin, Manager, or explicitly granted in shift_schedulers */
  isScheduler: boolean
}

export type StaffProfile = {
  id: string
  ephis_id: string | null
  name: string
  role: Role
  dept: string | null
  phone: string | null
}

export type Team = {
  id: string
  code: string
  name_th: string
  uses_jobs: boolean
  /** profiles.role values eligible to join this team; null/empty = no restriction */
  allowed_roles: Role[] | null
  /** profiles.dept values eligible to join this team; null/empty = no restriction */
  allowed_depts: string[] | null
  is_active: boolean
  sort_order: number
}

export type TeamMember = {
  id: string
  team_id: string
  user_id: string
  display_label: string | null
  is_active: boolean
  sort_order: number
  profile?: StaffProfile
}

export type ShiftType = {
  id: string
  code: string
  name_th: string
  start_time: string
  end_time: string
  hours: number
  color: string
  is_active: boolean
  sort_order: number
}

export type DayClass = 'weekday' | 'weekend' | 'holiday'

export type Requirement = {
  id: string
  team_id: string
  shift_type_id: string
  day_class: DayClass
  required_count: number
}

export type Job = {
  id: string
  team_id: string
  code: string
  name_th: string
  is_active: boolean
  sort_order: number
}

export type Holiday = {
  holiday_date: string
  name_th: string
  kind: 'public' | 'special'
}

export type ScheduleStatus = 'draft' | 'published' | 'locked'

export type Schedule = {
  id: string
  team_id: string
  month: string
  status: ScheduleStatus
  generated_at: string | null
  published_at: string | null
  locked_at: string | null
}

export type Assignment = {
  id: string
  schedule_id: string
  work_date: string
  shift_type_id: string
  user_id: string
  job_id: string | null
  source: 'auto' | 'manual' | 'swap'
}

export type LeaveType = 'vacation' | 'sick' | 'personal' | 'other'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type DayPart = 'full' | 'half_am' | 'half_pm'

export type Leave = {
  id: string
  user_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  day_part: DayPart
  note: string | null
  status: LeaveStatus
  requested_by: string
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export type SwapStatus =
  | 'pending_counterpart'
  | 'pending_approval'
  | 'approved'
  | 'declined'
  | 'rejected'
  | 'cancelled'

export type SwapRequest = {
  id: string
  requester_assignment_id: string
  target_assignment_id: string
  requester_id: string
  target_user_id: string
  reason: string | null
  status: SwapStatus
  counterpart_responded_at: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export type SaleStatus =
  | 'pending_buyer'
  | 'pending_approval'
  | 'approved'
  | 'declined'
  | 'rejected'
  | 'cancelled'

export type SaleRequest = {
  id: string
  seller_id: string
  buyer_id: string
  reason: string | null
  status: SaleStatus
  buyer_responded_at: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export const SALE_STATUS_TH: Record<SaleStatus, string> = {
  pending_buyer: 'รอผู้ซื้อตอบรับ',
  pending_approval: 'รอผู้จัดเวรอนุมัติ',
  approved: 'อนุมัติแล้ว',
  declined: 'ผู้ซื้อปฏิเสธ',
  rejected: 'ผู้จัดเวรไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

export type AppNotification = {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export const LEAVE_TYPE_TH: Record<LeaveType, string> = {
  vacation: 'ลาพักร้อน',
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  other: 'ลาอื่นๆ',
}

export const LEAVE_STATUS_TH: Record<LeaveStatus, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

export const SWAP_STATUS_TH: Record<SwapStatus, string> = {
  pending_counterpart: 'รอคู่แลกตอบรับ',
  pending_approval: 'รอผู้จัดเวรอนุมัติ',
  approved: 'อนุมัติแล้ว',
  declined: 'คู่แลกปฏิเสธ',
  rejected: 'ผู้จัดเวรไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

export function leaveDays(leave: Pick<Leave, 'start_date' | 'end_date' | 'day_part'>): number {
  if (leave.day_part !== 'full') return 0.5
  const start = new Date(`${leave.start_date}T00:00:00Z`).getTime()
  const end = new Date(`${leave.end_date}T00:00:00Z`).getTime()
  return Math.round((end - start) / 86400000) + 1
}
