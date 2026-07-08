# ระบบจัดตารางเวร (Shift Scheduling System)

ระบบจัดตารางเวรนักเทคนิคการแพทย์ออนไลน์ กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี

- จัดตารางเวรอัตโนมัติ (rule-based + fairness scoring, deterministic)
- เวรบ่าย/ดึกทุกวัน เวรเช้าเฉพาะ ส-อา/วันหยุด · ทีมเจ้าหน้าที่ (4 คน หมุนเวียน Chem/Sero/Hemato/Micros) · ทีมผู้ช่วย (2 คน)
- ขอแลกเวรออนไลน์ (คู่แลกตอบรับ → ผู้จัดเวรอนุมัติ) · ล็อคตารางเมื่อสิ้นเดือน
- บันทึกวันลา (พักร้อน/ป่วย/กิจ/อื่นๆ รองรับครึ่งวัน 0.5) พร้อมสรุปช่วงเดือน
- แจ้งเตือนในแอป (Supabase Realtime) + เตือนเวรพรุ่งนี้ (Vercel cron)
- Dashboard ผู้บริหาร · รายงาน PDF (ฟอนต์ Sarabun) / Excel

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase (แชร์ project เดียวกับ
[lab-management-portal](https://github.com/nicssj-world/lab-management-portal) — ใช้ตาราง `profiles`
และ Supabase Auth ชุดเดียวกัน, login ด้วยรหัส E-Phis) · Vercel

## Setup

1. `npm install`
2. สร้าง `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...        # ค่าเดียวกับ lab-management-portal
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   CRON_SECRET=...                      # สุ่มเอง ใช้ยืนยัน Vercel cron
   ```
3. รัน migration `supabase/migrations/202607070001_shift_core_v1.sql` ใน Supabase SQL Editor
   (สร้างตาราง `shift_*` ทั้งหมด + RLS + seed ทีม/ประเภทเวร/Job — **ไม่แตะตาราง `profiles` เดิม**)
4. `npm run dev`

## Conventions

- ตารางใหม่ทุกตาราง prefix `shift_` และ FK ไป `profiles(id)` — ห้ามแก้ `profiles` หรือ RLS เดิม
- Auth cookie ชื่อ `shift-auth` (กำหนดใน `lib/supabase/client.ts`, `lib/supabase/server.ts`, `proxy.ts`
  ทั้ง 3 จุดต้องตรงกัน) เพื่อไม่ชนกับ session ของ portal บน localhost
- เพิ่ม protected route ใหม่ต้องเพิ่ม matcher ใน `proxy.ts`
- Data access ทั้งหมดผ่าน `/api/*` (SSR cookie auth → service-role client + ตรวจสิทธิ์ในโค้ด)
- ชื่อในตารางเวร: ชื่อแรก + วงเล็บพยางค์นามสกุลเมื่อซ้ำ (`lib/names.ts`) — override ได้ต่อคนใน
  หน้า Admin > บุคลากรและทีมเวร

## Scheduler engine

`lib/scheduler/` — pure TypeScript ไม่แตะฐานข้อมูล ทดสอบด้วย `npm test`

กฎ hard: ห้ามจัดวันลา · พักหลังเวรดึก ≥ ชม.ที่ตั้งค่า · ≤16 ชม.ติดต่อกัน (บ่ายควบดึก = toggle) ·
เพดานเวร/เดือน · วันหยุดประจำสัปดาห์ · Job หมุนเวียนตาม count สะสม · deterministic 100%

## Deploy (Vercel)

โปรเจกต์ Vercel แยกจาก portal แต่ team เดียวกัน ตั้ง env ทั้ง 4 ตัวข้างต้น
`vercel.json` มี cron เตือนเวรพรุ่งนี้เวลา 09:00 UTC (16:00 น. ไทย)
