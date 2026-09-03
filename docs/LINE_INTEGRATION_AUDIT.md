# LINE integration audit

สถานะนี้บันทึกจากการตรวจ repository ก่อนเพิ่ม LINE OA/Messaging API/MINI App

## Core ที่นำกลับมาใช้ร่วมกัน

- `getActor()` และ `getActorForUserId()` ใช้กฎเดียวกันจาก `profiles` และ `shift_schedulers`
- การแก้เวรยังผ่าน server route และ database RPC เดิม (`shift_create_*`, `shift_apply_*`, `shift_transition_request`)
- Web และ LINE เรียก `lib/server/line-mutations.ts` ชุดเดียวกัน
- reservation, schedule `assignment_version`, audit/event trigger และ status transition เดิมยังเป็น source of truth

## สิ่งที่เพิ่ม

- `shift_*` LINE tables, RLS และ service-role-only grants ใน migration
- LINE account-link nonce, verified ID token session, opaque HttpOnly session และ CSRF cookie
- read-only schedule/my-shifts/today roster APIs
- swap, direct sale และ open first-claim sale (สร้าง/รับ/ยกเลิก open listing ผ่าน LINE ตาม feature flag)
- webhook signature verification, event inbox/idempotency, accountLink/join/leave/follow/unfollow/postback
- notification outbox พร้อม retry/backoff/dedupe และ cron dispatcher
- admin page สำหรับ feature flags, linked accounts (disable/enable/unlink), group approval, message/webhook logs
- mapping กลุ่ม LINE กับ `shift_teams` และ `shift_shift_types` ผ่าน Admin settings เพื่อแยกประกาศขายเวรและ daily roster ตามห้อง/ประเภทเวร

## ขอบเขตสิทธิ์

- ห้าม browser ส่ง `lineUserId` เพื่อระบุตัวตน; server ใช้ LINE ID token ที่ verify กับ LINE
- ทุก mutation ใน MINI App ตรวจ session + CSRF + origin
- โทรศัพท์ไม่ถูกส่งจาก daily-roster API ของ MINI App; ใช้ได้เฉพาะ approved group ที่เปิด setting แยก
- กลุ่มใหม่เริ่ม `is_approved=false` และ `is_active=false`; ต้องให้ Admin อนุมัติก่อน
- LINE notification เป็น outbox side effect; LINE API ล่มจะไม่ rollback การเปลี่ยนเวร

## ข้อจำกัดที่ต้องทำก่อน production

1. รัน migration ใน `supabase/migrations/202609020002_line_integration.sql`, `202609030001_line_group_mapping.sql` และ `202609030002_project_management_permissions.sql` ผ่าน Supabase SQL Editor ตามลำดับ
2. ตั้ง environment variables ตาม `docs/LINE_SETUP.md`
3. ตั้ง LINE Provider/channel, LIFF URL, webhook URL และ rich menu ใน LINE Developers Console
4. เปิด feature flags ทีละตัวและทำ UAT ทั้งกรณีซ้ำ/ชนกัน/หมดอายุ
