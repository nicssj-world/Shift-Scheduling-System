# ระบบจัดตารางเวร (Shift Scheduling System)

ระบบจัดตารางเวรนักเทคนิคการแพทย์ออนไลน์แบบครบวงจร สำหรับกลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี — จัดเวรอัตโนมัติ, แลก/ขายเวร, ทะเบียนวันลาและการมาปฏิบัติงาน, แจ้งเตือน, Dashboard, และรายงาน PDF/Excel

**Production:** https://shift-scheduling-system-mtcbh.vercel.app
**Repo:** https://github.com/nicssj-world/Shift-Scheduling-System

## Open-sale marketplace

Apply `supabase/migrations/202609030004_open_sale_marketplace.sql` after the existing LINE/group-mapping migrations in the Supabase SQL Editor. The migration is idempotent and adds the global `sale.openEnabled` flag, multi-month same-team listings (up to 31 shifts), per-item expiry, audit events, and version-safe claim/apply RPCs.

Apply `supabase/migrations/202609030005_initial_roster_carry_in.sql` after the snapshot migration. It makes next-month carry-in fairness and boundary checks use each published schedule's immutable pre-swap/pre-sale roster; schedules without a snapshot keep the compatibility fallback to their current assignments.

The unified marketplace is available at `/sales/open` and `/line/open-sales`. It is filtered to teams the viewer may access; claiming still requires active membership in the target team and all hard scheduling rules. Set `sale.openEnabled=true` in Admin → System settings to enable it, then keep `sale.requiresApproval` to choose immediate transfer or scheduler approval.

Listings are grouped as one card per sale request. A shift remains claimable through its Bangkok calendar date; cleanup runs before marketplace reads/mutations and every 15 minutes from the LINE dispatcher. Expired items are retained for audit, removed from the market, and a request becomes `expired` only when no future active items remain.

---

## ภาพรวมฟีเจอร์

