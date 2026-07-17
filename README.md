# ระบบจัดตารางเวร (Shift Scheduling System)

ระบบจัดตารางเวรนักเทคนิคการแพทย์ออนไลน์แบบครบวงจร สำหรับกลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี — จัดเวรอัตโนมัติ, แลก/ขายเวร, บันทึกวันลา, แจ้งเตือน, Dashboard, และรายงาน PDF/Excel

**Production:** https://shift-scheduling-system-mtcbh.vercel.app
**Repo:** https://github.com/nicssj-world/Shift-Scheduling-System

---

## ภาพรวมฟีเจอร์

| หมวด | รายละเอียด |
|---|---|
| **จัดตารางเวร** | จัดอัตโนมัติแบบ rule-based + fairness scoring (deterministic — รันซ้ำได้ผลเดิมเสมอ ไม่มี randomness) แก้ตารางรายเซลล์ได้ ตรวจกฎแบบเรียลไทม์ เผยแพร่/ล็อคตารางเมื่อสิ้นเดือน |
| **ทีมเวร** | เจ้าหน้าที่ Central Lab (เวรบ่าย/ดึกทุกวัน + เวรเช้าเฉพาะ ส-อา/วันหยุด, 4 คน/เวร, หมุนเวียน Job Chem/Sero/Hemato/Micros) และ ผู้ช่วย Central Lab (2 คน/เวร, ไม่มี Job) — เพิ่มทีมใหม่ได้ภายหลังผ่านหน้า Admin โดยไม่ต้องแก้โค้ด |
| **แลกเวร** | คู่แลก 1 ต่อ 1 — คู่แลกตอบรับ → ผู้จัดเวรอนุมัติ (ปิดขั้นตอนอนุมัติได้ผ่านตั้งค่า) |
| **ขายเวร** | โอนเวรทางเดียวได้หลายเวรพร้อมกัน — ผู้ขายลดเวร ผู้ซื้อเพิ่มเวรตามจำนวนที่รับ |
| **วันลา** | พักร้อน/ป่วย/กิจ/อื่นๆ รองรับลาครึ่งวัน (0.5 วัน) — พนักงานแจ้งลาเอง (รออนุมัติ) หรือ Admin/Manager คีย์ตรง (อนุมัติทันที) สรุปผลข้ามช่วงเดือนได้ |
| **แจ้งเตือน** | ในแอปผ่าน Supabase Realtime (กระดิ่งแจ้งเตือน) + เตือนเวรวันพรุ่งนี้อัตโนมัติทุกวันผ่าน Vercel Cron |
| **Dashboard** | ภาพรวมกำลังคน, อัตราครอบคลุมเวร, กราฟ/heatmap ภาระงาน |
| **วิเคราะห์** | ตรวจจับเวรเกินมาตรฐาน, ความไม่สมดุลของภาระงาน, คาดการณ์กำลังคนเดือนถัดไป (rule-based ล้วน ไม่มี LLM) |
| **รายงาน** | ตารางเวรรายเดือน / สรุปวันลา / สรุป OT — export PDF (ฟอนต์ไทย Sarabun) และ Excel |

