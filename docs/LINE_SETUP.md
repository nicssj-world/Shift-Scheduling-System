# LINE OA / MINI App setup

## 1. Database

โปรเจกต์นี้ไม่มี Supabase CLI หรือ connection ที่ให้ migration อัตโนมัติ จึงต้อง copy/run ไฟล์นี้ใน Supabase SQL Editor:

`supabase/migrations/202609020002_line_integration.sql`

ไฟล์เป็น idempotent และสร้างเฉพาะ object ที่ขึ้นต้นด้วย `shift_` (ยกเว้นการเพิ่ม column ที่จำเป็นใน `shift_sale_requests`)

หลังจากนั้นให้รัน migration สำหรับการแยกกลุ่มตามกลุ่มงาน/ประเภทเวร:

`supabase/migrations/202609030001_line_group_mapping.sql`

จากนั้นให้รัน migration จำกัดสิทธิ์โปรเจกต์นี้ต่อด้วย:

`supabase/migrations/202609030002_project_management_permissions.sql`

## Open-sale marketplace

Run `supabase/migrations/202609030004_open_sale_marketplace.sql` after the LINE/group-mapping migrations. It is safe to run repeatedly in the Supabase SQL Editor.

Enable the central feature flag `sale.openEnabled` from Admin → System settings. The same unified market is exposed at `/sales/open` (web) and `/line/open-sales` (LINE MINI App); both use the same API/RPC validation. One listing may contain up to 31 shifts across months, but all shifts must belong to one team. Viewers only see teams they can access and claims require active team membership plus every hard scheduling rule.

Listings are grouped one card per sale request. Items expire when the Bangkok date rolls to the next day; only expired items disappear, while future items stay in the same listing. Expiry is recorded in `shift_sale_items` and `shift_request_events`, and cleanup runs before marketplace operations and every 15 minutes from `/api/cron/line-dispatch`. `sale.requiresApproval` still controls whether a claim waits for scheduler approval.

For next-month scheduling rules, run `supabase/migrations/202609030005_initial_roster_carry_in.sql` after `202609020001_shift_initial_roster_snapshot.sql`. This makes fairness and cross-month continuity use the roster from before swaps or sales.

## 2. Environment variables

ตั้งค่าที่ Vercel และ local environment โดยไม่ commit ค่า secret:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=...

LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_MINI_APP_CHANNEL_ID=...    # LINE Login/LIFF channel ID (LINE_CHANNEL_ID is accepted as a legacy alias)
LINE_APP_BASE_URL=https://your-domain.example
NEXT_PUBLIC_LINE_MINI_APP_LIFF_ID=...
```

`LINE_MINI_APP_CHANNEL_ID` ต้องเป็น channel ID ของ LIFF/MINI App ที่อยู่ Provider เดียวกับ Messaging API channel เพื่อให้ subject ID เป็นชุดเดียวกัน

## 3. LINE Developers Console

1. สร้าง/เลือก Provider เดียวกันสำหรับ Messaging API channel และ LINE MINI App
2. เปิด Use webhook และตั้ง callback เป็น `https://your-domain.example/api/line/webhook`
3. ปิด auto-reply หากไม่ต้องการข้อความซ้ำ แล้วกด Verify webhook
4. ตั้ง LIFF endpoint URL เป็น `https://your-domain.example/line`
5. เพิ่ม scope ที่จำเป็นสำหรับ LIFF และใช้ ID token flow; server จะ verify token กับ LINE
6. สร้าง Rich Menu ตาม action ด้านล่าง และผูก rich menu ให้ account ที่เชื่อมแล้วตามนโยบายของทีม

Rich Menu actions:

| ปุ่ม | Action |
|---|---|
| ตารางเวร | URI `/line/schedule` |
| เวรของฉัน | URI `/line/my-shifts` |
| เวรวันนี้ | Postback `daily_roster` |
| แลกเวร | URI `/line/swap` |
| ขาย/รับเวร | URI `/line/sell` |
| คำขอ | URI `/line/requests` |
| เชื่อมบัญชี | URI `/line/link` หรือส่งข้อความ `เชื่อมบัญชี` |

## 4. Cron

`vercel.json` เรียก `/api/cron/line-dispatch` ทุก 15 นาทีและส่ง `Authorization: Bearer $CRON_SECRET` ให้ Vercel Cron อัตโนมัติ โดย dispatcher จะ:

- drain notification outbox ด้วย retry/backoff
- ส่ง reminder เวลาท้องถิ่น Asia/Bangkok ตาม system setting
- สร้าง daily roster สำหรับ approved groups เท่านั้น

มี endpoint เฉพาะสำหรับการทดสอบ/เรียก manual: `/api/cron/line-daily-roster`

## 5. Mapping กลุ่มงานกับ LINE Group

ใช้ LINE OA เดียวกับทุกกลุ่ม โดยให้ Admin ตั้งค่าที่ `Admin → ตั้งค่าระบบ → จับคู่กลุ่มงานกับ LINE Group`

1. เชิญ LINE OA เข้า group ที่ต้องการ
2. รอให้ webhook ตรวจพบ group หรือคัดลอก LINE Group ID มากรอกในหน้าตั้งค่า
3. เลือกกลุ่มงาน/ห้องเวร แล้วกรอก Group ID ระดับกลุ่มงาน หรือเพิ่ม mapping เฉพาะประเภทเวร
4. ไปที่ `Admin → LINE Integration` เพื่ออนุมัติและเปิดใช้งาน group
5. ทดสอบด้วยการสร้างประกาศขายเวรแบบรับคนแรกในกลุ่มงานนั้น

กติกาการส่ง:

- ประกาศขายเวรแบบรับคนแรกส่งเฉพาะกลุ่มที่ mapping ตรงกับ `team_id` และ `shift_type_id`
- ถ้ามี mapping เฉพาะประเภทเวร จะใช้ mapping นั้นแทน mapping ระดับกลุ่มงาน
- daily roster ใช้ mapping เดียวกันและแสดงเฉพาะข้อมูลของกลุ่มงาน/ประเภทเวรที่ผูกไว้
- กลุ่มที่ไม่มี mapping, ยังไม่อนุมัติ หรือปิดใช้งาน จะไม่รับประกาศกลุ่ม
- การแลกเวรและขายเวรแบบระบุผู้ซื้อยังแจ้งส่วนตัวตาม LINE ID ที่ผูกบัญชี

## 6. เปิดใช้งานแบบปลอดภัย

เริ่มจาก `line.enabled=false` แล้วทดสอบ account linking และ read-only ใน staging จากนั้นเปิด `swapEnabled`, `saleEnabled`, `openSaleEnabled`, `dailyRosterEnabled` ทีละรายการใน Admin → LINE Integration

ประกาศขายแบบรับคนแรกใช้ได้ทั้งเว็บและ LINE MINI App ผ่านกฎชุดเดียวกัน โดย `/line/sell` ใช้สำหรับสร้างประกาศ/ขายเวร และ `/line/open-sales` ใช้ดูตลาดและรับเวร

ก่อนเปิดเผยเบอร์โทร ให้ตรวจว่า group เป็นกลุ่มภายในที่อนุมัติแล้ว และเปิด `showPhoneInDailyRoster` ทั้งระดับระบบและกลุ่มเท่านั้น