| หมวด | รายละเอียด |
|---|---|
| **จัดตารางเวร** | จัดอัตโนมัติแบบ rule-based + fairness scoring (deterministic — รันซ้ำได้ผลเดิมเสมอ ไม่มี randomness) แก้ตารางรายเซลล์ได้ ตรวจกฎแบบเรียลไทม์ เผยแพร่/ล็อคตารางเมื่อสิ้นเดือน |
| **ทีมเวร** | เจ้าหน้าที่ Central Lab (เวรบ่าย/ดึกทุกวัน + เวรเช้าเฉพาะ ส-อา/วันหยุด, 4 คน/เวร, หมุนเวียน Job Chem/Sero/Hemato/Micros) และ ผู้ช่วย Central Lab (2 คน/เวร, ไม่มี Job) — เพิ่มทีมใหม่ได้ภายหลังผ่านหน้า Admin โดยไม่ต้องแก้โค้ด |
| **แลกเวร** | คู่แลก 1 ต่อ 1 — คู่แลกตอบรับ → ผู้จัดเวรอนุมัติ (ปิดขั้นตอนอนุมัติได้ผ่านตั้งค่า) |
| **ขายเวร** | โอนเวรทางเดียวได้หลายเวรพร้อมกัน — ผู้ขายลดเวร ผู้ซื้อเพิ่มเวรตามจำนวนที่รับ |
| **ทะเบียนวันลาและการมาปฏิบัติงาน** | ธุรการบันทึกข้อมูลรายวันแทนบุคลากร รองรับ 10 รหัส จัดการรายชื่อในตารางเพิ่ม/นำออกได้ภายหลัง ทุกคนดูทะเบียนรวมและประวัติของตนเองได้ สรุปเป็น PDF/Excel ได้ โดยไม่ใช่ระบบยื่นลาและไม่กระทบการจัดเวร |
| **แจ้งเตือน** | ในแอปผ่าน Supabase Realtime (กระดิ่งแจ้งเตือน) + เตือนเวรวันพรุ่งนี้อัตโนมัติทุกวันผ่าน Vercel Cron + LINE OA ส่วนตัว/กลุ่มที่ Admin mapping ไว้ |
| **Dashboard** | ภาพรวมกำลังคน, อัตราครอบคลุมเวร, กราฟ/heatmap ภาระงาน |
| **วิเคราะห์** | ตรวจจับเวรเกินมาตรฐาน, ความไม่สมดุลของภาระงาน, คาดการณ์กำลังคนเดือนถัดไป (rule-based ล้วน ไม่มี LLM) |
| **รายงาน** | ตารางเวรรายเดือน / สรุปทะเบียนวันลาและการมาปฏิบัติงาน / สรุป OT — export PDF (ฟอนต์ไทย Sarabun) และ Excel |

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
# optional: เปลี่ยนปฏิทินวันหยุด Google ได้; ค่าเริ่มต้นคือปฏิทินวันหยุดในไทย
GOOGLE_HOLIDAY_CALENDAR_ID=th.th#holiday@group.v.calendar.google.com
# optional: ใช้ public iCal URL โดยตรงแทน Calendar ID
# GOOGLE_HOLIDAY_CALENDAR_ICS_URL=https://...
```

รัน migration **ตามลำดับ** ใน Supabase SQL Editor (ไม่มี CLI/direct DB access ในเครื่อง dev ปกติ ต้อง copy ไปรันเองในหน้า SQL Editor ของ Supabase):

| ไฟล์ | ทำอะไร |
|---|---|
| `202607070001_shift_core_v1.sql` | สร้างตาราง `shift_*` ทั้งหมด (teams, members, shift types, requirements, jobs, holidays, schedules, assignments, leaves, swaps, notifications, schedulers, settings) + RLS + seed ทีม/ประเภทเวร/Job เริ่มต้น |
| `202607080001_shift_team_allowed_roles.sql` | เพิ่มคอลัมน์ `allowed_roles` ให้ทีม (จำกัด Role ที่เพิ่มเข้าทีมได้) |
| `202607080002_shift_team_allowed_depts.sql` | เพิ่มคอลัมน์ `allowed_depts` ให้ทีม (จำกัดแผนกเช่นเดียวกัน) |
| `202607080003_shift_lifetime_totals_fn.sql` | ฟังก์ชัน aggregation เดิมสำหรับข้อมูลย้อนหลัง (ยังเก็บไว้เพื่อ compatibility) |
| `202607080004_shift_sale_requests.sql` | ตาราง `shift_sale_requests` + `shift_sale_items` สำหรับฟีเจอร์ขายเวร |
| `202607160001_shift_request_concurrency_audit.sql` | จองเวรแบบ atomic ป้องกันคำขอชนกัน, apply แลก/ขายใน transaction เดียว, roster version และ audit history ถาวร |
| `202608310001_shift_holiday_google_sync.sql` | เพิ่มแหล่งที่มา/รหัส Event ของวันหยุด เพื่อ Sync จาก Google โดยไม่ทับรายการที่ Admin คีย์เอง |
| `202608310002_shift_assignment_reservation_realtime.sql` | สร้างสถานะ reservation แบบปลอดภัยสำหรับ Supabase Realtime เพื่อซ่อน/ปิดเวรที่กำลังรอดำเนินการทันที |
| `202608310003_scheduler_rule_hardening.sql` | เพิ่ม flag เวรดึก, rolling fairness 6 เดือน (รวมทุกมิติใน Postgres aggregation) และ RPC แบบ atomic สำหรับสร้าง/แก้ตารางพร้อม version check |
| `202608310004_shift_attendance_register.sql` | ทะเบียนวันลา/การมาปฏิบัติงานรายวัน, รายชื่อผู้บันทึก, roster รายชื่อในตาราง, RLS และ RPC รายงานรวม |
| `202608310005_shift_vacation_balances.sql` | สิทธิ์พักร้อนแยกบุคลากรและปีงบประมาณ พร้อมยอดยกมาจากปีก่อน สิทธิ์ปีปัจจุบัน และ RLS |
| `202609020001_shift_initial_roster_snapshot.sql` | เพิ่ม snapshot รายการเวรฉบับก่อนเผยแพร่ครั้งแรก เพื่อคง baseline แม้มีการแลก/ขาย/แก้เวรภายหลัง |
| `202609020002_line_integration.sql` | LINE account linking, MINI App, webhook, notification outbox, approved groups และ feature flags |
| `202609030001_line_group_mapping.sql` | Mapping กลุ่มงาน/ประเภทเวรกับ LINE Group เพื่อแยกประกาศตามห้องเวร |
| `202609030002_project_management_permissions.sql` | จำกัดสิทธิ์จัดการโปรเจกต์ไว้ที่ Admin และผู้ได้รับมอบหมายจัดเวร (ยกเว้นตั้งค่าระบบ/LINE Integration); Manager เป็นสิทธิ์ดูอย่างเดียว |
| `202609030003_central_lab_section_weights.sql` | เพิ่มค่า preference Chem/Sero และ Hemato/Micros ต่อสมาชิก Central Lab (0–100%, รวม 100%) สำหรับการหมุน Job อัตโนมัติ |
| `202609030004_open_sale_marketplace.sql` | ตลาดเวรเปิดขายแบบรวมทุกทีมที่ผู้ใช้เข้าถึงได้, ประกาศข้ามเดือนได้ในทีมเดียว (สูงสุด 31 เวร), claim แบบตรวจ version, expiry รายเวร และ audit history |
| `202609030005_initial_roster_carry_in.sql` | ให้ rolling fairness และ carry-in ช่วงรอยต่อเดือนอ้างอิง roster snapshot ก่อนแลก/ขายเวร พร้อม fallback สำหรับตารางเก่าที่ไม่มี snapshot |

ก่อนใช้ค่า section preference ให้รัน `202609030003_central_lab_section_weights.sql` ใน Supabase SQL Editor; สมาชิกเดิมจะเริ่มต้นที่ 50/50 และสามารถรันไฟล์ซ้ำได้

นำเข้าข้อมูลจาก Excel หลัง migration โดยเริ่มจาก dry-run (ต้องมี `SUPABASE_SERVICE_ROLE_KEY` ใน `.env.local`):

```bash
node scripts/import-attendance-register.mjs --dry-run --source-of-truth daily --report "C:\Users\<ชื่อผู้ใช้>\Downloads\รายงานจับคู่วันลา ปี 2569.xlsx"
node scripts/import-attendance-register.mjs --commit --actor <admin-profile-uuid>
# ใช้เมื่อผู้ดูแลตรวจชีต "เดาชื่อ" แล้วยอมรับการเดาแล้วเท่านั้น
node scripts/import-attendance-register.mjs --commit --accept-guesses --actor <admin-profile-uuid>
```

คำสั่งนี้จับคู่ด้วยชื่อที่ normalize แล้วเท่านั้น ไม่ใช้เลข ePHIS เป็นเงื่อนไขจับคู่ หากชื่อในระบบตรงกันหลาย profile จะใช้ทุก profile ที่ชื่อเดียวกัน รายงานจะแยก `จับคู่ชื่อตรง`, `เดาชื่อ` และ `จับคู่ไม่ได้` โดยการเดาต้องตรวจสอบในรายงานก่อน รายการที่จับคู่ไม่ได้จะถูกตัดออกจาก Import และแสดงไว้ในชีต `ทิ้งไม่เข้า`; ใช้ `--keep-unmatched` หากต้องการให้สคริปต์หยุดแทนการตัดออก การสั่ง `--commit` ปกติจะรับเฉพาะชื่อที่ตรง; ใช้ `--accept-guesses` เมื่อยืนยันรายการเดาแล้วเท่านั้น

คำสั่ง `--dry-run` จะสร้างรายงานจับคู่แบบ Excel (หรือ JSON หากลงท้ายด้วย `.json`) โดยรวมรายการต่างจากไฟล์สรุปและสิทธิ์พักร้อนจาก sheet `สรุป` ไว้ให้ตรวจสอบก่อน import เมื่อใช้ `--source-of-truth daily` ระบบจะยึดไฟล์วันลารายเดือน ส่วนไฟล์สรุปใช้ตรวจเทียบเท่านั้น จึงไม่หยุดเพราะรายการต่างกัน เมื่อสั่ง `--commit` หลังตรวจสอบผ่านแล้ว สคริปต์จะนำเข้าทั้งทะเบียนรายวันและยอดสิทธิ์พักร้อน ปีงบประมาณ 2569 รายงานอาจมีข้อมูลส่วนบุคคล จึงควรเก็บไว้นอก repository และไม่ commit เข้า git

สคริปต์จะหยุดเมื่อจับคู่บุคลากรไม่ได้ พบข้อมูลซ้ำ รหัส/วันที่ผิด หรือยอดจากไฟล์รายวันไม่ตรงกับไฟล์สรุป การสร้างรายงานเป็นการอ่านข้อมูลเท่านั้นและยังไม่เขียนลงฐานข้อมูล

```bash
npm run dev
```

---

## Permission model

| ความสามารถ | Admin | ผู้ได้รับมอบหมายจัดเวร (`shift_schedulers`) | Manager | Medical Technologist / Assistant |
|---|---|---|---|---|
| จัดตารางเวร (generate/แก้/เผยแพร่/ล็อค/ปลดล็อค) | ✅ | ✅ (เทียบเท่า Admin) | ❌ | ❌ |
| อนุมัติแลก/ขายเวร | ✅ | ✅ | ❌ | ❌ |
| จัดการทีมเวร / ประเภทเวร / วันหยุดพิเศษ | ✅ | ✅ | ❌ | ❌ |
| ตั้งค่าระบบ | ✅ | ❌ | ❌ | ❌ |
| LINE Integration | ✅ | ❌ | ❌ | ❌ |
| หน้าวิเคราะห์ (Analytics) | ✅ | ✅ | ❌ | ❌ |
| Dashboard (ภาพรวม) | ✅ | ✅ | ✅ | ❌ |
| บันทึก/แก้ไข/ลบทะเบียนวันลาแทนบุคลากร | ✅ | ❌ | เมื่อได้รับมอบหมายเท่านั้น | ❌ |
| เพิ่ม/นำ user เข้า–ออกจากรายชื่อในตารางทะเบียน | ✅ | ❌ | เมื่อได้รับมอบหมายเท่านั้น | ❌ |
| ดูตารางเวร, ขอแลก/ขายเวร, ดูทะเบียนวันลา | ✅ | ✅ | ✅ | ✅ |

**หลักการ:** สิทธิ์จัดการโปรเจกต์ (`shift_schedulers`) และสิทธิ์บันทึกทะเบียน (`shift_leave_recorders`) แยกกันโดยตั้งใจ ผู้ที่ถูกมอบหมายจัดเวรมีสิทธิ์เทียบเท่า Admin ในงานจัดเวร ยกเว้น `ตั้งค่าระบบ` และ `LINE Integration`; ไม่สามารถแก้ทะเบียนได้เอง เว้นแต่ Admin เพิ่มชื่อในรายชื่อผู้บันทึก ส่วน Admin มีสิทธิ์เต็มเสมอ

---

## Scheduler engine

`lib/scheduler/` เป็น **pure TypeScript ไม่แตะฐานข้อมูลเลย** ทดสอบได้ด้วย `npm test` โดยไม่ต้องมี Supabase — ทำให้มั่นใจว่า deterministic 100% (input เดิม → output เดิมเสมอ ไม่มี `Math.random`)

### กฎบังคับ (hard constraints, `lib/scheduler/constraints.ts`)
- ตัวจัดเวรไม่อ่านทะเบียนวันลา/การมาปฏิบัติงาน (`shift_attendance_records`) หรือข้อมูลลา legacy (`shift_leaves`) และไม่มีการบล็อก/เตือนจากทะเบียนนี้; `unavailable` ยังเป็น input ทั่วไปของ pure engine สำหรับผู้เรียกใช้โดยตรง
- พักหลังเวรดึกก่อน OT ถัดไปอย่างน้อยตามที่ตั้งค่า (default 8 ชม.)
- วันจันทร์–ศุกร์ที่ไม่ใช่วันหยุด ทุกคนมีงานประจำ 08:00–16:00 โดยอัตโนมัติ แม้ไม่ใช่ OT และไม่แสดงเป็น assignment — เวลานี้ต้องนำไปรวมเมื่อตรวจชั่วโมงทำงานต่อเนื่องและวันหยุดประจำสัปดาห์
- ห้ามทำงานติดต่อกันเกิน 16 ชม. เสมอ งานประจำต่อเวรบ่ายหรือเวรดึกครบ 16 ชม.พอดียังทำได้; toggle `allowAfternoonNightDouble` ควบคุมเฉพาะการควบ OT บ่าย→ดึก และไม่สามารถอนุญาตให้เกิน 16 ชม.ได้
- ไม่เกินโควตาเวรสูงสุดต่อเดือน
- ต้องเหลือวันหยุดอย่างน้อย 1 วันต่อสัปดาห์ โดยตรวจสัปดาห์ที่คาบเดือนด้วยข้อมูล boundary; ถ้าเดือนถัดไปยังไม่มีตารางจะรายงาน warning จนกว่าจะมีข้อมูลยืนยัน
- ก่อนเผยแพร่และก่อนล็อค ระบบจะตรวจ hard constraints ซ้ำจาก assignments จริงในฐานข้อมูล หากมีข้อผิดพลาดจะไม่เปลี่ยนสถานะและไม่ส่งการแจ้งเตือน
- จำนวนคนต่อเวรเป็นจำนวนที่ต้องตรงพอดี (ขาดหรือเกินเป็นข้อผิดพลาด) และ assignment ต้องอยู่ในเดือน สมาชิกทีมที่ใช้งานอยู่ และประเภทเวรที่เปิดใช้งาน
- ทีมที่เปิด Job ต้องใช้ Job ที่ใช้งานอยู่ของทีมนั้นอย่างละหนึ่งครั้งต่อวัน×ประเภทเวร และจำนวน Job ต้องตรงจำนวนคนที่กำหนด

### Fairness scoring (`lib/scheduler/fairness.ts`)
จำนวนเวรของเดือนปัจจุบันเป็นลำดับแรก และเมื่อทุกคนพร้อมทำเวรต้องต่างกันไม่เกิน 1 เวร จากนั้นจึงคิดคะแนนย่อย: ยอดสะสมข้ามเดือน + เวรประเภทเดียวกัน + เวรวันหยุด/วันธรรมดา + วันทำงานติดต่อกัน + โทษการจับคู่คนเดิมซ้ำ (`pairing` weight — ป้องกันคนสองคนถูกจัดเวรเดียวกันซ้ำๆ) ปรับน้ำหนักแต่ละตัวได้ที่หน้าตั้งค่าระบบ หากการจัดอัตโนมัติทำให้เวรประเภทใดต่างกันเกิน 1 ระบบจะหยุดก่อนบันทึก Draft เพื่อไม่ให้ได้ตารางผิดกฎ

การเลือกคนต่อ 1 ช่องเวรใช้วิธี **เลือกทีละคนแล้วคิดคะแนนใหม่** (ไม่ใช่ sort ครั้งเดียวตัด N คนแรก) เพื่อไม่ให้สองคนที่คะแนนเท่ากันถูกจับคู่ซ้ำตลอดไป และใช้ **hash กำหนดได้ (deterministic) ของ (วันที่, ประเภทเวร, คน)** แทนการเรียงตามรหัสพนักงานตรงๆ เป็นตัวตัดสินเสมอ — ป้องกันไม่ให้คนรหัสน้อยชนะ tie-break ทุกครั้งจนเกิด clique

### ยอดเวรสะสมข้ามเดือน (rolling carry-in)
เมื่อมี `initial_assignments` ระบบจะอ้างอิง roster snapshot ก่อนเผยแพร่/แลก/ขายเวรของแต่ละเดือน เพื่อไม่ให้การโอนภายหลังเปลี่ยน fairness ของเดือนถัดไป; ตารางเก่าที่ไม่มี snapshot จะใช้ข้อมูล assignment ปัจจุบันเป็น fallback ชั่วคราว
ระบบใช้ยอดเวรของตารางที่ยืนยันแล้วใน **6 เดือนก่อนหน้า** เพื่อหมุนว่าใครควรได้เวรส่วนเกิน โดยไม่ทำให้ยอดภายในเดือนปัจจุบันต่างกันเกิน 1 ไม่รวมตาราง Draft หรือเดือนอนาคต ส่วนประเภทเวร, Job, ภาระเวรวันหยุด และคู่เวรใช้หน้าต่างเดียวกัน รวมถึงนำเวรปลายเดือนกับงานประจำวันธรรมดามาตรวจเพดาน 16 ชั่วโมงและวันหยุดประจำสัปดาห์ข้ามรอยต่อเดือน

### Job rotation (`lib/scheduler/rotation.ts`)
ทีมที่ `uses_jobs = true` (เช่น เจ้าหน้าที่ Central Lab) จะหมุนเวียน Job ตาม count สะสมต่ำสุดก่อน (รวม carry-in 6 เดือน) และตรวจไม่ให้ Job ซ้ำ/ขาดในเวรเดียวกัน สำหรับเจ้าหน้าที่ Central Lab ระบบจะใช้ section preference ของสมาชิกเป็นลำดับแรกในการลง Job: `CHEM/SERO` = `chem_sero`, `HEMATO/MICROSS` = `hemato_micros`; ภายใน section เดียวกันจะจับคู่ Job ให้สมดุล (เช่น Hemato/Micros 100% จะหมุน Hemato และ Micros ใกล้เคียง 50/50 ไม่ใช่ Hemato อย่างเดียว); ค่า 0% เป็นเพียงความสำคัญต่ำสุด ไม่ใช่การห้ามจัด และจะ fallback เมื่อจำเป็น

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

ก่อนอนุมัติ ระบบจำลองเจ้าของเวรหลังแลก/ขายและตรวจ hard constraints (เวรซ้อน, เวรดึก/เวลาพัก, ไม่เกิน 16 ชั่วโมง, โควตารายเดือน, วันหยุดประจำสัปดาห์) จากนั้น RPC จะเทียบ `assignment_version` ภายใต้ row lock และเปลี่ยนเจ้าของเวรพร้อมสถานะคำขอใน transaction เดียว หากมีคำขออื่นเปลี่ยนตารางแทรกระหว่างตรวจ ระบบจะ revalidate หนึ่งครั้งแทนการใช้ผลตรวจเก่า ประวัติทุกคำขอเก็บถาวรไม่มีการลบ (ปุ่มยกเลิก/ปฏิเสธแค่เปลี่ยนสถานะ) หน้าประวัติมี timeline, ตัวกรองช่วงเดือน + pagination (`components/history-controls.tsx`) โดยรายการที่รอดำเนินการ (รอตอบรับ/รออนุมัติ) จะไม่ถูกซ่อนด้วยตัวกรองหรือ pagination เด็ดขาด

ในหน้าสร้างคำขอ ระบบ subscribe สถานะ `shift_assignment_live_locks` ผ่าน Supabase Realtime เมื่อมีคนเริ่มหรือจบคำขอ รายการเวรจะโหลดใหม่และนำเวรที่ถูกจองออก/ปิดการเลือกทันที มี polling fallback ทุก 10 วินาทีกรณี browser หลุด Realtime ส่วน reservation ในฐานข้อมูลยังเป็นด่านบังคับสุดท้ายเสมอ

---

## แจ้งเตือน

- In-app ผ่าน Supabase Realtime — ตาราง `shift_notifications` อยู่ใน `supabase_realtime` publication, insert ผ่าน service role เท่านั้น (`lib/server/notify.ts`)
- เตือนเวรวันพรุ่งนี้: `vercel.json` ตั้ง cron เรียก `/api/cron/shift-reminders` เวลา 09:00 UTC (16:00 น. ไทย) ทุกวัน ยืนยันตัวตนด้วย header `Authorization: Bearer ${CRON_SECRET}` idempotent ผ่าน `dedupe_key`

---

## รายงาน

หน้า "รายงาน" มี 3 แบบ: ตารางเวรรายเดือน (layout เดียวกับตารางกระดาษ), สรุปทะเบียนวันลา/การมาปฏิบัติงาน (เลือกช่วงเดือนได้), สรุป OT — preview ในหน้าเว็บก่อน แล้ว export เป็น PDF (`lib/reports/pdf.ts`, ฟอนต์ไทย Sarabun ฝัง base64 ที่ `lib/fonts/sarabun-base64.ts`) หรือ Excel (`lib/reports/excel.ts`) ได้ ข้อมูลถูก fetch จาก API เป็น JSON แล้ว build ฝั่ง client (ไม่มี server-side rendering ของไฟล์ export)

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

- ทะเบียนครึ่งวันเป็นข้อมูลรายงาน 0.5 วันเท่านั้น ไม่ถูกใช้เป็น unavailable หรือข้อจำกัดของ scheduler
- Weekly-day-off ไม่เช็คสัปดาห์ที่คาบเกี่ยวขอบเดือน (เฉพาะสัปดาห์เต็มในเดือนนั้น)
- ยอดเวรสะสมข้ามเดือนนับเฉพาะภายในทีมเดียวกัน (คนละทีมไม่รวมกัน)
- LINE Integration มีโครงสร้าง OA/MINI App, account linking, swap/sale, webhook และ notification outbox แล้ว แต่ยังต้องรัน migration และตั้งค่า LINE Console ตาม [คู่มือ LINE](docs/LINE_SETUP.md) ก่อนเปิดใช้งานจริง
- ยังไม่มีการส่งอีเมล — การแจ้งเตือนในระบบเดิมยังเป็น in-app และ LINE ตาม feature flag