---

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4**
- **Supabase** — Auth + Postgres (โปรเจกต์ Supabase **ใช้ร่วมกับ** [lab-management-portal](https://github.com/nicssj-world/lab-management-portal): ref `fslagsuorkcckvvtrmyi`, region `ap-southeast-2` / Sydney)
- **Vercel** — deploy บน team เดียวกับ portal (`nics-sj-s-projects`), function region ตั้งเป็น `syd1` (Sydney) ให้ตรงกับ Supabase เพื่อ latency ต่ำสุด
- **Vitest** สำหรับ unit test (เน้นที่ scheduler engine)
- **jsPDF** + **xlsx** สำหรับ export รายงาน, **recharts** สำหรับกราฟ Dashboard, **lucide-react** icon set

---

## สถาปัตยกรรมที่ต้องรู้ก่อนแก้โค้ด

แอปนี้ **แชร์ฐานข้อมูล Supabase เดียวกับ lab-management-portal** (ตาราง `profiles`, Supabase Auth ชุดเดียวกัน) — มีข้อจำกัดสำคัญ:

1. **ห้ามแก้ตาราง `profiles` หรือ RLS ของมันเด็ดขาด** ทุกตารางใหม่ในระบบนี้ต้อง prefix ด้วย `shift_` และ FK ไปที่ `profiles(id)` เท่านั้น
2. **RLS ของ `profiles` อ่านได้เฉพาะตัวเอง/Admin** ดังนั้นชื่อเพื่อนร่วมงานทั้งหมดต้องเสิร์ฟผ่าน API route ที่ใช้ **service-role client** (`lib/supabase/admin.ts`) เท่านั้น ห้าม query `profiles` ตรงจาก browser
3. **Auth cookie ชื่อ `shift-auth`** (ไม่ใช่ชื่อ default `sb-...`) ต้องตั้งตรงกันใน 3 จุด: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `proxy.ts` — เพื่อไม่ให้ session ชนกับ portal เวลารันคู่กันบน localhost
4. **NEXT_PUBLIC_ env vars ต้องอ้างอิงแบบ static** (`process.env.NEXT_PUBLIC_X`) ใน client-side code ห้ามใช้ dynamic bracket access (`process.env[name]`) เพราะ Next.js bundler inline ค่าได้เฉพาะรูปแบบ static เท่านั้น — ถ้าฝ่าฝืนจะได้ `undefined` ใน browser แบบเงียบๆ ไม่มี error (`lib/supabase/client.ts` เป็นตัวอย่างที่ถูกต้อง)
5. **Data access ทั้งหมดผ่าน `/api/*` route handlers** — auth ด้วย SSR cookie client (`requireActor()`) แล้วอ่าน/เขียนด้วย service-role client + ตรวจสิทธิ์ในโค้ด ไม่พึ่ง RLS เป็นด่านหลัก (RLS เป็นแค่ defense-in-depth)

---

## Setup

```bash
npm install
```

สร้าง `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://fslagsuorkcckvvtrmyi.supabase.co   # ค่าเดียวกับ lab-management-portal
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=...   # สุ่มเอง ใช้ยืนยันตัวตน Vercel Cron (header Authorization: Bearer <CRON_SECRET>)
```

รัน migration **ตามลำดับ** ใน Supabase SQL Editor (ไม่มี CLI/direct DB access ในเครื่อง dev ปกติ ต้อง copy ไปรันเองในหน้า SQL Editor ของ Supabase):

| ไฟล์ | ทำอะไร |
|---|---|
| `202607070001_shift_core_v1.sql` | สร้างตาราง `shift_*` ทั้งหมด (teams, members, shift types, requirements, jobs, holidays, schedules, assignments, leaves, swaps, notifications, schedulers, settings) + RLS + seed ทีม/ประเภทเวร/Job เริ่มต้น |
| `202607080001_shift_team_allowed_roles.sql` | เพิ่มคอลัมน์ `allowed_roles` ให้ทีม (จำกัด Role ที่เพิ่มเข้าทีมได้) |
| `202607080002_shift_team_allowed_depts.sql` | เพิ่มคอลัมน์ `allowed_depts` ให้ทีม (จำกัดแผนกเช่นเดียวกัน) |
| `202607080003_shift_lifetime_totals_fn.sql` | Postgres function `shift_lifetime_totals()` นับเวรสะสมตลอดชีพต่อคนในฐานข้อมูล (ไม่ต้องดึงทุกแถวมานับที่แอป) |
| `202607080004_shift_sale_requests.sql` | ตาราง `shift_sale_requests` + `shift_sale_items` สำหรับฟีเจอร์ขายเวร |
| `202607160001_shift_request_concurrency_audit.sql` | จองเวรแบบ atomic ป้องกันคำขอชนกัน, apply แลก/ขายใน transaction เดียว, roster version และ audit history ถาวร |

```bash
npm run dev
```

---

## Permission model

| ความสามารถ | Admin | ผู้ได้รับมอบหมายจัดเวร (`shift_schedulers`) | Manager | Medical Technologist / Assistant |
|---|---|---|---|---|
| จัดตารางเวร (generate/แก้/เผยแพร่/ล็อค/ปลดล็อค) | ✅ | ✅ (เทียบเท่า Admin) | ❌ | ❌ |
| อนุมัติแลก/ขายเวร | ✅ | ✅ | ❌ | ❌ |
| ตั้งค่าระบบ / ทีมเวร / ประเภทเวร / วันหยุดพิเศษ | ✅ | ✅ | ❌ | ❌ |
| หน้าวิเคราะห์ (Analytics) | ✅ | ✅ | ❌ | ❌ |
| Dashboard (ภาพรวม) | ✅ | ✅ | ✅ | ❌ |
| อนุมัติ/คีย์วันลาแทนคนอื่น | ✅ | ✅ | ✅ | ❌ |
| ดูตารางเวร, ขอแลก/ขายเวร, แจ้งลา | ✅ | ✅ | ✅ | ✅ |

**หลักการ:** ผู้ที่ถูก "มอบหมายจัดเวร" (แถวใน `shift_schedulers`, มอบหมายได้ที่หน้า ตั้งค่าระบบ) จะได้สิทธิ์**เทียบเท่า Admin ทุกจุด**โดยอัตโนมัติ ไม่ว่า role หลักของคนนั้นจะเป็นอะไร — คำนวณครั้งเดียวใน `getActor()` (`lib/server/auth.ts`) แล้วส่งต่อเป็น `actor.isAdmin` ทำให้ guard ทุกจุดในแอปได้สิทธิ์นี้อัตโนมัติโดยไม่ต้องแก้ทีละจุด

---

## Scheduler engine

`lib/scheduler/` เป็น **pure TypeScript ไม่แตะฐานข้อมูลเลย** ทดสอบได้ด้วย `npm test` โดยไม่ต้องมี Supabase — ทำให้มั่นใจว่า deterministic 100% (input เดิม → output เดิมเสมอ ไม่มี `Math.random`)

### กฎบังคับ (hard constraints, `lib/scheduler/constraints.ts`)
- ห้ามจัดเวรทับวันลาที่อนุมัติแล้ว
- พักหลังเวรดึกก่อน OT ถัดไปอย่างน้อยตามที่ตั้งค่า (default 8 ชม.)
- วันจันทร์–ศุกร์ที่ไม่ใช่วันหยุด ทุกคนมีงานประจำ 08:00–16:00 โดยอัตโนมัติ แม้ไม่ใช่ OT และไม่แสดงเป็น assignment — เวลานี้ต้องนำไปรวมเมื่อตรวจชั่วโมงทำงานต่อเนื่องและวันหยุดประจำสัปดาห์
- ห้ามทำงานติดต่อกันเกิน 16 ชม. เสมอ งานประจำต่อเวรบ่ายหรือเวรดึกครบ 16 ชม.พอดียังทำได้; toggle `allowAfternoonNightDouble` ควบคุมเฉพาะการควบ OT บ่าย→ดึก และไม่สามารถอนุญาตให้เกิน 16 ชม.ได้
- ไม่เกินโควตาเวรสูงสุดต่อเดือน
- ต้องเหลือวันหยุดอย่างน้อย 1 วันต่อสัปดาห์ (เฉพาะสัปดาห์ที่อยู่ในเดือนเต็ม ไม่เช็คสัปดาห์ขอบเดือน)
- ก่อนเผยแพร่และก่อนล็อค ระบบจะตรวจ hard constraints ซ้ำจาก assignments จริงในฐานข้อมูล หากมีข้อผิดพลาดจะไม่เปลี่ยนสถานะและไม่ส่งการแจ้งเตือน

### Fairness scoring (`lib/scheduler/fairness.ts`)
จำนวนเวรของเดือนปัจจุบันเป็นลำดับแรก และเมื่อทุกคนพร้อมทำเวรต้องต่างกันไม่เกิน 1 เวร จากนั้นจึงคิดคะแนนย่อย: ยอดสะสมข้ามเดือน + เวรประเภทเดียวกัน + เวรวันหยุด/วันธรรมดา + วันทำงานติดต่อกัน + โทษการจับคู่คนเดิมซ้ำ (`pairing` weight — ป้องกันคนสองคนถูกจัดเวรเดียวกันซ้ำๆ) ปรับน้ำหนักแต่ละตัวได้ที่หน้าตั้งค่าระบบ

การเลือกคนต่อ 1 ช่องเวรใช้วิธี **เลือกทีละคนแล้วคิดคะแนนใหม่** (ไม่ใช่ sort ครั้งเดียวตัด N คนแรก) เพื่อไม่ให้สองคนที่คะแนนเท่ากันถูกจับคู่ซ้ำตลอดไป และใช้ **hash กำหนดได้ (deterministic) ของ (วันที่, ประเภทเวร, คน)** แทนการเรียงตามรหัสพนักงานตรงๆ เป็นตัวตัดสินเสมอ — ป้องกันไม่ให้คนรหัสน้อยชนะ tie-break ทุกครั้งจนเกิด clique

### ยอดเวรสะสมข้ามเดือน (lifetime carry-in)
ระบบจำจำนวนเวรสะสม**ตลอดชีพ**ของแต่ละคนในทีม (ไม่ใช่แค่เดือนก่อนหน้า) เพื่อหมุนว่าใครควรได้เวรส่วนเกิน โดยไม่ทำให้ยอดภายในเดือนปัจจุบันต่างกันเกิน 1 คำนวณผ่าน Postgres function `shift_lifetime_totals()` (ไม่ดึงทุกแถวมานับที่แอป — คงที่ตลอดไม่ว่าจะมีประวัติกี่ปี) ส่วนประเภทเวร, Job, ภาระเวรวันหยุด และคู่เวร อ้างอิงเดือนก่อนหน้าหนึ่งเดือนเพื่อให้การหมุนเวียนต่อเนื่องข้ามรอยต่อเดือน รวมถึงนำเวรปลายเดือนกับงานประจำวันธรรมดามาตรวจเพดาน 16 ชั่วโมงต่อเนื่องกับต้นเดือนใหม่

### Job rotation (`lib/scheduler/rotation.ts`)
ทีมที่ `uses_jobs = true` (เช่น เจ้าหน้าที่ Central Lab) จะหมุนเวียน Job ตาม count สะสมต่ำสุดก่อน (รวม carry-in เดือนก่อนหน้า)

---

## แลกเวร vs ขายเวร

| | แลกเวร | ขายเวร |
|---|---|---|
| ทิศทาง | 2 ทาง (สลับกัน) | ทางเดียว |
| จำนวนเวรรวมของแต่ละคน | ไม่เปลี่ยน | เปลี่ยน — ผู้ขายลด ผู้ซื้อเพิ่ม |
| เลือกได้กี่เวรต่อคำขอ | 1 | หลายเวร |
| ตาราง | `shift_swap_requests` | `shift_sale_requests` + `shift_sale_items` |
| Apply logic | `lib/server/swaps.ts` `applySwap()` | `lib/server/sales.ts` `applySale()` |

ทั้งสองฟีเจอร์: ใช้ได้เฉพาะเวรวันนี้หรืออนาคตในตารางที่เผยแพร่และยังไม่ล็อค, ต้องอยู่ทีมเดียวกัน, และเวรหนึ่งรายการอยู่ในคำขอที่รอดำเนินการได้เพียงคำขอเดียว การจองทำใน Postgres transaction ด้วย `shift_assignment_reservations.assignment_id` ที่เป็น primary key จึงมีผู้ชนะเพียงคำขอเดียวแม้ทั้ง 31 คนกดพร้อมกัน เมื่อคำขอจบ ระบบลบเฉพาะ reservation เพื่อไม่ให้ตารางจองบวม แต่เก็บ request, sale items และ `shift_request_events` เป็นประวัติถาวร

ก่อนอนุมัติ ระบบจำลองเจ้าของเวรหลังแลก/ขายและตรวจ hard constraints (วันลา, เวรซ้อน, เวรดึก/เวลาพัก, ไม่เกิน 16 ชั่วโมง, โควตารายเดือน, วันหยุดประจำสัปดาห์) จากนั้น RPC จะเทียบ `assignment_version` ภายใต้ row lock และเปลี่ยนเจ้าของเวรพร้อมสถานะคำขอใน transaction เดียว หากมีคำขออื่นเปลี่ยนตารางแทรกระหว่างตรวจ ระบบจะ revalidate หนึ่งครั้งแทนการใช้ผลตรวจเก่า ประวัติทุกคำขอเก็บถาวรไม่มีการลบ (ปุ่มยกเลิก/ปฏิเสธแค่เปลี่ยนสถานะ) หน้าประวัติมี timeline, ตัวกรองช่วงเดือน + pagination (`components/history-controls.tsx`) โดยรายการที่รอดำเนินการ (รอตอบรับ/รออนุมัติ) จะไม่ถูกซ่อนด้วยตัวกรองหรือ pagination เด็ดขาด

---

## แจ้งเตือน

- In-app ผ่าน Supabase Realtime — ตาราง `shift_notifications` อยู่ใน `supabase_realtime` publication, insert ผ่าน service role เท่านั้น (`lib/server/notify.ts`)
- เตือนเวรวันพรุ่งนี้: `vercel.json` ตั้ง cron เรียก `/api/cron/shift-reminders` เวลา 09:00 UTC (16:00 น. ไทย) ทุกวัน ยืนยันตัวตนด้วย header `Authorization: Bearer ${CRON_SECRET}` idempotent ผ่าน `dedupe_key`

---

## รายงาน

หน้า "รายงาน" มี 3 แบบ: ตารางเวรรายเดือน (layout เดียวกับตารางกระดาษ), สรุปวันลา (เลือกช่วงเดือนได้), สรุป OT — preview ในหน้าเว็บก่อน แล้ว export เป็น PDF (`lib/reports/pdf.ts`, ฟอนต์ไทย Sarabun ฝัง base64 ที่ `lib/fonts/sarabun-base64.ts`) หรือ Excel (`lib/reports/excel.ts`) ได้ ข้อมูลถูก fetch จาก API เป็น JSON แล้ว build ฝั่ง client (ไม่มี server-side rendering ของไฟล์ export)

---

## คำสั่งที่ใช้บ่อย

```bash
npm run dev          # dev server (http://localhost:3000)
npm run build         # production build
npm run test          # รัน vitest ครั้งเดียว
npm run test:watch    # vitest watch mode
npm run lint           # eslint
```

## Deploy (Vercel)

โปรเจกต์ Vercel ชื่อ `shift-scheduling-system` อยู่ team `nics-sj-s-projects` (เดียวกับ portal ซึ่งใช้ชื่อโปรเจกต์ `lab-management-cbh`) — **function region ตั้งเป็น `syd1`** ให้ตรงกับ region ของฐานข้อมูล Supabase (`ap-southeast-2`) มิเช่นนั้นทุก query จะมี latency ข้ามทวีปโดยไม่จำเป็น

```bash
npx vercel deploy --prod --yes
# แล้ว re-point custom alias ไปยัง deployment ล่าสุด (Vercel ไม่ทำให้อัตโนมัติสำหรับ custom alias)
npx vercel alias set <deployment-url> shift-scheduling-system-mtcbh.vercel.app
```

Deployment protection (Vercel SSO) ปิดไว้แล้วที่ระดับโปรเจกต์ ไม่ต้องเปิดใหม่ทุกครั้ง

---

## ข้อจำกัด/สิ่งที่ยังไม่รองรับ

- ลาครึ่งวันถือว่า "ไม่ว่าง" ทั้งวันในมุมมองของ scheduler (ไม่ได้แบ่งเช้า/บ่ายให้จัดเวรอีกครึ่งวันได้)
- Weekly-day-off ไม่เช็คสัปดาห์ที่คาบเกี่ยวขอบเดือน (เฉพาะสัปดาห์เต็มในเดือนนั้น)
- ยอดเวรสะสมข้ามเดือนนับเฉพาะภายในทีมเดียวกัน (คนละทีมไม่รวมกัน)
- ไม่มีการแจ้งเตือนผ่าน LINE/email — เฉพาะ in-app เท่านั้น
