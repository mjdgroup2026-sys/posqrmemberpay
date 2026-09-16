@AGENTS.md

# MJD Mobile Order — สมองของโปรเจกต์

ระบบคลังสินค้าเบิกจ่าย + ขายหน้าร้าน (Inventory + POS) ที่มี **2 ช่องทางขาย (channel) คู่ขนานกัน**:
POS หน้าร้าน (retail, `Sale.channel = RETAIL_POS`) กับ **MJD Mobile Order** (สั่งอาหารผ่าน QR Code สำหรับ
ร้านอาหารแบบ table service, `Sale.channel = MOBILE_ORDER`) ทั้งสองช่องทางปิดบิลเข้า `Sale`/`SaleItem` ชุดเดียวกัน
ไม่ใช่ระบบแยก — ดูหัวข้อ [MJD Mobile Order](#-mjd-mobile-order-phase-612) ท้ายไฟล์นี้

> ✅ **Phase 1–4, 2.5, 6–10 และ 12 เสร็จแล้ว** — คลังสินค้า, POS หน้าร้าน และ MJD Mobile Order ครบตั้งแต่
> ผังโต๊ะ · KDS · ทิกเก็ตครัวพิมพ์ผ่านเครื่องพิมพ์ PDF · ลูกค้าสแกน QR สั่งอาหารเอง · ชำระเงิน
> (พร้อมเพย์/บัตร) แล้วปิดบิลอัตโนมัติ · ตั้งค่าแบรนด์/ธีมร้าน · สมัครสมาชิกสะสมแต้ม ·
> เหลือ Phase 11 (LINE) และงานที่ต้องลงมือบน VPS ใน Phase 5 (ดู [สถานะการพัฒนา](#สถานะการพัฒนา))
>
> **dev server รันที่ port 3001** (`pnpm dev`) เพราะ container `pos-app` ของโปรเจกต์ POS_Shop เดิม
> ยึด 3000 อยู่ · `BETTER_AUTH_URL` ใน `.env` ต้องตรงกับ origin ที่ใช้จริงเสมอ ไม่งั้น Better Auth
> จะตอบ `INVALID_ORIGIN` ตอน sign-up/sign-in

**สัญญาอ้างอิงหลักคือ `Docs/spec.md`** — ทุกฟีเจอร์ ทุกกติกาธุรกิจ และ checklist ของแต่ละ Phase อยู่ในไฟล์นั้น
ทำงานเสร็จข้อไหนให้ติ๊ก checkbox ใน spec ด้วย

## ⏸️ งานที่ถูกกั้นไว้ — ห้ามเริ่มเอง

- ~~**Role-Based Permission** — นอกขอบเขต v1~~ → **ทำแล้ว**: matrix สิทธิ์ F1–F9 มาตั้งแต่ Phase 13 และ **Phase 16 (2026-09-16)
  ขยายครอบ MJD Mobile Order ครบ** (`MO_*`) — ดูกติกาข้อ 11 · บทบาทขั้นต่ำ `OWNER`/`STAFF` ต่อร้าน (`StoreMember.role`) เป็นคนละแกน
- **Phase 15b–15c (ตรวจสลิป / SCB ต่อร้าน)** — รอเจ้าของระบบเลือก provider/credential ก่อน ห้ามเริ่มเอง
- **Phase 14–16** — ร่างไว้ใน `Docs/spec.md` §8 แล้ว (2026-09-14)
  · **Phase 13 (multi-tenant) merge + migrate production แล้ว 2026-09-15** (PR #1) · **Phase 14 แบ่งเป็น 3 PR:
  14a Onboarding (production แล้ว 2026-09-15, PR #2) → 14b Subscription (production แล้ว 2026-09-15, PR #3) →
  14c Brand (production แล้ว 2026-09-16, PR #4)** — **Phase 14 ปิดครบทั้งสามก้อนแล้ว**
  — ต้องทำตามลำดับ ห้ามข้าม และ migration ที่แตะข้อมูลจริงต้อง `pg_dump` + ซ้อมบนสำเนาก่อนเสมอเหมือนที่ทำกับ Phase 13

## 📧 ระบบอีเมล (ต่อ Resend แล้วใน Phase 5)

ฟังก์ชันส่งอีเมลต้องอยู่ที่ **`lib/mail.ts`** ที่เดียว (`sendVerificationMail` / `sendResetPasswordMail` / `sendStoreInviteMail`)
ส่งผ่าน Resend HTTP API ด้วย `fetch` — ไม่เพิ่ม dependency · `lib/auth.ts` เป็นแค่ผู้เรียก

| env | ค่า |
|---|---|
| `RESEND_API_KEY` | key จาก resend.com — **เว้นว่าง = dev พิมพ์ลิงก์ลง console, production throw** |
| `MAIL_FROM` | ต้องอยู่ใต้โดเมนที่ verify ไว้: `MJD Mobile Order <no-reply@mail.jayjayservices.com>` |
| `MAIL_REPLY_TO` | ไม่บังคับ |
| `PLATFORM_PROMPTPAY_ID` | พร้อมเพย์ของ "แพลตฟอร์ม" ที่ร้านโอนค่าใช้งานเข้า (Phase 14b) — **คนละเรื่องกับเลขพร้อมเพย์รับเงินลูกค้าของร้าน ซึ่งตั้งแต่ Phase 15a อยู่ในฐานข้อมูล (`StorePaymentConfig`) ไม่ใช่ env** (env `PROMPTPAY_ID` เดิมถอดออกแล้ว) · เว้นว่าง = หน้า `/billing` ไม่มี QR ให้สแกน |
| `CRON_SECRET` | secret ใน path `GET /api/cron/plan-expiry/<secret>` ที่ `ops/plan-expiry-cron.sh` ยิงวันละครั้ง (09:10) ส่งอีเมลเตือน 7/3/1 วัน · ≥ 16 ตัว · เว้นว่าง = 401 (แบนเนอร์ในแอปยังขึ้น) |
| `SIGNUP_OPEN` | `true` = ใครก็สมัครได้ (Phase 14a) · ไม่ตั้ง = allowlist `SIGNUP_ALLOWED_*` เดิม / ปิดสมัคร (fail closed) — **production ต้องตั้งเป็น `true` ตอน deploy 14a** · 🔥 **env ใหม่ทุกตัวต้องประกาศใน `environment:` ของ `docker-compose.prod.yml` ด้วย** ตั้งใน `.env` บน VPS อย่างเดียวไม่ถึงคอนเทนเนอร์ (compose ไม่ใช้ `env_file`) |

- **ห้ามพิมพ์ลิงก์ยืนยัน/รีเซ็ตรหัสผ่านลง log บน production** — ลิงก์คือ credential ชั่วคราว
- อีเมลใช้ **inline style + สี hex ดิบ** โดยตั้งใจ (mail client ไม่รองรับ `var()`) เป็นข้อยกเว้นเดียวของกติกาสี
- สมัครสมาชิกแล้ว **ต้องยืนยันอีเมลก่อนถึงล็อกอินได้** (`requireEmailVerification: true` — เปิดแล้ว) —
  ล็อกอินก่อนยืนยันได้ 403 code `EMAIL_NOT_VERIFIED` ซึ่งหน้า `/login` ดักไว้แล้วพร้อมปุ่มส่งอีเมลซ้ำ
- ปลายทางหลังกดลิงก์ในอีเมลคือหน้า `/verify-email` (public path ใน `proxy.ts` แล้ว) —
  `lib/auth.ts` เขียนทับ `callbackURL` ของ Better Auth ให้ชี้มาหน้านี้ ไม่งั้นผู้ใช้ถูกโยนไปหน้าแรก
  แล้วเดาเองว่ายืนยันสำเร็จหรือไม่
- ฟังก์ชันส่งอีเมลคืน `MailResult` ไม่ throw — ส่งไม่สำเร็จให้ log ไว้ ห้ามทำให้คำขอของผู้ใช้ล้มทั้งก้อน

## กติกาที่ห้ามละเมิด

1. **ห้ามใส่ semicolon** ในไฟล์ TypeScript/JavaScript ทุกไฟล์ (ยกเว้นโค้ดที่ generate เอง เช่น `generated/prisma/**`,
   `next-env.d.ts`) — ตรวจด้วย `/check`
2. **ทุกการเปลี่ยนยอดสต็อกต้องผ่าน `StockTransaction`** และเขียนใน `prisma.$transaction` เดียวกันกับการอัปเดต
   `product.quantity` เสมอ ห้ามแก้ `quantity` ตรง ๆ จากที่อื่น (รวมถึงฟอร์มแก้ไขสินค้า)
3. **`StockTransaction` เป็น ledger แบบ append-only** — ไม่ลบ ไม่แก้ย้อนหลัง ถ้าต้องกลับรายการให้สร้างรายการชดเชยใหม่
4. **กันเบิก/ขายเกินสต็อกด้วย `updateMany` + `where: { quantity: { gte: n } }`** ไม่ใช่แค่ `if` ก่อนหน้า —
   เป็นด่านเดียวที่กัน race condition ได้จริงตอนมีคำขอพร้อมกัน · ต้องมีเทส concurrent พิสูจน์ (เช่น ยิงพร้อมกัน
   10 คำขอจากสต็อก 8 → ต้องผ่านแค่ 4 และยอดต้องไม่ติดลบ)
5. **ทุก Server Action ที่แตะข้อมูลต้องเรียก `requireStore()` เป็นบรรทัดแรก** (Phase 13 — เดิม `requireUser()`
   ซึ่งเหลือใช้เฉพาะข้อมูลของตัวผู้ใช้ เช่น โปรไฟล์) — ห้ามพึ่ง UI ที่ซ่อนปุ่มอย่างเดียว เพราะ Server Action ถูกเรียกตรงได้
   · แล้วทุก query ต้องผ่าน `forStore(storeId)` จาก `lib/db.ts` ไม่ใช่ `prisma` ตรง ๆ (ESLint บังคับใน
   `app/actions/**` และ `lib/queries.ts`) · **raw SQL ต้องเติม `WHERE "storeId" = ${storeId}` เอง** เพราะ
   extension ช่วยไม่ได้ · `findUnique` ด้วย id จากผู้ใช้ปลอดภัยเพราะ extension ยัด storeId เข้า where ให้ —
   แต่ **FK ที่รับจากฟอร์ม (เช่น `categoryId`) ต้องเช็คเองว่าเป็นของร้านนี้** (เทส `tenant-isolation` เคยจับได้)
   · เพิ่ม query/action ใหม่ต้องเพิ่มในตารางของ `__tests__/integration/tenant-isolation.test.ts` ไม่งั้นเทสแดง
   · **การค้นข้ามร้านทำได้ 4 ที่เท่านั้น** (Phase 13–14c): `lib/store-resolve.ts` (หาร้านจากค่าที่เดินทางออกนอกระบบ —
   qrToken / ref1 / invite token / อีเมลของตัวผู้ใช้), `lib/admin-queries.ts` (ชั้นอ่านของผู้ดูแลแพลตฟอร์ม
   ต้องผ่าน `requirePlatformAdmin()` ก่อนเสมอ อ่านอย่างเดียว), `lib/plan-queries.ts` (แพ็กเกจ = ข้อมูลอ้างอิงของ
   แพลตฟอร์ม ไม่มี storeId) และ `lib/brand-queries.ts` + `app/actions/brand.ts` (Phase 14c — ขอบเขต tenant คือ
   `brand.ownerId = userId` ทุกฟังก์ชันรับ userId แล้วกรองเงื่อนไขนี้ ไม่รับ brandId จากผู้ใช้) — ที่อื่นห้าม
   · `TrialClaim` ตั้งใจไม่ scoped (กันใช้สิทธิ์ทดลองซ้ำข้ามร้าน)
   · **(Phase 14c) ตรรกะ "ผู้ใช้เข้าร้านไหนได้ในบทบาทอะไร" อยู่ที่ `lib/store-context.ts` (`loadStoreContext()`) ที่เดียว**
   — `lib/session.ts` และ mock ของเทส (`__tests__/helpers/session-mock.ts`) เรียกตัวเดียวกัน ห้ามลอกตรรกะไปเขียนซ้ำ
   · เจ้าของ `Brand` = OWNER ของทุก `Store` ใต้แบรนด์โดยอัตโนมัติแม้ไม่มีแถว `StoreMember` (`viaBrand`) ·
   `switchActiveStore` ก็ใช้ `loadStoreContext()` ตรวจ ไม่ใช่ `StoreMember` ตรง ๆ
   · **(Phase 14b) action ที่ "ขายใหม่" ต้องผ่าน `requireSellingStore()`** (หรือ `guardAction(..., { selling: true })` สำหรับ POS)
   ไม่ใช่ `requireStore()` — แพ็กเกจหมดอายุ = อ่านได้ ขายไม่ได้ (`STORE_EXPIRED`) · ที่ใช้อยู่: `createSale`, `openTableSession`
   ทั้งสองทาง, `submitOrder` · ห้ามใส่กับปิดบิล/void/รายงาน
6. **ข้อความที่ผู้ใช้เห็นเป็นภาษาไทยทั้งหมด** รวมถึงข้อความ validation และ error
7. **(Phase 6+, MJD Mobile Order) เปลี่ยน `MobileOrderItem.status` ต้องเป็น conditional update**
   (`updateMany` + `where: { status: 'AWAITING_KITCHEN' }`) เหมือนกติกากันขายเกินสต็อกในข้อ 4 — ป้องกัน race
   ระหว่างพนักงานกดยกเลิกรายการกับครัวกด "เริ่มทำ" พร้อมกัน ห้ามใช้ read-then-write ธรรมดา
9. **(Phase 14b) `StoreSubscription` และ `SubscriptionPlan` เป็น ledger append-only** เหมือน `StockTransaction` —
   · **(Phase 14c) ใบจ่ายรวม `SubscriptionBatch`**: แถว `StoreSubscription` ที่มี `batchId` ยืนยัน/ยกเลิก**ทั้งใบเท่านั้น**
   (`confirmSubscriptionBatch`/`voidSubscriptionBatch`/`cancelBrandBatch`) — `confirmSubscription`/`voidSubscription`/
   `cancelPendingRequest` ปฏิเสธแถวที่มี `batchId` · เลขอ้างอิงธนาคารอยู่ที่หัวใบ (`SubscriptionBatch.paymentReference` unique)
   แถวลูกเป็น null โดยตั้งใจ · ยืนยัน = `updateMany where status: PENDING` ที่หัวใบ + นับแถวลูกที่ปิดได้ต้องเท่ากับจำนวนแถว
   ไม่งั้น throw → rollback ทั้งใบ (มีเทส concurrent) · ใบที่ PAID แล้วถอย**รายสาขา**ผ่าน `voidSubscription` ตามปกติ
   ถอยรายการ PAID = สร้างแถว VOID ชดเชย (ตัวเลขติดลบ, `reversesId`) ไม่แก้แถวเดิม · แก้ราคาแพ็กเกจ = version ใหม่
   (`supersededById`) ห้าม UPDATE · `Store.planTier/tableLimit/planExpiresAt` เป็นค่า denormalized ที่**ต้องอัปเดตใน
   ทรานแซคชันเดียวกับแถว PAID เสมอ** · ยืนยันจ่ายด้วย `updateMany where status: PENDING` และเพดานโต๊ะนับใต้
   `pg_advisory_xact_lock(720_002, hashtext(storeId))` (`lib/table-limit.ts`) — ทั้งคู่มีเทส concurrent
10. **(Phase 15a) วิธีรับเงินจากลูกค้าเป็น "ของร้าน"** — อ่านจาก `Store.paymentMode` + `StorePaymentConfig` ผ่าน
   `getStorePaymentProfile(storeId)` ใน `lib/payment-methods.ts` **เท่านั้น** (`qrAvailable` = โชว์ปุ่ม QR ได้ไหม ·
   `autoSettle` = ธนาคารปิดบิลให้เอง) · ห้ามเช็ค `isScbConfigured()`/เลขพร้อมเพย์ตรง ๆ ในหน้าใด · `buildPromptPayPayload()`
   ต้องได้เลขผู้รับเป็นพารามิเตอร์เสมอ ไม่มี default จาก env — ก่อน 15a ทุกร้านออก QR ของร้าน `default` (ลูกค้าร้านอื่น
   จ่ายเข้าบัญชีผิดร้าน) · โหมด `SCB_BILLER` ตั้งได้เฉพาะผู้ดูแลแพลตฟอร์ม (`setStorePaymentMode`) จนกว่า 15c จะย้าย credential
   เป็นต่อร้าน · `PROMPTPAY_SLIP` เลือกไม่ได้จนกว่า 15b
11. **(Phase 16) หน้า/action ของ MJD Mobile Order อยู่ใต้ matrix สิทธิ์แล้ว** — resource `MO_TABLES` (ผังโต๊ะ/รายละเอียด/ปิดบิล ·
   ADD เปิด/รวมโต๊ะ · EDIT ปิดบิล/ยืนยันชำระ/เสิร์ฟด้วยมือ · DELETE ยกเลิกโต๊ะ/รายการ), `MO_KITCHEN` (EDIT = เริ่มทำ/เสร็จ/เสิร์ฟ),
   `MO_NOTIFICATIONS` (EDIT = รับทราบ), `MO_MENU`, `MO_SETUP` (จัดการโต๊ะ + QR) · action ใช้ `requireStoreAccess([res, act], …)`
   จาก `lib/permissions.ts` แทน `requireStore()` (คืน `StoreContext` เดิม · หลายคู่ = ผ่านคู่ใดคู่หนึ่ง เช่น กดเสิร์ฟได้ทั้งจาก KDS
   และหน้าโต๊ะ) · หน้าใช้ `requirePageAccess("MO_X")` · `PermissionDenied` ย้ายไป `lib/store-errors.ts` และ `storeErrorMessage()`
   รู้จักแล้ว จึงไม่ต้องแก้ catch เดิม · ตั้งค่าร้าน (`/mobile-order/settings`) ยังเป็น OWNER-only ไม่ใช่ resource ·
   **preset ที่ 4 "พนักงานเสิร์ฟ"** (MO เต็ม ยกเว้นเมนู/โต๊ะ+QR ดูอย่างเดียว · ไม่เห็นคลัง/POS) — migration backfill ผูกให้ STAFF
   ที่ `roleId = null` ทุกคนตอน deploy เพราะเดิมคนกลุ่มนี้เข้าได้แค่หน้า Mobile Order อยู่แล้ว (สิทธิ์เท่าเดิมพอดี) · บทบาทเดิมทุกตัว
   ได้ MO เต็ม ยกเว้น "แคชเชียร์" ได้ระดับพนักงานเสิร์ฟ+ · ⚠️ `ALTER TYPE … ADD VALUE` ต้องแยกไฟล์ migration จากที่ใช้ค่าใหม่
   (PostgreSQL ห้ามใช้ในทรานแซคชันเดียวกัน) · ⚠️ `full` เป็น reserved word ใน SQL — เคยทำ migration พังแล้ว `migrate resolve --applied`
   ทับไปทั้งที่ยังไม่ได้รัน ต้องดูผลจริงก่อน resolve เสมอ (ตรงกับกับดักใน CLAUDE.md)
8. **(Phase 6+) บิลจาก MJD Mobile Order ต้องออกเป็น `Sale` ปกติเสมอ** (`channel = MOBILE_ORDER` +
   `tableSessionId`) ห้ามสร้างตารางบิลแยก เพื่อให้ Dashboard/Reports/`/pos/history`/`CashierClosing` ใช้ query
   เดิมได้ครบโดยไม่ต้องเขียน logic ซ้ำ

## คำสั่งที่ใช้บ่อย

script เหล่านี้ต้องตั้งใน `package.json` ตั้งแต่ Phase 1 (ยังไม่มีจนกว่าจะสร้างโปรเจกต์)

| คำสั่ง | ทำอะไร |
|---|---|
| `pnpm lint` | ESLint (flat config; Next.js 16 ไม่มี `next lint` แล้ว) |
| `npx tsc --noEmit` | typecheck (ถ้าฟ้อง `LayoutProps`/`PageProps` ไม่รู้จัก ให้รัน `npx next typegen` ก่อน) |
| `pnpm db:seed` | seed ข้อมูลตัวอย่าง SKU-1001…SKU-1007 + บิลขายตัวอย่าง 8 บิล (ต้องมีผู้ใช้ในระบบก่อน) |
| `pnpm db:create-user "อีเมล" "รหัสผ่าน" "ชื่อ" [--store slug] [--role OWNER|STAFF]` | สร้างบัญชีพนักงานจากบรรทัดคำสั่ง (ข้ามการยืนยันอีเมล) — ปกติให้ผู้ใช้สมัครเองผ่าน `/register` เมื่อตั้ง `SIGNUP_OPEN=true` (Phase 14a) |
| `pnpm db:set-platform-admin "อีเมล" [--off]` | ตั้ง/ถอดผู้ดูแลแพลตฟอร์ม (`User.isPlatformAdmin`) — เห็นเมนู "แพลตฟอร์ม" + `/admin/stores` · ไม่มี UI ตั้งโดยตั้งใจ |
| `pnpm db:generate` | generate Prisma Client (ต้อง **รีสตาร์ต dev server** หลังรันเสมอ) |

## การทดสอบ

`pnpm test` รัน Vitest 4 — integration test ยิงลง PostgreSQL จริง (ฐาน **`posmobileorderdb_test`**
แยกจาก dev) · `pnpm test:watch` โหมด watch · `pnpm test:unit` / `pnpm test:integration` รันแยกกลุ่ม

Server Action ทดสอบได้โดย mock `next/cache` + `@/lib/session` แล้ว `await import()` action ตัวจริง
(`'use server'` เป็นแค่ string literal เมื่อรันใน vitest) — แม่แบบของไฟล์อื่นคือ
**`__tests__/integration/stock-out.test.ts`**

โครงไฟล์เทส (โฟลเดอร์ **`__tests__/`** ไม่ใช่ `tests/`):

```
__tests__/
├── setup.ts · stubs/server-only.ts · helpers/{db,form}.ts
├── unit/         — mock Prisma ด้วย vitest-mock-extended ไม่แตะ DB
├── integration/  — ยิง posmobileorderdb_test จริง
└── components/   — @testing-library/react (ใส่ docblock `// @vitest-environment jsdom` บรรทัดแรก)
```

- ต้อง alias `server-only` เป็นโมดูลว่างใน `vitest.config.mts` — Action ที่ดึง `lib/queries.ts` จะได้
  import ได้เลย **ไม่ต้อง `vi.mock('server-only')` รายไฟล์**
- **Vitest 4 ตัด `environmentMatchGlobs` ออกแล้ว** — ตั้ง `environment: "node"` เป็นค่าเริ่มต้น
  แล้วใช้ docblock `// @vitest-environment jsdom` ในไฟล์เทส component แทน
- `fileParallelism: false` เพราะ integration test ใช้ฐานเดียวกันแล้ว `TRUNCATE` ชนกัน
- `Sale.cashierId` เป็น FK ไปตาราง `user` — เทสต้อง `upsert` ผู้ใช้ทดสอบก่อนขาย
- ฐานทดสอบยังไม่มีหรือยังไม่ migrate → `pnpm db:test:migrate` (อ่าน `DATABASE_URL` จาก `.env.test`)
  ต้องสร้างฐานก่อนด้วย:
  ```bash
  docker exec posmobileorder-postgres psql -U posmobileorderuser -d postgres \
    -c "CREATE DATABASE posmobileorderdb_test;"
  ```
- `__tests__/helpers/db.ts` มี `assertTestDatabase()` ที่ throw ถ้าชื่อฐานไม่ลงท้าย `_test` —
  กันเทส `TRUNCATE` ฐาน dev ทิ้ง **ห้ามถอดออก**
- กติกาที่แตะ **สต็อกและเงิน** ต้องมีเทสครอบทุกข้อ (โดยเฉพาะ concurrent ตามกติกาข้อ 4 และข้อ 7)

## โครงสร้างโปรเจกต์ (เป้าหมายที่ต้องสร้าง)

components/icons.tsx — re-export ไอคอนจาก lucide-react ทั้งชุด เพิ่ม/เปลี่ยนที่นี่ที่เดียว
                       (หน้าอื่นห้าม import จาก lucide-react ตรง ๆ)
components/ui/ — shadcn/ui อย่าแก้มือ ใช้ `pnpm dlx shadcn@latest add <ชื่อ>`
app/globals.css — design system ทั้งหมด (tokens + component classes)
lib/queries.ts — ฟังก์ชันอ่านข้อมูลทั้งหมด (`import 'server-only'`)
proxy.ts — guard ชั้นแรก (Next.js 16 เปลี่ยนชื่อจาก middleware → proxy)
mobile-order.html — ต้นฉบับดีไซน์ 24 อาร์ตบอร์ด (ลูกค้า / พนักงาน-POS / ครัว / ผังระบบ) **มีอยู่จริงแล้ว**
Docs/spec.md — สัญญาอ้างอิงหลัก **มีอยู่จริงแล้ว**

## Design system

**ใช้ class ที่มีอยู่ก่อนเขียน Tailwind utility เอง** — รวม design token ทั้งหมดไว้ที่ `app/globals.css` ที่เดียว

ชุด class ด้านล่างเป็นมาตรฐานที่ยกมาจาก StockApp เดิม ให้สร้างขึ้นใน `app/globals.css` ตั้งแต่ Phase 1
(ถ้ามีไฟล์ `Design/tokens.css` ต้นฉบับ ให้พอร์ตมาแบบ 1:1):

- โครงหน้า: `.app-shell` `.sidebar` `.topbar` `.content` `.page-head` `.breadcrumb` `.row`
- กล่อง: `.card-ui` (ชื่อนี้ ไม่ใช่ `.card` เพราะเลี่ยงชนกับ shadcn) `.card-pad` `.stat-tile` `.panel-head` `.datatable-wrap`
- ฟอร์ม: `.field` `.field-grid` `.input` `.select` `.field-hint.error` `.checkbox-row`
- ปุ่ม: `.btn` + `.btn-primary|ghost|subtle|gold|danger|danger-solid` + `.btn-sm|lg|icon|block`
- สถานะ: `.chip.chip-success|warning|danger|neutral|info|teal` (ต้องมี `<span className="dot" />` ข้างใน)
- ตัวอักษร: `.t-h1` `.t-h2` `.t-h3` `.t-body` `.t-small` `.t-caption` `.t-eyebrow` · ตัวเลขใส่ `.num` ให้เรียงหลักตรงกัน
- แจ้งเตือน: `.alert-banner.danger|info|warning`

> ตอนพอร์ตเข้ามา ให้เปลี่ยน variant ที่ตั้งชื่อตามสี (`.chip-teal`, `.btn-gold`) เป็นชื่อเชิงความหมาย
> (`.chip-brand`, `.btn-accent`) และให้ map ไป `var(--brand)` — มิฉะนั้นพอใช้ในธีม `customer` จะได้สี teal
> โผล่กลางหน้าสีส้ม (ดูกติกาข้อ 2 ใต้หัวข้อธีม)

### ธีม: แยก token 2 ชุดตาม route group

โปรเจกต์นี้มี **2 พื้นผิว (surface) ที่ธีมคนละชุดกัน** — ตัดสินใจแล้วว่า**แยก token 2 ชุด** ไม่ยุบเป็นธีมเดียว:

| | ฝั่งพนักงาน/หลังบ้าน | ฝั่งลูกค้า |
|---|---|---|
| Route group | `app/(staff)/…` → `/pos/*`, `/products`, `/mobile-order/*`, KDS | `app/(customer)/…` → `/order/[qrToken]/*` |
| `data-theme` | `staff` | `customer` |
| สีแบรนด์ | teal `#01787B` | ส้ม `#E8571F` บนพื้นครีม `#FBF8F5` |
| ฟอนต์ | Inter + Anuphan (ไทย) + JetBrains Mono | Prompt (หัวเรื่อง) + Sarabun (เนื้อความ) |
| ต้นฉบับดีไซน์ | `Design/` เดิมของ StockApp | `mobile-order.html` (13 อาร์ตบอร์ดฝั่งลูกค้า) |
| ร้านเปลี่ยนสีเองได้ | ❌ | ✅ ผ่าน `StoreSettings.themeColor` (F21) |

**กติกาที่ต้องทำตาม:**

1. **`(staff)` และ `(customer)` เป็น root layout แยกกัน** (ไม่มี `app/layout.tsx` กลาง) — แต่ละกลุ่ม render
   `<html lang="th">`/`<body data-theme="…">` ของตัวเอง และโหลด**เฉพาะฟอนต์ของธีมตัวเอง** ไม่ให้หน้าลูกค้า
   ต้องดาวน์โหลดฟอนต์ฝั่งพนักงานทิ้งเปล่า ๆ (หน้าลูกค้าเปิดบนเน็ตมือถือ ทุก KB มีผล)
2. **ชื่อ token ต้องเป็น semantic ไม่ใช่ชื่อสี** — ใช้ `var(--brand)`, `var(--brand-ink)`, `var(--surface)`,
   `var(--ink)`, `var(--line)` · **ห้ามอ้าง `var(--teal-600)` ตรง ๆ ใน component class** เพราะ class ชุดเดียวกัน
   (`.btn`, `.card-ui`, `.chip`, …) ต้องใช้ได้ทั้งสองธีมโดยไม่แก้โค้ด
3. **`app/globals.css` เก็บทั้งสองชุดในไฟล์เดียว** — token เชิงโครงสร้าง (spacing, radius, shadow, สเกลฟอนต์)
   อยู่ใน `:root` ใช้ร่วมกัน · **เฉพาะสีกับ font-family เท่านั้นที่แยก** ใต้ `[data-theme="staff"]` และ
   `[data-theme="customer"]`
4. **สีของร้าน override ตอน runtime**: `(customer)/layout.tsx` อ่าน `StoreSettings.themeColor` แล้วเซ็ต
   `style={{ '--brand': themeColor }}` บน `<body>` — inline style ชนะ selector `[data-theme]` เสมอ
   จึงไม่ต้อง generate CSS ใหม่ต่อร้าน
5. ห้ามใส่ hex ดิบในโค้ด (ข้อยกเว้นเดียวคือเทมเพลตอีเมล ดู
   [§ระบบอีเมล](#-ระบบอีเมล-ข้อกำหนด--ทำใน-phase-5))

> ⚠️ **กับดัก**: root layout แยกกันแปลว่า**ไม่มี state/provider ที่แชร์ข้ามสองกลุ่มได้** และการนำทางข้ามกลุ่ม
> จะเป็น full page load ไม่ใช่ client-side navigation — ยอมรับได้เพราะลูกค้ากับพนักงานไม่เคยสลับหน้ากันอยู่แล้ว
> แต่ **component ที่ใช้ร่วมกันต้องไม่ผูกกับ provider ของกลุ่มใดกลุ่มหนึ่ง**

## Pattern ที่ใช้ทั้งโปรเจกต์

**Server Action** — คืน `ActionResult` เสมอ ไม่ throw ให้ผู้ใช้เห็น:

```ts
export async function doThing(formData: FormData): Promise<ActionResult> {
  try {
    await requireUser()
  } catch {
    return { ok: false, error: 'กรุณาเข้าสู่ระบบก่อนทำรายการ' }
  }

  const parsed = schema.safeParse({ /* … */ })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  // … เขียน DB …
  revalidatePath('/…')
  return { ok: true, message: 'บันทึกเรียบร้อยแล้ว' }
}
```

**ฝั่ง client** — `const result = await action(formData)` → เช็ค `result.ok` → `toast.success/error(...)` →
`router.refresh()` และเก็บ `result.fieldErrors` ลง state เพื่อแสดงใต้ช่องกรอก

**Decimal** — Prisma คืนค่าเป็น object แปลงด้วย `toNumber()` จาก `lib/format.ts` ก่อนส่งเข้า Client Component เสมอ
ตอนเขียนลง DB ส่งเป็น string ผ่าน `value.toFixed(2)`

## กับดักที่ต้องระวัง

ข้อที่มี 🔥 คือ **เจอจริงในโปรเจกต์นี้แล้ว** ที่เหลือยกมาจากโปรเจกต์ StockApp เดิม — จะเจอแน่ถ้าไม่ระวัง

- **หลัง `prisma generate` ต้องรีสตาร์ต dev server** ไม่งั้น Turbopack ใช้ module graph เก่า แล้วการเขียน DB
  "สำเร็จ" (HTTP 200) โดยไม่มีแถวถูกบันทึกจริง
- **Better Auth 1.7 มีฟิลด์ `account.issuer`** (`String`, required, unique ร่วมกับ `accountId`) ที่ `@better-auth/cli generate`
  รุ่นเก่ายัง generate ไม่ครบ — ถ้าเพิ่ม plugin แล้ว schema เพี้ยน ให้เทียบกับ
  `node_modules/.pnpm/@better-auth+core@*/node_modules/@better-auth/core/dist/db/get-tables.mjs` เป็นแหล่งจริง
- **`prisma migrate dev` ล้มเมื่อ non-interactive** ถ้ามี warning (เช่น เพิ่ม unique constraint) — ใช้ทางเลี่ยงใน `/migration`
- 🔥 **เพิ่ม/แก้ `@@map` = Prisma สั่ง DROP ตารางทิ้ง ข้อมูลหายหมด** — Prisma **ไม่รู้จักการ rename**
  มันเห็นเป็น "ตารางเก่าหาย + ตารางใหม่โผล่" เลยสร้าง migration เป็น `DROP TABLE` + `CREATE TABLE`
  (ตอนเพิ่ม `@@map("product")` มันเตือนว่า *"about to drop the `Product` table, which is not empty (7 rows)"*)
  → **ห้ามปล่อยให้ Prisma generate migration เอง** ให้เขียน `migration.sql` เองเป็น `ALTER TABLE ... RENAME TO ...`
  แล้วอย่าลืม rename **index / primary key / foreign key / not-null constraint** ให้ครบด้วย มิฉะนั้นชื่อจะไม่ตรง
  กับที่ Prisma คาดหวังแล้วเกิด drift · ขั้นตอนที่ใช้ได้จริง:
  1. `mkdir prisma/migrations/<timestamp>_<name>/` แล้วเขียน `migration.sql` เอง
  2. รันด้วย `docker exec -i <container> psql -U <user> -d <db> -v ON_ERROR_STOP=1 --single-transaction < migration.sql`
  3. `prisma migrate resolve --applied <timestamp>_<name>`
  4. **ยืนยันเสมอ** ด้วย `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
     ต้องได้ `No difference detected.`
  > ⚠️ **`prisma db execute --file ... --schema ...` เงียบ ๆ ไม่ทำงาน** — มันพ่นหน้า help ออกมาแทนแล้ว exit 0
  > ถ้าเผลอสั่ง `migrate resolve --applied` ต่อ จะได้สถานะพังคือ migration ถูกบันทึกว่า applied ทั้งที่ SQL
  > ยังไม่ได้รันเลย **ต้องเช็ค `\dt` ในฐานจริงทุกครั้งก่อน resolve**
- 🔥 **`$queryRaw` ไม่ผ่าน `@@map`** — ชื่อตารางใน raw SQL ต้องเป็น**ชื่อจริงในฐาน** (snake_case) ไม่ใช่ชื่อ model
  เช่น `FROM "product"` ไม่ใช่ `FROM "Product"` · อันตรายเพราะ SQL เป็น string → **`tsc` กับ `pnpm build` ผ่านฉลุย
  แต่พังตอน runtime** ทุกครั้งที่เปลี่ยน `@@map` ต้องไล่แก้ raw SQL ให้ครบด้วย:
  ```bash
  grep -rn '\$queryRaw\|\$executeRaw' --include='*.ts' . --exclude-dir=node_modules --exclude-dir=generated
  ```
  ปัจจุบันมี raw SQL อยู่ที่ `lib/queries.ts` (8 จุด), `app/actions/products.ts` (1 จุด — `nextSku()`),
  `lib/sale-number.ts` (2 จุด — advisory lock ต่อร้าน + `nextSaleNumber()` ใช้ร่วมกันทั้ง POS/Mobile Order)
  และ `lib/table-limit.ts` (1 จุด — advisory lock เพดานโต๊ะ namespace 720_002, Phase 14b)
  · ทุกจุดต้องมี `WHERE "storeId" = ${storeId}` (Phase 13)
- **Client Component ที่ใช้ `useSearchParams()` ต้องมี `<Suspense>` ครอบ** ถ้าหน้านั้นถูก prerender แบบ static
  (หน้า auth ทั้งหมดเข้าข่าย) ไม่งั้น `pnpm build` จะพัง
- **Next.js 16** `params`/`searchParams`/`cookies()`/`headers()` เป็น Promise ต้อง `await` ทุกครั้ง
- **รหัสผ่าน PostgreSQL ห้ามมี `/` `:` `@` `#` `?`** — `docker-compose.prod.yml` เสียบ `POSTGRES_PASSWORD`
  ลง connection string ตรง ๆ รหัสผ่าน base64 ที่มี `/` ทำให้ `@prisma/adapter-pg` ฟ้อง `Invalid URL`
  แล้วแอป **ต่อ DB ไม่ได้ทั้งระบบ** (health 503, migration ไม่เคยรัน, DB ว่างไม่มีตาราง) —
  ใช้ base64url แทน: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`
- **`NEXT_PUBLIC_*` ถูก inline ตอน `next build` เท่านั้น** — ตั้งใน compose ตอน runtime ไม่มีผลกับ bundle
  ฝั่งเบราว์เซอร์ ถ้า CI build โดยไม่ส่ง `--build-arg` ค่า default จะติดไปกับ image (เคยทำให้หน้าเว็บ
  production ยิง auth ไป `http://localhost:3000`) — กันด้วยการ**ไม่ตั้ง `baseURL` ใน `lib/auth-client.ts`**
  (ใช้ path สัมพัทธ์ `/api/auth`) และให้ CI ส่ง build-arg ให้ครบ
- 🔥 **เลขที่บิลแบบ max+1 เฉย ๆ ชนกันจริงตอนขายพร้อมกัน** — ทดสอบยิง checkout 8 บิลพร้อมกันแล้วผ่านแค่ 5
  (อีก 3 ตายที่ unique `saleNumber` จนหมด retry) · ทางแก้ที่ใช้จริงคือจับ `pg_advisory_xact_lock` ก่อนอ่าน max
  ใน `nextSaleNumber()` ของ `app/actions/sales.ts` — lock ปล่อยเองตอน commit จึงได้เลขเรียงต่อเนื่องไม่มีช่องว่าง
- 🔥 **Prisma deserialize คอลัมน์ชนิด `void` ไม่ได้** — `SELECT pg_advisory_xact_lock(...)` ตรง ๆ พังด้วย
  `UnsupportedNativeDataType` ต้อง cast เป็น text: `SELECT pg_advisory_xact_lock(${key}::bigint)::text`
- 🔥 **บัญชี credential ของ Better Auth ใช้ `accountId = user.id` และ `issuer = local:credential`**
  (ไม่ใช่อีเมล) — insert ตาราง `account` เองด้วยอีเมลจะสร้างได้แต่ล็อกอินไม่ผ่าน ตอบ `INVALID_EMAIL_OR_PASSWORD`
  เงียบ ๆ · สร้างบัญชีด้วย `pnpm db:create-user` ที่เรียก `internalAdapter` ของ Better Auth เท่านั้น
- 🔥 **`docker compose --profile X pull` ดึงเฉพาะ service ที่อยู่ใน profile ที่เปิดไว้เท่านั้น** —
  พอแยกแอปเป็น `app-blue`/`app-green` ใต้ profile ของตัวเอง คำสั่งเดิม `--profile tools pull`
  เลยได้แค่ `db` กับ `migrate` ส่วน image ของแอปไม่เคยถูกดึง · ผลคือ deploy "สำเร็จ" ทุกขั้น
  migration ขึ้นครบ health ตอบ 200 แต่แอปรัน **โค้ดเก่าทับ schema ใหม่** → 500 ทุกหน้าที่แตะฐาน
  และ 404 ทุก route ใหม่ · `/api/health` แค่ ping ฐานจึงรอดด่านนี้ไปได้ **ต้องล็อกอินเข้าไปกดจริง
  ถึงจะเจอ** · แก้แล้วสองชั้น: CI ระบุ profile ครบทุกตัว และ `switch-deploy.sh` ดึง image
  ของสีเป้าหมายเองก่อนสตาร์ตเสมอ (step 0/6)
- **image `:latest-migrate` ต้อง build จาก stage `migrator` เท่านั้น** — stage `deps` ไม่มี `prisma/`
  ทำให้ `prisma migrate deploy` ฟ้อง "Could not find Prisma Schema" แล้ว deploy "สำเร็จ" ทั้งที่ DB ไม่มีตาราง
- 🔥 **หน้าที่ prerender ไว้ถูกแคชข้ามรอบ deploy จนผู้ใช้เปิดเว็บไม่ขึ้น** — ค่าเริ่มต้นของ Next.js
  ส่งหน้า static มาพร้อม `Cache-Control: s-maxage=31536000` (สั่ง shared cache ของ ISP/CDN เก็บไว้ 1 ปี)
  แต่ทุกครั้งที่ build ใหม่ Next.js **เปลี่ยนชื่อไฟล์ chunk ทั้งชุด** และของเก่าหายไปพร้อมคอนเทนเนอร์เดิม
  เบราว์เซอร์ที่ยังถือ HTML เก่าจึงไปขอ chunk ที่ 404 ไปแล้ว → **หน้าขาว ทั้งที่เซิร์ฟเวอร์ปกติทุกอย่าง**
  (nginx/คอนเทนเนอร์ healthy, `/api/health` 200, ใบรับรอง TLS ไม่หมดอายุ) · อาการเด่นคือ
  **incognito เข้าได้ แต่โปรไฟล์ปกติเข้าไม่ได้** — เจอจริง 2026-09-08 หลัง deploy ก่อนหน้า 18 ชม.
  → กันไว้แล้วด้วย `headers()` ใน `next.config.ts` ที่บังคับ `no-cache, must-revalidate`
  ให้ทุก response **ยกเว้น `/_next/` และ `/api/`** · ห้ามถอดออก และถ้าจะเพิ่มกฎ `headers()` ใหม่
  ต้องกัน 2 กลุ่มนี้ไว้เสมอ — `/_next/static/` มี hash ในชื่อไฟล์จึงแคชยาวได้ปลอดภัย ส่วน
  route handler ใต้ `/api/` ตั้ง Cache-Control เองตามความหมายของแต่ละเส้นทาง
  (`/api/health` ตั้ง `no-store` ไม่ให้ตัวตรวจสุขภาพอ่านผลเก่า — ทับแล้วพังเงียบ)
- 🔥 **`sites-enabled/` ของ nginx include ทุกไฟล์โดยไม่สนนามสกุล** — วางไฟล์ `.bak` ไว้ในนั้น
  = ได้ vhost ตัวที่สองของโดเมนเดียวกัน nginx ขึ้น warning `conflicting server name` แล้วเลือกใช้
  ไฟล์แรกตามลำดับตัวอักษร · อันตรายเพราะไฟล์สำรองนั้น `proxy_pass` ชี้พอร์ตตายตัวของสี blue
  ไม่ผ่าน `upstream pos_app` ที่ `switch-deploy.sh` เขียนทับ วันไหนมันถูกเลือกใช้ traffic จะวิ่งไป
  พอร์ตที่ไม่มีคอนเทนเนอร์รัน → **502 ทั้งเว็บ** · แก้แล้วที่ `ops/setup-zero-downtime.sh`
  ให้เก็บไฟล์สำรองไว้ที่ `/etc/nginx/posmobileorder-backups/` แทน พร้อมขั้นเก็บกวาดของเก่า
- 🔥 **SCB ไม่ยิง payment confirmation มาเลย 2 วันเต็ม โดยไม่มีสัญญาณผิดพลาดใด ๆ ให้จับ**
  เจอจริง 2026-09-08 และ 2026-09-09: ลูกค้าจ่ายผ่าน QR สำเร็จ ยืนยันกับธนาคารด้วย `inquiry` ได้ครบทุกรายการ
  แต่ **บิลไม่ปิดสักใบ** · หลังใส่ log ครอบทุกด่านของ route แล้วดู `docker logs` ย้อนหลัง 23 ชั่วโมง
  พบว่ามีคำขอเข้า `/api/payments/webhook/scb/[secret]` แค่ 4 ครั้ง และเป็น `curl` ที่เรายิงทดสอบเองทั้งหมด
  (`userAgent: curl/8.21.0`) — **ธนาคารไม่เคยยิงมาแม้แต่ครั้งเดียว** · ตรวจแล้วว่าไม่ใช่ปัญหาฝั่งเรา:
  route ยิงถึงจากอินเทอร์เน็ตได้ (ตอบ 401 ไม่ใช่ 502/404), `SCB_WEBHOOK_SECRET` ตั้งครบ 64 ตัว, TLS 1.2 ผ่าน
  → สาเหตุอยู่ฝั่งการลงทะเบียนที่พอร์ทัล SCB ซึ่ง**เราตรวจจากในโค้ดไม่ได้เลย**: ปลายทางถูกผูกเป็นคู่
  (Biller ID, ref3 prefix) ตั้งไม่ตรงกับ `SCB_REF3_PREFIX` ที่แอปส่ง = เงียบสนิท · sandbox ก็ไม่ส่งให้
  · และถ้าลงทะเบียนเป็น `http://` จะโดน nginx ตอบ 301 ซึ่งธนาคารไม่ตาม redirect
  → **จบแล้วด้วยการติดต่อ SCB ให้แก้ปลายทางในพอร์ทัล** (2026-09-09 เย็น) — พอแก้เสร็จ callback
  เข้ามาทันทีและปิดบิลได้ใน 514 มิลลิวินาที (`INV-000008`) · payload ผ่าน schema ตั้งแต่ครั้งแรก
  ไม่ต้องแก้ `scbPaymentConfirmationSchema` เลย
  · **วิธีแยกว่าเป็นธนาคารจริงหรือ curl ทดสอบของเรา** ดูที่ log บรรทัด "มีคำขอเข้ามา":
  ธนาคารส่ง `userAgent: "-"` และ `contentLength` ~570 (payload เต็มมี `payerName`/`payerAccountNumber`)
  ส่วน curl ของเราจะเป็น `curl/8.x` และไม่กี่สิบไบต์
  · ⚠️ **ระหว่างนั้นเคยทำเส้นทางโพล (ให้แอปถาม `inquireBillPayment` เองแล้วปิดบิล) ขึ้น production
  ไปแล้วและใช้งานได้จริง แต่ถอดออกตามการตัดสินใจของเจ้าของระบบ** ว่าเงินเข้าต้องยืนยันด้วย callback
  ของธนาคารเท่านั้น (commit ที่ถอดออกอธิบายเหตุผลไว้) — **แปลว่าถ้าอาการนี้กลับมา ระบบจะไม่ปิดบิล
  ให้เองอีกเลย ต้องให้พนักงานปิดมือทุกใบ** · ถ้าจะรื้อกลับมา โค้ดเดิมอยู่ใน git history และ
  `verifyAndSettleIntent()` ยังรับงานส่วนนั้นได้เลย แต่ต้องคุยกับเจ้าของระบบก่อน
  · ตาข่ายรองรับที่มีตอนนี้คือ **การเตือนพนักงานเมื่อออก QR เกิน 5 นาทีแล้วยังไม่มี callback**
  (`listPaymentsAwaitingCallback()` ใน `lib/queries.ts` · เดิม 3 นาที ขยับเป็น 5 เมื่อ 2026-09-10
  เพราะลูกค้าใช้เวลาเปิดแอปธนาคารเกิน 3 นาทีได้ตามปกติจนเตือนหลอก) — คำนวณสด ไม่ใช่แถวใน
  `Notification` จึงหายเองเมื่อ callback มาถึงหรือพนักงานปิดบิล และ **แค่เตือน ไม่ปิดบิลและไม่ยิงถามธนาคาร**
  · สิ่งแรกที่ต้องดูเสมอเวลาบิลไม่ปิดคือ `docker logs <app> | grep scb-webhook` — ตอบให้ได้ก่อนว่า
  "ธนาคารยิงมาถึงไหม" แล้วค่อยไล่ด่านถัดไป

## สถานะการพัฒนา

**✅ ปิดครบแล้ว: Phase 1–4, 2.5, 6–10 และ 12** — checkbox ใน `Docs/spec.md` ติ๊กครบทุก Phase เหล่านี้

ของที่ใช้งานได้จริงตอนนี้:
- Auth ครบวงจร: สมัคร / เข้าสู่ระบบ / ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่ / เปลี่ยนรหัสผ่าน + `proxy.ts` กันทุกหน้า
- คลังสินค้า: CRUD สินค้า (SKU auto-gen), รับเข้า, เบิกจ่าย (กันเบิกเกินแบบ concurrent), Dashboard,
  แจ้งเตือนใกล้หมด + badge, รายงาน 30 วัน, ผู้ใช้งาน, ตั้งค่าโปรไฟล์
- **MJD Mobile Order**: ผังโต๊ะ `/mobile-order/tables` (เปิด/รวม/ยกเลิกโต๊ะ + เวลาเปิดโต๊ะคำนวณสด),
  `/mobile-order/notifications`, `/mobile-order/kitchen` (KDS 3 คอลัมน์), `/mobile-order/qr-codes`,
  `/mobile-order/tables/[tableId]` (ยกเลิกรายการได้เฉพาะที่ครัวยังไม่เริ่มทำ),
  `/mobile-order/tables/[tableId]/billing` (ปิดบิล + ค่าบริการ + ใบเสร็จพิมพ์ได้),
  `/mobile-order/settings` (ชื่อร้าน/โลโก้/ปก/สีธีม/ค่าบริการ/เมนูแนะนำ/สลับ KDS/เปิด-ปิดระบบสมาชิก)
  และฝั่งลูกค้า
  `/order/[qrToken]/*` (เมนู → ปรับแต่ง → ตะกร้า → ยืนยัน → ติดตามสถานะ → เรียกพนักงาน/เช็กบิล →
  ชำระเงินพร้อมเพย์/บัตร → ปิดบิลอัตโนมัติ)
- **ทิกเก็ตครัวแบบ PDF**: `/tickets/[orderId]` (เปิด `?auto=1` เด้งกล่องพิมพ์ให้เลย แล้วเลือกเครื่องพิมพ์
  เป็น “Microsoft Print to PDF” / “Save as PDF”) · ปุ่มอยู่บน KDS และหน้ารายละเอียดโต๊ะ ·
  ไดรเวอร์ ESC/POS เดิมที่ `lib/kitchen-printer.ts` ยังใช้ได้ทันทีที่ตั้ง `KITCHEN_PRINTER_HOST`
- **สมาชิกสะสมแต้ม**: ฟอร์มสมัครด้วยเบอร์โทรบนหน้า `pay/success` (เฉพาะร้านที่เปิด `crmEnabled`)
  1 แต้ม/25 บาท (`lib/points.ts`) · ให้แต้มครั้งเดียวต่อบิลด้วย unique `MemberPointTransaction.saleId`
- **ชำระเงิน MJD Mobile Order — ✅ ต่อ SCB จริงแล้วและใช้งานได้ (พิสูจน์ด้วยเงินจริง 2026-09-09)**:
  ลูกค้าสแกน QR ที่ธนาคารออกให้ → จ่าย → SCB ยิง payment confirmation กลับมา → บิลปิดเอง
  วัดจริงได้ **514 มิลลิวินาที** ตั้งแต่ callback มาถึงจนบิลปิด (`INV-000008`) · ตัวเชื่อมอยู่ที่
  `lib/payment-provider/scb.ts` · ปลายทาง callback คือ `/api/payments/webhook/scb/[secret]`
  (env `SCB_WEBHOOK_SECRET`) · ด่านตรวจ 3 ชั้นรวมไว้ที่ `verifyAndSettleIntent()` ใน
  `lib/payment-reconcile.ts` แล้วปิดบิลผ่าน `lib/close-session.ts` ตัวเดียวกับที่พนักงานกดยืนยันใช้
  · idempotent ด้วย `Sale.paymentReference` ที่ unique
  · ⚠️ **callback เป็นทางเดียวที่ปิดบิลอัตโนมัติได้** (ตัดสินใจ 2026-09-09) — เคยมีเส้นทางโพล
  ถามธนาคารเองที่ปิดบิลได้โดยไม่ต้องรอ callback แล้วถอดออก **ยอมรับความเสี่ยงว่า callback หาย
  เมื่อไหร่ = บิลค้างทุกใบ ต้องปิดมือ** (ดูกับดักหัวข้อก่อนหน้า) · `/api/order/[qrToken]/payment`
  จึงรายงานสถานะอย่างเดียว ห้ามยิงหาธนาคาร — มีเทสล็อกไว้ที่
  `__tests__/integration/payment-status-readonly.test.ts`
  · ตาข่ายรองรับคือ **เตือนพนักงานเมื่อออก QR เกิน 5 นาทีแล้วยังไม่มี callback** โผล่บนหน้า
  `/mobile-order/notifications` พร้อม `ref1` ไว้ค้นในแอปธนาคาร และรวมอยู่ใน badge ของ sidebar
  ด้วย (`getPendingNotificationCount()`) · เป็นค่าคำนวณสด ไม่ใช่แถวในตาราง `Notification`
  จึงหายเองเมื่อเงื่อนไขหมดไป ไม่ต้องมีใครกดรับทราบ
  · คู่กันคือป้าย **"ลูกค้าชำระเงินแล้วเรียบร้อยเมื่อเวลา…"** (`listCustomerPaidBills()`) —
  จำเป็นเพราะปิดบิลแล้วโต๊ะกลับเป็นว่างในทรานแซคชันเดียวกัน พนักงานจึงเห็นแค่โต๊ะหายไปเฉย ๆ ·
  คำนวณสดเช่นกัน หายเองใน 30 นาที
  · ⚠️ **ต้องขึ้นทั้งบิลที่ระบบปิดเองและบิลที่พนักงานกดปิด** โดยบอกให้ชัดว่าใครปิด
  (`Sale.cashierId = SYSTEM_USER_ID` → `autoClosed`) — เคยกรองเฉพาะบิลที่ระบบปิดเองด้วยเหตุผลว่า
  "คนกดรู้อยู่แล้ว" แล้วเจ้าของระบบเจอจริง 2026-09-10 ว่าเคสลูกค้าจ่ายหลัง QR หมดอายุมักจบด้วย
  พนักงานกดปิดเอง (เห็นเตือน "รอธนาคารยืนยัน" → เช็กแอปธนาคาร → กดปิด) จอเลยไม่ขึ้นอะไรเลย
  ทั้งที่ลูกค้าจ่ายแล้ว · คนที่กดปิดกับคนที่เฝ้าจอมักเป็นคนละคน
  · ⚠️ **แถบทั้งสองอยู่ใน `components/payment-alerts.tsx` และต้องเรนเดอร์ "ในกรอบของโต๊ะนั้น"
  เสมอ** (การ์ดโต๊ะบนผังโต๊ะ / การ์ดแจ้งเตือนของโต๊ะเดียวกัน) — เคยแยกเป็น section ของตัวเองแล้ว
  เจ้าของระบบบอกว่างงหนักกว่าเดิม เพราะต้องเอาเลขโต๊ะในกรอบใหม่ไปไล่จับคู่กับการ์ดโต๊ะอีกที ·
  ข้อยกเว้นเดียวคือใบรอธนาคารยืนยันของโต๊ะที่ไม่มีการ์ดแจ้งเตือนให้เกาะ ยังต้องมีการ์ดสำรองให้
  ไม่งั้น badge ของ sidebar จะนับเลขที่ไม่มีที่มาให้ดู
  · `POST /api/payments/webhook` (env `PAYMENT_WEBHOOK_SECRET`) เป็นปลายทางกลางของ provider อื่น
  ยังอยู่และยังไม่ได้ต่อกับใคร · `lib/promptpay.ts` (env `PROMPTPAY_ID`) เป็น fallback ให้ร้าน
  ที่รับพร้อมเพย์ส่วนตัวแล้วให้พนักงานกดยืนยันเอง (เลือกด้วย `isScbConfigured()`)
- **POS หน้าร้าน**: หน้า `/pos` (ค้นหา/บาร์โค้ด + ตะกร้า + ส่วนลด + ชำระเงิน CASH/TRANSFER/QR + ใบเสร็จพิมพ์ได้),
  `/pos/history` (กรองวันที่/สถานะ + void พร้อมเหตุผล), `/pos/closing` (ปิดยอดวันละครั้ง/คน + ส่วนต่างเงินสด),
  `/categories` (หมวดหมู่เป็น master data — `Product.categoryId` เป็น FK แล้ว ไม่ใช่ข้อความอิสระ)
- ฐานข้อมูล: `posmobileorderdb` บน container `posmobileorder-postgres` (PostgreSQL 18, port **5437**)
  seed ไว้ 7 รายการ SKU-1001…SKU-1007 + บิลตัวอย่าง 8 บิล

**✅ Phase 13 multi-tenant ขึ้น production แล้ว (2026-09-15, PR #1)** — `Store`/`StoreMember` · `storeId` ทุก entity ราก ·
`requireStore()`/`requireOwner()` · `forStore()` extension · ตัวสลับร้านใน topbar · `/users` = พนักงานในร้าน ·
เทส isolation ครอบทุก query/action · ร้านเดิมกลายเป็น `store_default` (slug `default`) admin เป็น OWNER

**✅ Phase 14a Onboarding ขึ้น production แล้ว (2026-09-15, PR #2)**: สมัครเองได้เมื่อ
`SIGNUP_OPEN=true` → `/onboarding` สร้างร้าน (Store + Settings + บทบาท + OWNER + โต๊ะ/QR ตัวอย่าง 4 + เมนูตัวอย่าง 3
ในทรานแซคชันเดียว) → เชิญพนักงานทางอีเมล (`StoreInvite` เก็บแค่ SHA-256 ของ token · ลิงก์ `/invite/[token]` public ·
ตอบรับได้ทั้ง token และจากรายการคำเชิญค้างบน `/no-store`) → `/admin/stores` ระงับ/ปลดระงับร้าน (ผู้ดูแลแพลตฟอร์ม)
· `SIGNUP_OPEN=true` ตั้งบน VPS แล้ว · admin เป็น `isPlatformAdmin` แล้ว

**✅ Phase 14b Subscription ขึ้น production แล้ว (2026-09-15, PR #3)**: ค่าใช้งานคิดเป็นวัน
ตาม tier โต๊ะ (S/M/L/XL = 12/30/60/120 โต๊ะ · 10/20/35/60 บาท/วัน · แพ็กเกจ 7/15/30/90/180/365 วัน ราคาสุทธิตั้งตรง ๆ) ·
ทดลอง 7 วันครั้งเดียวต่อเลขพร้อมเพย์ (`TrialClaim` เก็บ hash) · ต่ออายุ stack ต่อท้าย · อัปเกรดกลางทางจ่ายส่วนต่าง ·
หมดอายุ = อ่านได้ ขายไม่ได้ (`requireSellingStore`) · เพดานโต๊ะใต้ advisory lock · `/billing` (OWNER) · `/admin/stores/[id]`
ledger + ยืนยัน/ถอย/เติมวัน/ตั้งเพดาน · `/admin/plans` version ประวัติเรต · เตือน 7/3/1 วัน (แบนเนอร์ + อีเมลผ่าน cron route)
· **ร้านเดิมทุกร้านตอน migrate ถูก backfill เป็น FREE ถึง 2099 / 120 โต๊ะ** (ledger แถว `SUB-LEGACYxxxx`) · ร้านใหม่เริ่มที่
"ยังไม่มีแพ็กเกจ" ต้องรับสิทธิ์ทดลอง/จ่ายก่อนขาย · **ตอน deploy**: ตั้ง `PLATFORM_PROMPTPAY_ID`/`CRON_SECRET` ใน `.env` บน VPS
+ รัน `bash ops/install-cron.sh` ใหม่ + ซ้อม migration บนสำเนาก่อน (แตะ `store`/`store_settings` ที่มีข้อมูล)
· `CRON_SECRET` ตั้งแล้ว cron ทำงานแล้ว · `PLATFORM_PROMPTPAY_ID` **ยังเว้นว่างโดยตั้งใจ** (เจ้าของสั่ง hold รอเลขจริง —
หน้า `/billing` และ `/brand/billing` สร้างคำขอได้แต่ไม่มี QR จนกว่าจะเติมค่าแล้ว recreate คอนเทนเนอร์)

**✅ Phase 14c Brand ขึ้น production แล้ว (2026-09-16, PR #4)**: `Brand` (1 บัญชี = 1 แบรนด์ ·
`Store.brandId?` · เจ้าของแบรนด์ = OWNER ทุกสาขาอัตโนมัติผ่าน `lib/store-context.ts`) · `/brand` สร้าง/เปลี่ยนชื่อแบรนด์
ดึงร้านที่ตัวเองเป็นเจ้าของเข้า (ย้ายระหว่างแบรนด์ยังไม่ทำ) · คัดลอกเมนูข้ามสาขา (`lib/menu-copy.ts` — สำเนาอิสระ
MenuItem + Modifier ข้ามชื่อซ้ำ ไม่ติด featured · ใช้ทั้งบน `/brand` และตอนสร้างสาขาใหม่ที่ `/onboarding?brand=1`) ·
`/brand/reports` ยอด 30 วันรายสาขาเทียบกัน (วน query เดิมของ `lib/queries.ts` ต่อ storeId ไม่มี query ข้ามร้านใหม่) ·
`/brand/billing` ใบจ่ายรวม `SubscriptionBatch` (`BAT-XXXXXX`) → ผู้ดูแลยืนยันทั้งใบที่ `/admin/batches/[id]` ·
ตัวสลับร้านจัดกลุ่มตามแบรนด์ (`<optgroup>`) · migration `add_brand_and_subscription_batch` additive ล้วน ไม่มี backfill
(ร้านเดิมทุกร้าน `brandId = NULL`) · เทส `__tests__/integration/brand.test.ts` 21 เทส (รวม concurrent ยืนยันใบ)
· **deploy จริง 2026-09-16**: backup `posmobileorderdb-20260916-113807.dump` → ซ้อมบนสำเนาในเครื่อง → merge → CI run 35056401544
migrate deploy ผ่าน + สลับ green → blue · ยืนยันโค้ดใหม่ในคอนเทนเนอร์ด้วย `ls .next/server/app/(staff)/(app)/brand` แล้ว
(ไม่ใช่แค่ `/api/health`) · ⚠️ **SSH เข้า VPS จาก Claude Code ถูก auto mode ปฏิเสธ** (จัดเป็น production access) — ขั้น backup/ตรวจ
ในคอนเทนเนอร์ต้องให้เจ้าของระบบรันเองผ่าน `! ssh posmobileorder …` (ใช้คำสั่งที่**ไม่มี single quote** ไม่งั้น bash ของ `!` ฟ้อง EOF)

**✅ Phase 15a ขึ้น production แล้ว (2026-09-16, PR #6 · CI run 35062832243 · backup `posmobileorderdb-20260916-131403.dump` · ตรวจแล้ว `default` = `SCB_BILLER`, `store_payment_config` 0 แถวตามคาด)**: `Store.paymentMode` +
`StorePaymentConfig` (ย้าย `promptPayId` มาจาก `StoreSettings` — migration backfill แล้ว DROP) · `getStorePaymentProfile()`
แทน `isQrPaymentAvailable()`/env `PROMPTPAY_ID` · การ์ด "การรับเงินจากลูกค้า" ใน `/mobile-order/settings` (OWNER) ·
ผู้ดูแลตั้งโหมด SCB ที่ `/admin/stores/[id]` · migration ตั้ง `default` = `SCB_BILLER` ร้านอื่น = `PROMPTPAY_DIRECT` ·
ซ้อมบนสำเนา production แล้ว diff สะอาด · **15b (ตรวจสลิป) / 15c (SCB ต่อร้าน) รอเจ้าของระบบเลือก provider/credential**

**✅ Phase 16 RBAC เต็ม ขึ้น production แล้ว (2026-09-16, PR #8 · CI run 35067809235 · backup `posmobileorderdb-20260916-141727.dump` · migration 2 ไฟล์ applied)**: resource `MO_*` 5 ตัว
ครอบทุกหน้า/action ของ Mobile Order · preset "พนักงานเสิร์ฟ" · 2 migrations (เพิ่ม enum / backfill สิทธิ์ + ผูก STAFF ที่ไม่มีบทบาท) ·
ซ้อมบนสำเนา production แล้ว diff สะอาด · ไม่มี env ใหม่ · ไม่ซ่อนปุ่มรายสิทธิ์ใน UI (เหมือน F1–F9 ที่มีอยู่ — ด่านจริงคือ server)

**ยังไม่ได้ทำ**: **Phase 11 (LINE — เจ้าของสั่งข้ามไปก่อน 2026-09-16)** · **Phase 15b–15c** (รอเลือก provider ตรวจสลิป / credential SCB) · Phase 5 เหลือ smoke test เต็มรูปแบบบน production ซึ่งต้อง merge ก่อน —
ลำดับงานทั้งหมดอยู่ที่ [`Docs/spec.md` §8](Docs/spec.md)

> ✅ **production รัน schema ครบถึง `20260914120000_add_multi_tenant` (Phase 13) แล้ว — 2026-09-15**
> ลำดับที่ใช้จริงและควรใช้ซ้ำกับ migration ใหญ่ครั้งหน้า: ซ้อมบนสำเนา dump production ในเครื่อง →
> `bash ops/backup-db.sh` บน VPS + `scp` ลง `D:\MJD_Backup` → merge → CI `migrate deploy` + สลับสี →
> ตรวจ `_prisma_migrations`/backfill ในฐานจริง + ยืนยันว่า image ใน container มีโค้ดใหม่ (`ls .next/server/app/...`
> หา route ใหม่) ไม่ใช่แค่ `/api/health` · **ห้าม merge migration ใหญ่วันที่ร้านเปิดขายอยู่**
> · วิธีซ้อม: `docker cp <dump> posmobileorder-postgres:/tmp/prod.dump` → `pg_restore` ลงฐานชื่อลงท้าย `_test`
> → `DATABASE_URL=<ฐานนั้น> npx prisma migrate deploy` → `migrate diff --exit-code` (ใน Git Bash ต้องตั้ง
> `MSYS_NO_PATHCONV=1` ไม่งั้น `/tmp` ถูกแปลงเป็นพาธ Windows)

**✅ deploy ขึ้น production แล้ว (2026-09-02): https://posqr.jayjayservices.com**
CI/CD อัตโนมัติจาก `main` ทำงานจริง — push → test → build+push image ไป `ghcr.io` → scp compose +
`up -d` + `migrate deploy` (ตั้งแต่ Phase 5 เปลี่ยนเป็น pull → migrate → `ops/switch-deploy.sh`) บน VPS `138.252.93.119` (user `deploy`) · nginx + HTTPS (Let's Encrypt,
ต่ออายุอัตโนมัติ) · PostgreSQL 18 ในคอนเทนเนอร์ `posmobileorder-db` · `/api/health` ตอบ 200

**✅ Phase 5 ทำบน VPS จริงแล้ว (2026-09-04)** — เหลือเฉพาะที่ต้องรอ API key:

| งาน | สถานะ |
|---|---|
| SSH hardening + fail2ban | ✅ `passwordauthentication no` + `permitrootlogin no` · ตรวจจากภายนอกแล้ว key เข้าได้ / password ถูกปฏิเสธ |
| UFW | ✅ `active` เปิดเฉพาะ OpenSSH / 80 / 443 |
| zero-downtime blue/green | ✅ วัดจริง **36 คำขอ ล้ม 0 ครั้ง** ตอนสลับสี |
| rollback | ✅ `latest` ↔ `previous` ผ่านทั้งสองทาง แบบไม่มี downtime |
| health alert | ✅ cron ทำงาน + **ส่งอีเมลจริงผ่านครบทั้งสองทิศทาง** (ปกติ→ล่ม, ล่ม→ปกติ) |
| อีเมลจริง | ✅ `.env` บน server มี `RESEND_API_KEY`/`MAIL_FROM` แล้ว · ยิง Resend ตรง ๆ ได้ 200 + message id |

> ⚠️ `ALERT_EMAIL` ต้องเป็นกล่องจดหมายที่ **รับอีเมลขาเข้าได้จริง** — `mail.jayjayservices.com`
> และ `jayjayservices.com` **ไม่มี MX เลย** (ตั้งไว้ส่งออกอย่างเดียว: SPF/DKIM ของ Resend +
> MX ที่ `send.mail.` ไว้รับ bounce ให้ Amazon SES) การตั้งเป็น `no-reply@` ของโดเมนตัวเอง
> จะทำให้อีเมลแจ้งเตือน hard-bounce ทุกฉบับ = service ล่มแล้วไม่มีใครรู้
> · `MAIL_FROM` (ผู้ส่ง) กับ `ALERT_EMAIL` (ผู้รับ) เป็นคนละบทบาทกัน อย่าสลับกัน

> 🐞 **กับดักที่เจอจริง**: host ของ VPS **ไม่มี `node`** (อยู่แต่ในคอนเทนเนอร์ของแอป) `json_str()`
> ใน `ops/lib-common.sh` จึงตกไปใช้ fallback sed เสมอ — ของเดิมใช้ `s/$/\\n/` ที่ sed มองว่า
> "ทุกบรรทัด" รวมบรรทัดสุดท้าย เลยเติม `\n` ต่อท้าย subject ทำให้ Resend ตอบ 422 และ
> **อีเมลแจ้งเตือนไม่เคยส่งออกได้เลย** · แก้แล้ว แต่เวลาแตะสคริปต์ ops ต้องทดสอบเส้นทาง sed เสมอ

**สถาปัตยกรรมบน VPS หลัง Phase 5:** แอปรันสองสีสลับกัน `posmobileorder-app-blue` (127.0.0.1:3001) /
`posmobileorder-app-green` (3002) · nginx ชี้ผ่าน `upstream pos_app` ใน `/etc/nginx/conf.d/pos-upstream.conf`
ที่ `ops/switch-deploy.sh` เขียนทับทุกครั้ง · คอนเทนเนอร์เดิมชื่อ `posmobileorder-app` **ไม่มีแล้ว**

> ⚠️ **`deploy` ไม่มี `NOPASSWD:ALL` อีกแล้ว** — ไฟล์ `/etc/sudoers.d/90-deploy` ถูกลบทิ้ง (สำเนาอยู่ที่
> `/root/90-deploy.removed-by-claude.bak`) เพราะใครได้ SSH key ของบัญชีนี้ไป — ซึ่งเก็บใน GitHub Secrets
> ของ CI ด้วย — ก็ได้ root ทันทีโดยไม่ต้องรู้ความลับอะไรเพิ่ม · sudo ทั่วไปต้องใส่รหัสผ่านแล้ว
> เหลือ NOPASSWD เฉพาะ 3 คำสั่งที่ CI ต้องใช้ (`nginx -t`, `nginx -s reload`, `tee` ไฟล์ upstream)

`requireEmailVerification` เปิดเป็น `true` แล้ว และมีหน้า `/verify-email` + ปุ่มส่งอีเมลยืนยันซ้ำบน `/login`
— บัญชีที่สร้างด้วย `pnpm db:create-user` ถูกตั้ง `emailVerified = true` มาแล้วจึงล็อกอินได้ตามปกติ

**ระบบสิทธิ์ตามบทบาท (Role-Based Permission) ทำครบแล้ว** — `Role`/`RolePermission` ต่อร้าน (Phase 13) + matrix F1–F9 และ
Phase 16 ครอบ MJD Mobile Order (`MO_*`) · หน้า `/roles` แก้ matrix · `/users` ผูกบทบาท · STAFF ที่ `roleId = null` เข้าได้เฉพาะ
`/settings` ตาม §4 (ตั้งแต่ Phase 16 ไม่มีทางลัดผ่านหน้า Mobile Order อีกแล้ว) · OWNER ได้เต็มทุก resource โดยไม่ต้องมี Role

## 🍽️ MJD Mobile Order (Phase 6–12)

Channel ที่สอง (สั่งอาหารผ่าน QR Code สำหรับร้านอาหารแบบ table service) — **Phase 6–10 และ 12 ทำเสร็จแล้ว
เหลือ Phase 11 (LINE) อย่างเดียว** ทุกบิลของ Mobile Order ปิดลงตาราง
`Sale`/`SaleItem` ที่สร้างใน Phase 2.5 — เอนทิตี `Table`, `TableSession`, `MenuItem`,
`ModifierGroup`/`ModifierOption`, `MobileOrder`/`MobileOrderItem`, `QRCode`, `Notification`,
`LineNotificationLog`, `StoreSettings`, `Member`/`MemberPointTransaction` และ route `/mobile-order/*`,
`/order/[qrToken]/*` สร้างไล่มาตั้งแต่ Phase 6 (วางฐาน schema/table-session) ตามลำดับใน spec

ที่ที่ต้องดูก่อนเริ่มงานส่วนนี้:
- [`Docs/spec.md` §2 Data Model](Docs/spec.md) — หัวข้อ "MJD Mobile Order — Data Model" (เอนทิตี + enum ใหม่
  ทั้งหมด, การแก้ `Sale`/`PaymentMethod`)
- [`Docs/spec.md` §3](Docs/spec.md) — หัวข้อ "MJD Mobile Order — กติกาธุรกิจ" (เปิด/ปิด/รวมโต๊ะ, สถานะรายการ
  อาหาร + ยกเลิกรายการ, วงจรชีวิต QR, การชำระเงิน/ปิดบิลอัตโนมัติ, LINE, CRM)
- [`Docs/spec.md` §5 F11–F22](Docs/spec.md) — feature + acceptance criteria ทั้งหมด
- [`Docs/spec.md` §6a Routes/UI](Docs/spec.md) — route ฝั่งลูกค้า/พนักงาน/ครัว + หมายเหตุ realtime (Socket.IO
  สำหรับ staff/kitchen, polling สำหรับลูกค้า)
- [`Docs/spec.md` §8 Phase 6–12](Docs/spec.md) — ลำดับงานและกับดักที่คาดไว้ล่วงหน้า (race condition ยกเลิก
  รายการ vs ครัวเริ่มทำ, webhook ซ้ำ/ไม่เรียงลำดับ, dynamic QR reuse-after-payment)

ดูกติกาโค้ดที่ต้องทำตามตั้งแต่เริ่ม Phase 6 ใน [กติกาที่ห้ามละเมิด](#กติกาที่ห้ามละเมิด) ข้อ 7–8 ด้านบน
