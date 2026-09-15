# StockApp — Software Specification (รวม POS)

> ระบบคลังสินค้าเบิกจ่าย + ขายหน้าร้าน (Inventory / Stock Management + Point of Sale)
> เอกสารนี้รวม spec หลักของ StockApp เข้ากับส่วนขยาย POS เป็นไฟล์เดียว และเป็นสัญญาอ้างอิงหลักของการพัฒนา

- **สถานะ:** Draft v1.0 (รวมฉบับ)
- **วันที่:** 2026-08-18
- **Package manager:** pnpm

---

## 1. ภาพรวมระบบ (System Overview)

StockApp เป็นเว็บแอปพลิเคชันสำหรับจัดการคลังสินค้าเบิกจ่ายภายในองค์กร ช่วยให้ผู้ใช้บันทึกการรับสินค้าเข้า
(Stock In) และเบิกจ่ายสินค้าออก (Stock Out) พร้อมติดตามยอดคงเหลือแบบเรียลไทม์ และแจ้งเตือนเมื่อสินค้าใกล้หมด
นอกจากการเบิกจ่ายภายในแล้ว ระบบยังรองรับ **การขายหน้าร้าน (POS)** โดยยึดหลักว่า **การขายคือการเบิกจ่ายสต็อก
รูปแบบหนึ่ง** ไม่ใช่ระบบแยกต่างหาก — เมื่อพนักงาน checkout บิลขาย ระบบจะสร้างเอกสารการขาย (`Sale` + `SaleItem`)
และตัดสต็อกผ่านกลไกเดิมทั้งหมด (`StockTransaction(type=OUT)` + `prisma.$transaction` + การกันเบิกเกิน) ทำให้
ledger การเคลื่อนไหวสต็อกยังคงเป็นแหล่งความจริงเดียว (single source of truth) ทั้งสำหรับ Stock Out ที่เบิก
ด้วยมือและที่เกิดจากการขาย POS — Dashboard/Reports จึงถูกต้องเสมอโดยไม่ต้องเขียน logic คำนวณยอดคงเหลือซ้ำ

นอกจากนี้ ระบบยังรองรับ **การสั่งอาหารผ่านมือถือสำหรับร้านอาหารแบบ Table Service ("MJD Mobile Order")** เป็น
ช่องทางขายที่สอง (channel ที่สอง) คู่ขนานกับ POS หน้าร้านเดิม — ลูกค้าสแกน QR Code ที่โต๊ะเพื่อสั่งอาหารเองผ่าน
มือถือ ออร์เดอร์เข้าครัว/POS ทันที และเมื่อชำระเงินสำเร็จ (พร้อมเพย์/บัตรผ่านเครื่อง EDC) ระบบปิดโต๊ะอัตโนมัติ
พร้อมสร้างบิลเป็น `Sale` (`channel = MOBILE_ORDER`) ที่ไหลเข้า Dashboard/Reports/ประวัติการขายชุดเดียวกับ POS
หน้าร้าน — ใช้ Auth/User และกลไกออกบิลเดิมทั้งหมด ไม่ใช่ระบบแยกต่างหาก (รายละเอียดฟีเจอร์ดู F11–F22 ใน §5,
routes ดู [§6a](#6a-routes--ui-mjd-mobile-order))

### เป้าหมายหลัก
- จัดการข้อมูลสินค้า (Product) แบบครบวงจรพร้อมรหัส SKU ที่ไม่ซ้ำ
- บันทึกการเคลื่อนไหวสต็อก (Stock In / Stock Out) และคำนวณยอดคงเหลืออย่างถูกต้อง
- **ป้องกันการเบิกเกิน/ขายเกินจำนวนที่มีอยู่จริง** ด้วย transaction ที่ atomic
- ให้ภาพรวมสต็อกผ่าน Dashboard พร้อมแจ้งเตือนสินค้าใกล้หมด (reorder point)
- ขายสินค้าให้ลูกค้าหน้าร้านได้ผ่านหน้าจอ POS พร้อมออกใบเสร็จ และยกเลิกบิล (void) ได้ในวันเดียวกัน
- ให้ลูกค้าร้านอาหารสั่งอาหารเองผ่านการสแกน QR Code ที่โต๊ะ ติดตามสถานะออร์เดอร์ ชำระเงิน และปิดโต๊ะอัตโนมัติ
  (MJD Mobile Order)

### Tech Stack
| ชั้น | เทคโนโลยี |
|---|---|
| Framework | Next.js 16 (App Router) |
| ภาษา | TypeScript |
| ORM | Prisma |
| Database | PostgreSQL |
| UI | Tailwind CSS v4 + shadcn/ui |
| Package Manager | pnpm |
| Realtime (Staff/Kitchen) | Socket.IO (ต่อคู่กับ custom Next.js server เดิม) |
| แจ้งเตือนลูกค้า | LINE Messaging API |
| QR Code Generation | `qrcode` (npm) |
| การชำระเงินออนไลน์ | PromptPay Webhook (bank/provider ยืนยันอัตโนมัติ) |

### ขอบเขต (Scope)
- **In scope:** CRUD สินค้า, Stock In/Out, ยอดคงเหลือ, Dashboard, แจ้งเตือนใกล้หมด, **ระบบ Auth**
  (login/register + ยืนยันอีเมล/forgot-password/reset-password + guard ทุกหน้า), **ระบบ POS** (ตะกร้า + checkout,
  วิธีชำระเงิน CASH/TRANSFER/QR, ส่วนลดท้ายบิล, ใบเสร็จแสดง+พิมพ์ผ่าน browser, void บิลในวันเดียวกัน,
  ประวัติการขาย, ส่วนขยาย Dashboard/Reports สำหรับยอดขาย)
- **In scope (MJD Mobile Order):** สั่งอาหารผ่าน QR Code (Static/Dynamic), เมนูดิจิทัล + เมนูแนะนำ (สูงสุด 6
  รายการ), เรียกพนักงาน/เช็กบิล, ชำระเงิน PromptPay (webhook ยืนยันอัตโนมัติ) และ Card ผ่านเครื่อง EDC, ปิดโต๊ะ
  อัตโนมัติ, ผังโต๊ะ + รวมโต๊ะ, การแจ้งเตือนพนักงาน (พร้อมเวลาเปิดโต๊ะ/ระยะเวลาเปิดโต๊ะ), Kitchen Display System
  (+ fallback ร้านที่ไม่มี KDS), ยกเลิกรายการอาหารที่ยังไม่เริ่มปรุง, แจ้งเตือนลูกค้าผ่าน LINE, จัดการ QR Code,
  ตั้งค่าธีม/แบรนด์ (POS Manager), สมัครสมาชิก/สะสมแต้มอัตโนมัติ (CRM MVP)
- **Authentication ≠ Authorization:** v1 ทำเฉพาะ **การพิสูจน์ตัวตน** (ใครเข้าระบบได้) — **ยังไม่ทำการแบ่งสิทธิ์**
  (ใครทำอะไรได้) ผู้ใช้ทุกคนที่ล็อกอินสำเร็จเข้าถึงได้ทุกหน้าและทำได้ทุก action เท่ากัน
- **Out of scope (v1):** **ระบบสิทธิ์ผู้ใช้ (Role-Based Permission)** และรายการอื่น ๆ — ดูรายละเอียดครบใน
  [7. Out of Scope](#7-out-of-scope-v1) — ออกแบบ schema/โครงสร้างให้ต่อยอดฟีเจอร์เหล่านี้ได้ในอนาคต

---

## 2. Data Model

### Category
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `name` | String | **unique**, required | ชื่อหมวดหมู่สินค้า เช่น เครื่องเขียน, อุปกรณ์ไฟฟ้า |
| `createdAt` | DateTime | auto | เวลาสร้าง |
| `updatedAt` | DateTime | auto | เวลาแก้ไขล่าสุด |

### Product
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String / Int | PK | รหัสภายในระบบ |
| `sku` | String | **unique**, required | รหัสสินค้า เช่น `SKU-1001` |
| `name` | String | required | ชื่อสินค้า |
| `categoryId` | String | required, FK → Category | หมวดหมู่สินค้า (เลือกจากรายการที่มีอยู่ ไม่พิมพ์อิสระ) |
| `unit` | String | required | หน่วยนับ เช่น ชิ้น / กล่อง |
| `quantity` | Int | default 0, ≥ 0 | ยอดคงเหลือปัจจุบัน |
| `reorderPoint` | Int | default 0, ≥ 0 | จุดสั่งซื้อ — ต่ำกว่าหรือเท่านี้ถือว่า "ใกล้หมด" |
| `price` | Decimal | ≥ 0 | ราคาต่อหน่วย |
| `createdAt` | DateTime | auto | เวลาสร้าง |
| `updatedAt` | DateTime | auto | เวลาแก้ไขล่าสุด |

### StockTransaction
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String / Int | PK | รหัสรายการ |
| `productId` | String / Int | FK → Product | สินค้าที่เกี่ยวข้อง |
| `type` | `TransactionType` | enum {IN, OUT} | ประเภทการเคลื่อนไหว |
| `quantity` | Int | > 0 | จำนวนที่รับเข้า/เบิกออก |
| `note` | String? | optional | หมายเหตุ (ผู้เบิก/แผนก/เหตุผล/เอกสารอ้างอิง) |
| `saleId` | String? | optional, FK → Sale | ระบุถ้ารายการนี้เกิดจากการขาย POS (checkout สร้าง OUT, void สร้าง IN ชดเชย) — `null` หากเป็น Stock In/Out ที่คีย์ด้วยมือ |
| `createdAt` | DateTime | auto | เวลาบันทึกรายการ |

### Sale
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `saleNumber` | String | **unique**, auto-gen | เลขที่บิล เช่น `INV-000001` (หา max +1 แบบเดียวกับ SKU auto-gen) |
| `status` | `SaleStatus` | default `COMPLETED` | สถานะบิล |
| `subtotal` | Decimal | ≥ 0 | Σ (quantity × unitPrice) ก่อนหักส่วนลด |
| `discount` | Decimal | default 0, `0 ≤ discount ≤ subtotal` | ส่วนลดท้ายบิล (หน่วยบาท) |
| `total` | Decimal | = subtotal − discount | ยอดสุทธิที่ต้องชำระ |
| `paymentMethod` | `PaymentMethod` | required | วิธีชำระเงิน |
| `amountReceived` | Decimal | CASH: ≥ total / อื่นๆ: = total | เงินที่รับจริงจากลูกค้า |
| `changeDue` | Decimal | default 0, = amountReceived − total | เงินทอน |
| `note` | String? | optional | หมายเหตุ |
| `channel` | `SaleChannel` | default `RETAIL_POS` | `RETAIL_POS` (เดิม, ขายหน้าร้าน) / `MOBILE_ORDER` (ใหม่, ปิดบิลจากโต๊ะลูกค้า — ดู [MJD Mobile Order](#mjd-mobile-order-กติกาธุรกิจ)) |
| `tableSessionId` | String? | optional, FK → TableSession | ไม่ null เฉพาะบิลที่มาจาก MJD Mobile Order |
| `cashierId` | String | FK → User (Better Auth) | พนักงานที่ขาย (session user ตอน checkout) — บิล `MOBILE_ORDER` ที่ปิดผ่าน PromptPay webhook ใช้ผู้ใช้ระบบ (system user) แทน |
| `voidedAt` | DateTime? | optional | เวลาที่ยกเลิกบิล (ถ้ามี) |
| `voidedById` | String? | optional, FK → User | ผู้ยกเลิกบิล |
| `voidReason` | String? | optional | เหตุผลยกเลิก |
| `createdAt` | DateTime | auto | เวลาขาย |

### SaleItem
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสรายการ |
| `saleId` | String | FK → Sale | บิลที่รายการนี้สังกัด |
| `productId` | String | FK → Product | สินค้าที่ขาย |
| `quantity` | Int | > 0 | จำนวนที่ขาย |
| `unitPrice` | Decimal | ≥ 0, snapshot | ราคาต่อหน่วย ณ เวลาขาย (**ไม่อิงราคาปัจจุบันของ Product ย้อนหลัง** — กันปัญหาแก้ราคาสินค้าทีหลังแล้วบิลเก่าเพี้ยน) |
| `subtotal` | Decimal | = quantity × unitPrice | ยอดรวมรายการ |

### CashierClosing
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `cashierId` | String | FK → User | แคชเชียร์ที่ปิดยอด |
| `closingDate` | DateTime | date-only, **unique ร่วมกับ cashierId** | วันที่ปิดยอด (1 ครั้ง/แคชเชียร์/วัน) |
| `totalSales` | Decimal | ≥ 0 | Σ `total` ของ `Sale` (COMPLETED) ของแคชเชียร์คนนี้ในวันนั้น |
| `totalCash` | Decimal | ≥ 0 | Σ `total` เฉพาะ `paymentMethod = CASH` |
| `totalTransfer` | Decimal | ≥ 0 | Σ `total` เฉพาะ `paymentMethod = TRANSFER` |
| `totalQR` | Decimal | ≥ 0 | Σ `total` เฉพาะ `paymentMethod = QR` |
| `billCount` | Int | ≥ 0 | จำนวนบิล COMPLETED ของวันนั้น |
| `voidedCount` | Int | ≥ 0 | จำนวนบิลที่ถูก void ในวันนั้น |
| `countedCash` | Decimal | ≥ 0 | เงินสดที่แคชเชียร์นับได้จริงตอนปิดยอด |
| `difference` | Decimal | = countedCash − totalCash | ส่วนต่างเงินสด (ขาด/เกิน) |
| `note` | String? | optional | หมายเหตุ (เช่น เหตุผลที่เงินขาด/เกิน) |
| `closedAt` | DateTime | auto | เวลาที่กดปิดยอด |

### MJD Mobile Order — Data Model

> เอนทิตีตั้งแต่ `Table` ถึง `MemberPointTransaction` ด้านล่างนี้ทั้งหมด รองรับระบบสั่งอาหารผ่าน QR Code
> สำหรับร้านอาหาร (channel ที่สอง คู่ขนานกับ POS หน้าร้าน) — ดูกติกาธุรกิจที่เกี่ยวข้องใน
> [§3 MJD Mobile Order — กติกาธุรกิจ](#mjd-mobile-order-กติกาธุรกิจ) และฟีเจอร์ F11–F22 ใน §5

#### Table
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `code` | String | **unique**, required | หมายเลข/ชื่อโต๊ะที่พนักงานเห็น เช่น `01`, `A3` |
| `status` | `TableStatus` | default `EMPTY` | สถานะที่ใช้แสดงบนผังโต๊ะ — denormalized field อัปเดตใน transaction เดียวกับเหตุการณ์เสมอ (เปิดโต๊ะ/สั่งของ/เช็กบิล/ปิดบิล/รวมโต๊ะ) เหมือน `Product.quantity` ที่อัปเดตคู่กับ `StockTransaction` — ไม่คำนวณสดจาก join ทุกครั้งเพื่อความเร็วของหน้าผังโต๊ะ |
| `primaryTableId` | String? | optional, self-FK → Table | ถ้าไม่ null แปลว่าโต๊ะนี้ถูก "รวม" เข้ากับโต๊ะหลัก — บิลทั้งหมดวิ่งไปที่ `primaryTableId` แทน |
| `createdAt` | DateTime | auto | เวลาสร้าง |
| `updatedAt` | DateTime | auto | เวลาแก้ไขล่าสุด |

#### TableSession
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `tableId` | String | FK → Table | โต๊ะหลักที่ session นี้เปิดอยู่ (โต๊ะที่ถูกรวมทุกโต๊ะชี้มาที่ session เดียวกันนี้ผ่านโต๊ะหลัก) |
| `qrCodeId` | String? | optional, FK → QRCode | QR ที่ใช้เปิดโต๊ะ (`null` ถ้าพนักงานเปิดเอง) |
| `openedAt` | DateTime | auto, **required** | เวลาที่ลูกค้านั่งโต๊ะ/เปิด session — ใช้แสดงทั้ง **"เวลาที่เปิดโต๊ะ"** และคำนวณ **"เปิดมาแล้วกี่นาที"** แบบ derived ณ เวลา render ทั้งในหน้าผังโต๊ะ (F11) และหน้าการแจ้งเตือน (F12) — ไม่มีฟิลด์ duration แยกต่างหาก |
| `status` | `TableSessionStatus` | default `OPEN` | `OPEN` / `AWAITING_BILL` / `CLOSED` / `CANCELLED` |
| `closedAt` | DateTime? | optional | เวลาปิดบิล (ชำระสำเร็จ) หรือยกเลิกโต๊ะ |
| `closedById` | String? | optional, FK → User | พนักงานที่ปิด/ยกเลิก (`null` ถ้าปิดอัตโนมัติจาก webhook) |
| `cancelReason` | String? | optional | เหตุผลถ้า "ยกเลิกโต๊ะ" ทั้งชุด (คนละกลไกกับ Void บิลใน F6 ซึ่งเกิดหลังจ่ายเงินแล้วเท่านั้น) |
| `saleId` | String? | optional, FK → Sale | ผูกกับบิลที่สร้างตอนปิด session (ชำระสำเร็จ) |
| `createdAt` | DateTime | auto | เวลาสร้าง |
| `updatedAt` | DateTime | auto | เวลาแก้ไขล่าสุด |

#### MenuItem
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `name` | String | required | ชื่อเมนู |
| `description` | String? | optional | คำอธิบาย |
| `price` | Decimal | ≥ 0 | ราคาตั้งต้น (ก่อนบวก modifier) |
| `imageUrl` | String? | optional | รูปเมนู |
| `isActive` | Boolean | default true | ปิดเมนูชั่วคราวได้โดยไม่ลบ |
| `isFeatured` | Boolean | default false | ปักหมุดเป็นเมนูแนะนำ — **สูงสุด 6 รายการที่ `isFeatured=true` พร้อมกัน** (validation ปฏิเสธรายการที่ 7) |
| `featuredSortOrder` | Int? | optional | ลำดับการแสดงในกลุ่มเมนูแนะนำ |
| `createdAt` | DateTime | auto | เวลาสร้าง |
| `updatedAt` | DateTime | auto | เวลาแก้ไขล่าสุด |

#### ModifierGroup
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `menuItemId` | String | FK → MenuItem | เมนูที่กลุ่มนี้สังกัด |
| `name` | String | required | เช่น "ระดับความเผ็ด", "ท็อปปิ้งเพิ่ม" |
| `selectionType` | `ModifierSelectionType` | enum {SINGLE, MULTIPLE} | radio หรือ checkbox |
| `required` | Boolean | default false | ต้องเลือกอย่างน้อย 1 ก่อนเพิ่มลงตะกร้าหรือไม่ |

#### ModifierOption
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `modifierGroupId` | String | FK → ModifierGroup | — |
| `name` | String | required | เช่น "เผ็ดน้อย", "ไข่ดาว" |
| `priceDelta` | Decimal | default 0, ≥ 0 | ราคาบวกเพิ่ม |

#### MobileOrder
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `tableSessionId` | String | FK → TableSession | session ที่ออร์เดอร์นี้สังกัด (1 session มีได้หลาย MobileOrder จากปุ่ม "สั่งเพิ่ม") |
| `orderNumber` | Int | auto-gen ต่อ session (1, 2, 3, …) | เลขรอบสั่งภายใน session เดียวกัน — ใช้แยกทิกเก็ตครัว |
| `submittedAt` | DateTime | auto | เวลาที่ลูกค้ากด "ยืนยันออร์เดอร์" |
| `printedAt` | DateTime? | optional | เวลาที่พิมพ์ทิกเก็ตครัวสำเร็จ (`null` = ยังพิมพ์ไม่สำเร็จ/รอ retry) |
| `createdAt` | DateTime | auto | เวลาสร้าง |

#### MobileOrderItem
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `mobileOrderId` | String | FK → MobileOrder | — |
| `menuItemId` | String | FK → MenuItem | — |
| `quantity` | Int | > 0 | — |
| `unitPrice` | Decimal | ≥ 0, snapshot | ราคาต่อหน่วยรวม modifier ณ เวลาสั่ง (**snapshot** — เหมือน `SaleItem.unitPrice` เดิม กันปัญหาแก้ราคาเมนูย้อนหลัง) |
| `selectedOptionsSnapshot` | Json | snapshot | รายการ modifier ที่เลือก ณ เวลาสั่ง `[{groupName, optionName, priceDelta}]` — snapshot ด้วยเหตุผลเดียวกับ `unitPrice` |
| `note` | String? | optional | โน้ตถึงครัว (free text ต่อรายการ) |
| `status` | `OrderItemStatus` | default `AWAITING_KITCHEN` | `AWAITING_KITCHEN` (รอครัวรับ) → `COOKING` (กำลังปรุง) → `READY` (พร้อมเสิร์ฟ) → `SERVED` (เสิร์ฟแล้ว) หรือ `CANCELLED` |
| `cancelledAt` | DateTime? | optional | เวลาที่ยกเลิกรายการนี้ |
| `cancelledById` | String? | optional, FK → User | พนักงานที่ยกเลิก |
| `cancelReason` | String? | optional | **อนุญาตให้ยกเลิกรายการเฉพาะตอน `status = AWAITING_KITCHEN` เท่านั้น** — บังคับด้วย conditional update ฝั่ง server (ดู §3) |
| `createdAt` | DateTime | auto | เวลาสร้าง |
| `updatedAt` | DateTime | auto | เวลาแก้ไขล่าสุด |

#### QRCode
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `tableId` | String | FK → Table | — |
| `type` | `QRCodeType` | enum {STATIC, DYNAMIC} | Static = แปะถาวรที่โต๊ะ, Dynamic = พนักงานพิมพ์ใหม่ทุกรอบลูกค้า |
| `token` | String | **unique**, required | ค่าสุ่มที่ฝังใน URL ลูกค้า (`/order/[token]`) — ไม่ใช่ `tableId` ตรง ๆ กันเดา URL |
| `status` | `QRCodeStatus` | default `ACTIVE` | `ACTIVE` / `INVALIDATED` |
| `invalidatedAt` | DateTime? | optional | เวลาที่ถูกยกเลิกใช้งาน |
| `issuedAt` | DateTime | auto | เวลาสร้าง/พิมพ์ QR นี้ |
| `createdAt` | DateTime | auto | เวลาสร้าง record |

#### Notification
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `tableSessionId` | String | FK → TableSession | ใช้ join ไปหา `TableSession.openedAt` เพื่อแสดง**เวลาที่เปิดโต๊ะ**และ**เปิดโต๊ะมาแล้วกี่นาที**บนหน้าการแจ้งเตือน (F12) — ไม่เก็บซ้ำเป็นฟิลด์ใหม่ |
| `type` | `NotificationType` | enum {CALL_STAFF, CHECK_BILL} | — |
| `reason` | String? | optional | ข้อความ preset chip หรือ free text (เฉพาะ CALL_STAFF) |
| `status` | `NotificationStatus` | default `PENDING` | `PENDING` (แถบด่วน-ยังไม่รับทราบ) / `ACKNOWLEDGED` |
| `acknowledgedAt` | DateTime? | optional | — |
| `acknowledgedById` | String? | optional, FK → User | — |
| `createdAt` | DateTime | auto | ใช้คำนวณเวลาสัมพัทธ์ของการแจ้งเตือนเอง (เช่น "8 นาทีที่แล้ว") — **คนละอันกับเวลาเปิดโต๊ะ** |

#### LineNotificationLog
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `tableSessionId` | String | FK → TableSession | — |
| `type` | `LineNotificationType` | enum {ORDER_CONFIRMED, FOOD_READY, PAYMENT_SUCCESS} | — |
| `lineUserId` | String? | optional | LINE user id ปลายทาง (`null` ถ้าลูกค้าไม่ได้ผูก LINE) |
| `sentAt` | DateTime | auto | — |
| `success` | Boolean | required | ส่งไม่สำเร็จไม่กระทบ transaction หลัก (ดู §3) |
| `errorMessage` | String? | optional | สำหรับ debug เวลาส่งไม่สำเร็จ |

#### StoreSettings *(singleton — มีแถวเดียวในระบบ, `id` คงที่)*
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK, fixed = `"default"` | บังคับให้มี 1 แถวเท่านั้น |
| `storeName` | String | required | ชื่อร้านที่แสดงหน้าลูกค้า |
| `logoUrl` | String? | optional | โลโก้ร้าน |
| `coverImageUrl` | String? | optional | รูปปกหน้าเมนู |
| `themeColor` | String | required | สีธีมหลัก |
| `hasKDS` | Boolean | default false | สลับเส้นทางสถานะครัว (มี KDS vs manual, ดู §3) — **ห้ามเปลี่ยนขณะมี `TableSession.status = OPEN` อยู่อย่างน้อย 1 โต๊ะ** |
| `serviceChargePercent` | Decimal | default 0 | ค่าบริการ % ที่บวกตอนปิดบิล |
| `crmEnabled` | Boolean | default false | เปิด/ปิดฟีเจอร์สมัครสมาชิก |
| `updatedAt` | DateTime | auto | — |
| `updatedById` | String? | optional, FK → User | — |

#### Member *(CRM MVP)*
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `phone` | String | **unique**, required | ใช้แทนบัญชี (สมัครด้วยเบอร์อย่างเดียว — เบอร์ซ้ำ = login เข้าบัญชีเดิม) |
| `pointBalance` | Int | default 0, ≥ 0 | denormalized — อัปเดตคู่กับ `MemberPointTransaction` ใน `prisma.$transaction` เดียวกันเสมอ (เหมือน `Product.quantity`) |
| `lineUserId` | String? | optional | ผูกกับ LINE ถ้ามี |
| `createdAt` | DateTime | auto | — |

#### MemberPointTransaction
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `memberId` | String | FK → Member | — |
| `saleId` | String | FK → Sale | บิลที่ทำให้ได้แต้ม |
| `points` | Int | > 0 | v1 มีแค่ "ได้แต้ม" (earn) — **การใช้แต้มแลก (redemption) อยู่นอกขอบเขต v1** ดู [§7](#7-out-of-scope-v1) |
| `createdAt` | DateTime | auto | — |

### Role
> ⛔ **นอกขอบเขต v1** — พิมพ์เขียวสำหรับเฟสถัดไป (ดู [§7 Out of Scope](#7-out-of-scope-v1))
> ครอบคลุมตั้งแต่ `Role` จนถึง `Better Auth — ส่วนขยาย User` ด้านล่างนี้ — ยังไม่สร้างตารางเหล่านี้ใน v1

| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `name` | String | **unique**, required | ชื่อบทบาท เช่น ผู้ดูแลระบบ, ผู้จัดการร้าน, แคชเชียร์ |
| `description` | String? | optional | คำอธิบายบทบาท |
| `isSystem` | Boolean | default false | บทบาทของระบบ (เช่น "ผู้ดูแลระบบ") — แก้ชื่อ/ลบไม่ได้ |
| `createdAt` | DateTime | auto | เวลาสร้าง |
| `updatedAt` | DateTime | auto | เวลาแก้ไขล่าสุด |

### RolePermission
| ฟิลด์ | ชนิด | เงื่อนไข | คำอธิบาย |
|---|---|---|---|
| `id` | String | PK | รหัสภายในระบบ |
| `roleId` | String | FK → Role | บทบาทที่สิทธิ์นี้สังกัด |
| `resource` | `ResourceKey` | required | หน้า/โมดูลที่กำหนดสิทธิ์ (เช่น PRODUCTS, POS, USERS) |
| `actions` | `PermissionAction[]` | subset of {VIEW,ADD,EDIT,DELETE} | ชุดสิทธิ์ที่มีต่อ resource นี้ — `[VIEW,ADD,EDIT,DELETE]` = "Full", `[VIEW]` = "Readonly", `[]` = ไม่มีสิทธิ์ (ซ่อนเมนู) |
| **unique** | | `(roleId, resource)` | 1 resource มีได้แค่ 1 แถวต่อ role |

### Better Auth — ส่วนขยาย User
- เพิ่มฟิลด์ `roleId String?` ให้ตาราง `user` ของ Better Auth ผ่าน `additionalFields` (server config) แล้ว sync
  เข้า Prisma schema ด้วย `npx @better-auth/cli generate` — FK ไปยัง `Role`, nullable (ผู้ใช้ใหม่ยังไม่มี role)

### Enum
```prisma
enum TransactionType {
  IN
  OUT
}

enum PaymentMethod {
  CASH
  TRANSFER
  QR         // เดิม — คีย์ยอดด้วยมือ ไม่มีการยืนยันจริง (retail POS)
  PROMPTPAY  // ใหม่ — MJD Mobile Order เท่านั้น, ยืนยันผ่าน bank webhook อัตโนมัติ
  CARD       // ใหม่ — MJD Mobile Order เท่านั้น, EDC ที่เคาน์เตอร์ พนักงานกดยืนยันด้วยมือ (ไม่ใช่ payment gateway ในแอป)
}

enum SaleStatus {
  COMPLETED
  VOIDED
}

enum SaleChannel {
  RETAIL_POS
  MOBILE_ORDER
}

enum TableStatus {
  EMPTY
  OPEN_NO_ORDER
  ORDERED
  AWAITING_BILL
  OCCUPIED_MERGED   // โต๊ะที่ถูกรวมเข้ากับโต๊ะหลัก — สั่งของเองไม่ได้อีกต่อไป
}

enum TableSessionStatus {
  OPEN
  AWAITING_BILL
  CLOSED
  CANCELLED
}

enum OrderItemStatus {
  AWAITING_KITCHEN
  COOKING
  READY
  SERVED
  CANCELLED
}

enum QRCodeType {
  STATIC
  DYNAMIC
}

enum QRCodeStatus {
  ACTIVE
  INVALIDATED
}

enum NotificationType {
  CALL_STAFF
  CHECK_BILL
}

enum NotificationStatus {
  PENDING
  ACKNOWLEDGED
}

enum LineNotificationType {
  ORDER_CONFIRMED
  FOOD_READY
  PAYMENT_SUCCESS
}

enum ModifierSelectionType {
  SINGLE
  MULTIPLE
}

// ⛔ enum ต่อไปนี้อยู่นอกขอบเขต v1 — พิมพ์เขียวสำหรับเฟสถัดไป (ดู §7 Out of Scope)
enum PermissionAction {
  VIEW
  ADD
  EDIT
  DELETE
}

// ⛔ นอกขอบเขต v1
enum ResourceKey {
  DASHBOARD
  PRODUCTS
  CATEGORIES
  STOCK_IN
  STOCK_OUT
  POS
  POS_HISTORY
  POS_CLOSING
  REPORTS
  USERS
}
```

### ความสัมพันธ์ & กติกา
- `Category 1 — * Product` (หมวดหมู่หนึ่งมีสินค้าได้หลายรายการ) — **ลบหมวดหมู่ไม่ได้ถ้ายังมีสินค้าผูกอยู่**
- `Product 1 — * StockTransaction` (สินค้าหนึ่งมีได้หลายรายการเคลื่อนไหว)
- `Product 1 — * SaleItem`, `Sale 1 — * SaleItem`, `Sale 1 — * StockTransaction` (ผ่าน `saleId`)
- `User 1 — * CashierClosing` (แคชเชียร์หนึ่งคนปิดยอดได้วันละ 1 ครั้ง — unique `(cashierId, closingDate)`)
- ⛔ *(นอกขอบเขต v1)* `Role 1 — * RolePermission` (บทบาทหนึ่งมีสิทธิ์ได้หลาย resource แต่ resource ละไม่เกิน 1 แถว)
- ⛔ *(นอกขอบเขต v1)* `Role 1 — * User` (ผู้ใช้หนึ่งคนมีได้ 1 บทบาท ผ่าน `User.roleId`) — **ลบ Role ไม่ได้ถ้ายังมีผู้ใช้ผูกอยู่**
- ทุกครั้งที่บันทึก `StockTransaction`:
  - `type = IN`  → `product.quantity += quantity`
  - `type = OUT` → `product.quantity -= quantity` **โดยต้อง `quantity ≤ product.quantity`**
- การเขียน `StockTransaction` + อัปเดต `Product.quantity` ต้องอยู่ใน `prisma.$transaction` เดียวกัน (atomic)
  — กติกานี้ใช้ทั้งกับ Stock In/Out ที่คีย์ด้วยมือ และกับ POS checkout/void
- `StockTransaction` เป็น ledger ที่ไม่ลบ/แก้ย้อนหลัง — ใช้เป็นประวัติการเคลื่อนไหว การ void บิลขาย
  **ไม่ลบ/แก้ transaction OUT เดิม** แต่สร้าง transaction IN ใหม่มาชดเชยเสมอ
- `Table 1 — * QRCode` (โต๊ะหนึ่งมีได้หลาย QR ตลอดอายุการใช้งาน แต่**ใช้งานพร้อมกันได้แค่ 1 ใบต่อโต๊ะ** — สร้างใบใหม่
  ต้อง invalidate ใบเก่าก่อนถ้าเป็น DYNAMIC)
- `Table 1 — * Table` ผ่าน `primaryTableId` (self-relation, ใช้ทำ "รวมโต๊ะ") — โต๊ะรองมี `primaryTableId` ชี้โต๊ะหลัก,
  `status = OCCUPIED_MERGED`, **สั่งของ/เปิด session เองไม่ได้จนกว่าจะถูก unmerge**
- `Table 1 — * TableSession`, `TableSession 1 — * MobileOrder`, `MobileOrder 1 — * MobileOrderItem`
- `TableSession 1 — 0..1 Sale` (ปิดบิลสำเร็จแล้วจึงมี — ก่อนหน้านั้นยอดคำนวณสดจาก `MobileOrderItem` ที่ยังไม่ถูกยกเลิก)
- `TableSession 1 — * Notification` — หน้า UI join กลับไปหา `openedAt` เสมอเพื่อแสดงเวลาเปิดโต๊ะ/ระยะเวลาเปิดโต๊ะ
- `MenuItem 1 — * ModifierGroup`, `ModifierGroup 1 — * ModifierOption`
- `Member 1 — * MemberPointTransaction`, `Sale 1 — 0..1 MemberPointTransaction`
- ทุกครั้งที่เปลี่ยน `OrderItemStatus` จาก `AWAITING_KITCHEN` เป็นอย่างอื่น (`COOKING`/`SERVED`/`CANCELLED`) ต้องเช็ค
  ใน `prisma.$transaction` ว่า**สถานะปัจจุบันยังเป็น `AWAITING_KITCHEN` จริง**ก่อนเขียนทับ (conditional update ไม่ใช่
  blind overwrite) — ป้องกัน race ระหว่างครัวกดเริ่มทำกับพนักงานกดยกเลิกพร้อมกัน
- ทุกครั้งที่บันทึก `MemberPointTransaction`: `member.pointBalance += points` อยู่ใน `prisma.$transaction` เดียวกัน
  เสมอ (เหมือนกติกา `StockTransaction` เดิม)

---

## 3. กติกาธุรกิจ POS โดยละเอียด (Business Rules)

### Checkout (สร้างบิลขาย)
ทำใน `prisma.$transaction` เดียวกันทั้งหมด (เหมือน pattern Stock Out เดิม):

1. ตรวจทุกบรรทัดในตะกร้าว่า `quantity ≤ product.quantity` (reuse ตรรกะกันเบิกเกินจาก F3) — ถ้าบรรทัดใดไม่ผ่าน
   **ปฏิเสธทั้งบิล ไม่ตัดสต็อกบางส่วน**
2. สร้าง `Sale` (คำนวณ `subtotal`, `total`, `changeDue`) + `SaleItem[]` (snapshot `unitPrice` ปัจจุบันของสินค้า)
3. สร้าง `StockTransaction(type=OUT, saleId=sale.id, quantity, note="ขายหน้าร้าน <saleNumber>")` ต่อบรรทัด
4. ลด `product.quantity` ของแต่ละสินค้าตามจำนวนที่ขาย

ถ้าขั้นตอนใดล้มเหลว ทั้ง transaction ต้อง rollback ทั้งหมด (atomic เหมือน F2/F3 เดิม)

### การคำนวณเงินทอน
- `paymentMethod = CASH`: บังคับกรอก `amountReceived ≥ total`, ระบบคำนวณ `changeDue = amountReceived - total`
  แบบ real-time บนหน้าจอ
- `paymentMethod = TRANSFER | QR`: `amountReceived = total` เสมอ, `changeDue = 0` (ไม่มีการรับเงินสดเกิน)

### Void บิล (ยกเลิกบิล — เฉพาะวันเดียวกัน)
- อนุญาตเฉพาะบิลที่ `createdAt` อยู่ในวันปฏิทินเดียวกับเวลาที่กด void (เทียบ server time)
- ทำใน `prisma.$transaction` เดียวกัน:
  1. ตรวจ `status = COMPLETED` และอยู่ในวันเดียวกัน มิฉะนั้นปฏิเสธพร้อมข้อความชัดเจน
  2. set `status = VOIDED`, `voidedAt = now()`, `voidedById = <session user>`, `voidReason`
  3. สร้าง `StockTransaction(type=IN, saleId=sale.id, quantity, note="ยกเลิกบิล <saleNumber>")` ต่อบรรทัดของ
     `SaleItem` เพื่อคืนสต็อก
  4. เพิ่ม `product.quantity` กลับตามจำนวนที่คืน
- **ห้ามลบหรือแก้ไข `StockTransaction(OUT)` เดิม** — คงหลัก ledger append-only
- บิล `VOIDED` **ไม่นับรวม** ในยอดขาย Dashboard/Reports แต่ยังคงแสดงในประวัติการขายพร้อม badge สถานะ

### ส่วนลด
- ระดับท้ายบิลเท่านั้น (v1 ไม่มีส่วนลดรายสินค้า) หน่วยเป็นบาท, ต้อง `0 ≤ discount ≤ subtotal`

### หมวดหมู่สินค้า (Category)
- หมวดหมู่เป็น master data แยกต่างหาก ไม่ใช่ข้อความอิสระในฟอร์มสินค้าอีกต่อไป — ผู้ใช้เลือกจาก dropdown เท่านั้น
- ชื่อหมวดหมู่ต้องไม่ซ้ำ (unique) มิฉะนั้น validation ปฏิเสธ
- ลบหมวดหมู่ที่ยังมีสินค้าผูกอยู่ไม่ได้ — ต้องย้ายสินค้าออกจากหมวดหมู่นั้นก่อน (reassign เป็นหมวดหมู่อื่น) ระบบแจ้ง
  จำนวนสินค้าที่ผูกอยู่เมื่อลบไม่สำเร็จ

### ปิดการขายประจำวัน (Cashier Daily Closing)
- ปิดยอดได้ **1 ครั้งต่อแคชเชียร์ต่อวัน** (unique `(cashierId, closingDate)`) — ปิดซ้ำวันเดิมไม่ได้
- ระบบคำนวณสรุปยอดขายอัตโนมัติจาก `Sale` ของแคชเชียร์คนนั้นในวันนั้น (นับเฉพาะ `status = COMPLETED`): ยอดขายรวม,
  แยกตามวิธีชำระเงิน (เงินสด/โอน/QR), จำนวนบิล, จำนวนบิลที่ถูก void
- แคชเชียร์กรอกจำนวนเงินสดที่นับได้จริง (`countedCash`) ระบบคำนวณส่วนต่าง `difference = countedCash - totalCash`
  อัตโนมัติ (ค่าบวก = เงินเกิน, ค่าลบ = เงินขาด) — **v1 ไม่รวมเงินสดตั้งต้น/เปิดกะ** คำนวณจากยอดขายเงินสดวันนั้นล้วนๆ
- เมื่อปิดยอดของวันนั้นแล้ว **ห้าม void บิลของแคชเชียร์คนนั้นในวันนั้นอีก** (แม้ยังอยู่ในวันเดียวกันตามกติกา F6) เพื่อ
  ป้องกันตัวเลขที่ปิดยอดไปแล้วคลาดเคลื่อน
- บันทึกการปิดยอด (`CashierClosing`) เป็นข้อมูล immutable — แก้ไข/ลบไม่ได้ผ่านหน้า UI ปกติ

### MJD Mobile Order — กติกาธุรกิจ

#### เปิด/ปิด/รวมโต๊ะ (Table Session Lifecycle)
- สแกน QR (`STATIC` หรือ `DYNAMIC` ที่ `status = ACTIVE`) ที่โต๊ะ `status = EMPTY` → สร้าง `TableSession(status=OPEN,
  openedAt=now())` ใหม่ทันที ไม่ต้องรอพนักงานเปิดโต๊ะก่อน และตั้ง `Table.status = OPEN_NO_ORDER`
- สแกนซ้ำที่โต๊ะที่มี session `OPEN`/`AWAITING_BILL` อยู่แล้ว → พาไปที่ session เดิม (ไม่สร้างซ้ำ)
- **รวมโต๊ะ**: พนักงานเลือกโต๊ะรอง (ต้อง `status = EMPTY`) → ตั้ง `secondaryTable.primaryTableId = primaryTable.id`,
  `secondaryTable.status = OCCUPIED_MERGED` — ออร์เดอร์/บิลทั้งหมดหลังจากนี้วิ่งเข้า `TableSession` ของโต๊ะหลัก
  เท่านั้น โต๊ะรอง**สั่งของเองไม่ได้**อีก (QR ของโต๊ะรองถ้าถูกสแกนให้ redirect ไปที่ session ของโต๊ะหลัก)
- **ยกเลิกการรวมโต๊ะ** ทำได้เฉพาะตอน session ของโต๊ะหลักยังไม่ปิดบิล — คืนโต๊ะรองเป็น `EMPTY`, ล้าง `primaryTableId`
- ปิดบิลสำเร็จ (ดูหัวข้อการชำระเงินด้านล่าง) → ทั้งโต๊ะหลักและโต๊ะรองทั้งหมดที่ผูกอยู่กลับเป็น `EMPTY` พร้อมกันใน
  transaction เดียว
- "ยกเลิกโต๊ะ" (ปุ่มทั้งชุดจากหน้ารายละเอียดออร์เดอร์ต่อโต๊ะ) → `TableSession.status = CANCELLED`, cascade ยกเลิก
  ทุก `MobileOrderItem` ที่ยัง `AWAITING_KITCHEN`/`COOKING`/`READY`, **ไม่สร้าง Sale** (ยังไม่มีการจ่ายเงิน) —
  คนละกลไกกับการ Void บิล (F6) ซึ่งเกิดหลังจ่ายเงินแล้วเท่านั้น

#### สถานะรายการอาหารและการยกเลิกรายรายการ
- `AWAITING_KITCHEN → COOKING`: เฉพาะร้านที่ `StoreSettings.hasKDS = true` และครัวกด "เริ่มทำ" บน KDS
- `COOKING → READY`: ครัวกด "เสร็จ/พร้อมเสิร์ฟ" บน KDS
- ร้านที่ `hasKDS = false`: **ไม่มีสถานะ `COOKING`/`READY` อัตโนมัติ** — พนักงานหน้าร้านกด "เสิร์ฟอาหารแล้ว" บนหน้า
  รายละเอียดออร์เดอร์ต่อโต๊ะ เปลี่ยนจาก `AWAITING_KITCHEN` ตรงไป `SERVED` ทันที
- **ยกเลิกรายการอาหารทีละรายการอนุญาตเฉพาะตอน `status = AWAITING_KITCHEN` เท่านั้น** — ปุ่มยกเลิกใน UI ต้องถูก
  ซ่อน/ปิดทันทีที่สถานะเปลี่ยนเป็น `COOKING` ขึ้นไป และฝั่ง server ต้องปฏิเสธ (conditional update ที่ `WHERE`
  ทับสถานะ) แม้ UI ไม่ทันอัปเดต — pattern เดียวกับกันขายเกินสต็อกใน F3/F5

#### QR Code วงจรชีวิต
- `STATIC`: ไม่มีวันถูก invalidate อัตโนมัติ — ใช้ซ้ำได้ทุกรอบลูกค้า เหมาะกับร้านทั่วไป
- `DYNAMIC`: ถูกตั้ง `status = INVALIDATED` **อัตโนมัติทันทีที่ปิดบิลสำเร็จ** (ในทรานแซคชันเดียวกับปิด
  `TableSession`) — เหมาะกับร้านที่คุมรอบโต๊ะเข้มงวด (บุฟเฟต์) เพราะ QR ใบเดิมใช้สั่งของไม่ได้อีก ต้องให้พนักงาน
  พิมพ์ใบใหม่ก่อนลูกค้ารอบถัดไปนั่ง
- สแกน QR ที่ `status = INVALIDATED` → หน้าลูกค้าแสดงข้อความ "กรุณาแจ้งพนักงานให้เปิดโต๊ะใหม่" ไม่สร้าง session
  ใหม่เอง

#### การแจ้งเตือนพนักงาน (Call Staff / Check Bill)
- ทั้งการ์ดในหน้า**ผังโต๊ะ (F11)** และการ์ดในหน้า**การแจ้งเตือน (F12)** ต้องแสดง **2 จุดเพิ่มเติมเสมอ**: (1) เวลาที่
  เปิดโต๊ะ (`TableSession.openedAt` format นาฬิกา เช่น "14:32") และ (2) เปิดโต๊ะมาแล้วกี่นาที (คำนวณ
  `now() - openedAt` แบบ derived, refresh ทุกนาทีบน client) — **ไม่ใช่ฟิลด์ schema ใหม่** ทั้งคู่มาจาก join
  `Notification.tableSessionId → TableSession.openedAt` ที่มีอยู่แล้ว
- `Notification` ที่ `status = PENDING` แสดงในโซน "ด่วน-ยังไม่รับทราบ" พร้อม badge เด่น; กด "รับทราบ" →
  `ACKNOWLEDGED`, ย้ายไปโซนล่าง — การรับทราบไม่ลบสถานะฐาน (`ORDERED`/`AWAITING_BILL`) ของโต๊ะ เป็นแค่ badge
  ซ้อนทับ

#### การชำระเงินและปิดบิลอัตโนมัติ
- **PromptPay**: server สร้าง QR ชำระเงินตอนลูกค้ากด "ชำระเงิน" → bank webhook ยิงกลับมายืนยัน (ต้อง idempotent
  ด้วย unique payment reference กันยิงซ้ำ) → สร้าง `Sale(channel=MOBILE_ORDER, paymentMethod=PROMPTPAY)` +
  `SaleItem[]` จากรายการที่ไม่ถูกยกเลิก → ปิด `TableSession` อัตโนมัติทันที ไม่ต้องรอพนักงาน
- **Card/EDC**: พนักงานกดยืนยัน "ชำระด้วยบัตรสำเร็จแล้ว" หลังเครื่อง EDC ที่เคาน์เตอร์ตัดบัตรจริงนอกระบบ → สร้าง
  `Sale(paymentMethod=CARD)` เหมือนกัน แล้วปิดโต๊ะ
- บวก `serviceChargePercent` จาก `StoreSettings` เข้า `Sale.subtotal` ก่อนคำนวณ `total` ถ้า > 0
- ปิดโต๊ะสำเร็จ (ทั้งสองวิธี) → invalidate DYNAMIC QR + คืนสถานะโต๊ะทั้งหมดในกลุ่มรวมเป็น `EMPTY` ในทรานแซคชันเดียว

#### LINE Notification
- ส่ง `ORDER_CONFIRMED` ทันทีที่ `MobileOrder` ถูกสร้าง (ลูกค้ากดยืนยันออร์เดอร์)
- ส่ง `FOOD_READY` เมื่อรายการเปลี่ยนเป็น `READY` (มี KDS) **หรือ** `SERVED` โดยตรงจาก `AWAITING_KITCHEN` (ไม่มี
  KDS) — สองเส้นทางส่งข้อความ push ประเภทเดียวกัน เพราะความหมายที่ลูกค้าเห็นเหมือนกัน ("อาหารพร้อม/เสิร์ฟแล้ว")
- ส่ง `PAYMENT_SUCCESS` ทันทีที่ปิดบิลสำเร็จ (ทั้ง PromptPay/Card)
- ทุกครั้งบันทึก `LineNotificationLog` พร้อม `success` — ส่งไม่สำเร็จไม่ทำให้ transaction การชำระเงิน/ปิดบิล fail
  (LINE เป็น best-effort ไม่ใช่ source of truth)

#### CRM/สมาชิก (MVP)
- สมัครด้วยเบอร์โทรอย่างเดียว บนหน้า payment-success — เบอร์ซ้ำ = login เข้าบัญชีเดิม ไม่ใช่สร้างซ้ำ
- ให้แต้มอัตโนมัติทันทีที่ `Sale` ที่มี `tableSessionId` ที่ลูกค้าคนนั้นผูกไว้ถูกสร้าง (อัตราแต้มกำหนดเป็นค่าคงที่
  config ได้ เช่น 1 แต้ม/25 บาท)
- **v1 ไม่มีการใช้แต้มแลกส่วนลด/ของรางวัล (redemption)** — ดู [§7](#7-out-of-scope-v1)

---

## 4. ระบบสิทธิ์ผู้ใช้ (Better Auth + Role-Based Permission)

> ⛔ **ทั้งหัวข้อนี้อยู่นอกขอบเขต v1** — พิมพ์เขียวสำหรับเฟสถัดไป (ดู [§7 Out of Scope](#7-out-of-scope-v1))
> ใน v1 ผู้ใช้ทุกคนที่ล็อกอินสำเร็จเข้าถึงได้ทุกหน้าและทำได้ทุก action เท่ากัน

เมื่อยกมาทำจริง ทุกหน้า/ทุกฟีเจอร์ในเอกสารนี้ (F1–F9) จะถูกครอบด้วยชั้นสิทธิ์นี้เพิ่มเติม — ตรรกะธุรกิจของแต่ละ
ฟีเจอร์ไม่เปลี่ยน เพียงแต่ผู้ใช้ต้อง**มีสิทธิ์ที่เหมาะสมก่อนถึงจะเข้าหน้า/กดปุ่มนั้นได้**

### หลักการ
- ใช้ **Better Auth** เป็น authentication เหมือนเดิม (login/register/forgot-password/reset-password + session)
  แล้วต่อยอด **authorization** ด้วย `Role` + `RolePermission` ของระบบเอง โดยเพิ่ม `roleId` เข้าไปในตาราง
  `user` ของ Better Auth ผ่าน `additionalFields`
- แต่ละหน้า/โมดูล (`ResourceKey`) กำหนดสิทธิ์ได้ 4 ระดับย่อยที่**เลือกได้อิสระเป็นชุด** (`PermissionAction[]`):
  **View** (ดู/เข้าหน้าได้) · **Add** (สร้างใหม่) · **Edit** (แก้ไข/อัปเดต) · **Delete** (ลบ/ยกเลิก)
  — หน้าจัดการ Role มีปุ่มลัด **"Full"** (เลือกครบทั้ง 4) และ **"Readonly"** (เลือกเฉพาะ View) ให้กดรวดเดียว
  แทนการติ๊กทีละช่อง
- action ที่ไม่มีความหมายกับบาง resource ถูก **disable ในตาราง matrix** ไม่ให้เลือก (ดูตารางด้านล่าง) เพราะ
  ฝืนกติกาเดิมของระบบ (เช่น ledger ที่แก้/ลบย้อนหลังไม่ได้)

### Action ที่มีความหมายต่อแต่ละหน้า
| Resource | View | Add | Edit | Delete | หมายเหตุ |
|---|---|---|---|---|---|
| `DASHBOARD` | ✅ | – | – | – | ดูอย่างเดียวเสมอ |
| `PRODUCTS` | ✅ | ✅ | ✅ | ✅ | CRUD ครบตาม F1 |
| `CATEGORIES` | ✅ | ✅ | ✅ | ✅ | CRUD ครบตาม F8 |
| `STOCK_IN` | ✅ | ✅ | – | – | ledger ไม่ลบ/แก้ย้อนหลัง (F2) |
| `STOCK_OUT` | ✅ | ✅ | – | – | ledger ไม่ลบ/แก้ย้อนหลัง (F3) |
| `POS` | ✅ | ✅ | – | – | Add = ทำการขาย/checkout (F5) |
| `POS_HISTORY` | ✅ | – | – | ✅ | Delete = สิทธิ์กดปุ่ม **Void** บิล (F6) |
| `POS_CLOSING` | ✅ | ✅ | – | – | Add = สิทธิ์กดปิดยอด (F9) |
| `REPORTS` | ✅ | – | – | – | ดูอย่างเดียวเสมอ (F7) |
| `USERS` | ✅ | ✅ | ✅ | ✅ | Edit ครอบคลุมการเปลี่ยน Role ผู้ใช้อื่นด้วย — หน้า `/roles` ใช้สิทธิ์ `USERS:EDIT` เดียวกัน ไม่มี resource แยก |

### บทบาทเริ่มต้น (seed)
| บทบาท | สรุปสิทธิ์ |
|---|---|
| **ผู้ดูแลระบบ** (`isSystem=true`) | Full ทุก resource รวม `USERS` — แก้ชื่อ/ลบบทบาทนี้ไม่ได้ |
| **ผู้จัดการร้าน** | Full บน `DASHBOARD/PRODUCTS/CATEGORIES/STOCK_IN/STOCK_OUT/POS/POS_HISTORY/POS_CLOSING/REPORTS`, Readonly บน `USERS` |
| **แคชเชียร์** | Full บน `POS/POS_HISTORY/POS_CLOSING`, Readonly บน `DASHBOARD/PRODUCTS/CATEGORIES/REPORTS`, ไม่มีสิทธิ์ (`[]`) บน `STOCK_IN/STOCK_OUT/USERS` → เมนูเหล่านี้ไม่แสดง |

### กติกาบังคับใช้ (Enforcement)
- ตรวจสิทธิ์ **2 ชั้นเสมอ**: (1) **Page guard** ฝั่ง server เช็ค `VIEW` ก่อน render ทุกหน้า — ไม่ผ่าน → redirect ไป
  หน้า Access Denied และซ่อนเมนูนั้นออกจาก Sidebar ทันที (2) **Action guard** ทุก Server Action ที่มีผลต่อข้อมูล
  ต้องเช็ค `ADD`/`EDIT`/`DELETE` ของ resource นั้นก่อนทำงานเสมอ — ห้ามพึ่งพา UI ฝั่ง client (ปุ่มซ่อน/ปิด) อย่าง
  เดียว เพราะ Server Action ถูกเรียกตรงได้
- ปุ่ม "เพิ่ม/แก้ไข/ลบ" ในแต่ละหน้าแสดงเฉพาะเมื่อผู้ใช้มีสิทธิ์ action ที่ตรงกันของ resource นั้น
- ผู้ใช้ที่ `roleId = null` (ยังไม่ถูกกำหนดบทบาท) เข้าถึงได้เฉพาะ `/settings` (แก้โปรไฟล์ตัวเอง) — หน้าอื่นทั้งหมด
  ถือว่าไม่มีสิทธิ์ `VIEW` โดยปริยาย
- เปลี่ยน Role ของผู้ใช้แล้วมีผลทันทีในคำขอถัดไป (ตรวจสิทธิ์จาก DB สดทุกครั้ง ไม่ cache ข้ามคำขอนานเกินควร)
- **ห้ามลบหรือแก้บทบาท `isSystem=true`** และ **ห้ามลบ/เปลี่ยน Role ของผู้ใช้คนสุดท้ายที่เป็น "ผู้ดูแลระบบ"**
  เพื่อกันระบบเหลือผู้ใช้ 0 คนที่จัดการสิทธิ์ได้

---

## 5. ฟีเจอร์ทั้งหมด + Acceptance Criteria

### F1 — จัดการสินค้า (Product CRUD)
สร้าง / อ่าน / แก้ไข / ลบ สินค้า พร้อม SKU

**Acceptance Criteria**
- [x] สร้างสินค้าใหม่ได้ โดยระบุ name, category, unit, price, reorderPoint
- [x] SKU สร้างอัตโนมัติแบบไม่ซ้ำ (`SKU-1001`, `SKU-1002`, …) หรือผู้ใช้กรอกเองได้
- [x] บันทึก SKU ซ้ำ → ระบบปฏิเสธพร้อมข้อความแจ้งเตือน
- [x] แสดงรายการสินค้าทั้งหมด พร้อมค้นหา/กรองตามชื่อหรือหมวดหมู่
- [x] แก้ไขข้อมูลสินค้าได้ (ยกเว้นการแก้ quantity ตรง ๆ — ต้องผ่าน Stock In/Out หรือ POS)
- [x] ลบสินค้าได้ พร้อมยืนยันก่อนลบ
- [x] ฟิลด์ตัวเลข (price, reorderPoint) ต้องเป็นค่าไม่ติดลบ มิฉะนั้น validation ปฏิเสธ

### F2 — รับสินค้าเข้าคลัง (Stock In)
บันทึกการรับสินค้าและเพิ่มยอดคงเหลือ

**Acceptance Criteria**
- [x] เลือกสินค้า + ระบุจำนวน (> 0) + หมายเหตุ (optional) แล้วบันทึกได้
- [x] บันทึกสำเร็จ → สร้าง `StockTransaction(type=IN)` และ `product.quantity` เพิ่มขึ้นตามจำนวน
- [x] การสร้างรายการ + อัปเดตยอด อยู่ใน transaction เดียว (ล้มเหลวพร้อมกันทั้งคู่ถ้ามี error)
- [x] จำนวน ≤ 0 → validation ปฏิเสธ

### F3 — เบิกจ่ายสินค้า (Stock Out) + กันเบิกเกิน
บันทึกการเบิกและลดยอดคงเหลือ โดยห้ามเบิกเกินที่มี

**Acceptance Criteria**
- [x] เลือกสินค้า + ระบุจำนวน (> 0) + หมายเหตุ (ผู้เบิก/แผนก/เหตุผล) แล้วบันทึกได้
- [x] **ถ้า `quantity > product.quantity` → ระบบปฏิเสธ ไม่ตัดสต็อก และไม่สร้าง transaction** พร้อมข้อความชัดเจน
- [x] บันทึกสำเร็จ → สร้าง `StockTransaction(type=OUT)` และ `product.quantity` ลดลงตามจำนวน
- [x] การตรวจยอด + สร้างรายการ + หักสต็อก อยู่ใน `prisma.$transaction` เดียวกัน (กัน race condition)
- [x] ยอดคงเหลือหลังเบิกต้องไม่ติดลบเสมอ

### F4 — Dashboard + แจ้งเตือนสินค้าใกล้หมด
ภาพรวมสต็อกและรายการที่ต้องเติม

**Acceptance Criteria**
- [x] แสดงสรุป: จำนวนสินค้าทั้งหมด, มูลค่าสต็อกรวม (Σ quantity × price), จำนวนรายการใกล้หมด
- [x] แสดงรายการสินค้าที่ `quantity ≤ reorderPoint` เป็นการ์ด/ตารางแจ้งเตือน
- [x] มี Badge/ตัวเลขนับจำนวนสินค้าใกล้หมดใน navigation
- [x] แสดงรายการเคลื่อนไหวล่าสุด (recent transactions)
- [x] เมื่อ Stock In จนเกิน reorderPoint แล้ว รายการนั้นหลุดจากการแจ้งเตือนทันที

### F5 — ขายหน้าร้าน (POS Checkout)
- [x] เพิ่มสินค้าลงตะกร้าได้ (ค้นหาด้วยชื่อ/SKU), ปรับจำนวน/ลบรายการก่อน checkout จริง
- [x] ใส่ส่วนลดท้ายบิลได้ (บาท), ระบบตรวจ `0 ≤ discount ≤ subtotal`
- [x] เลือกวิธีชำระเงิน CASH/TRANSFER/QR ได้; กรณี CASH คำนวณเงินทอนถูกต้อง real-time
- [x] Checkout เป็น `prisma.$transaction` เดียว: สร้าง Sale+SaleItem + สร้าง StockTransaction(OUT) + ลด quantity พร้อมกัน
- [x] **ถ้าบรรทัดใดในตะกร้าขอจำนวนเกินสต็อกที่มี → ปฏิเสธทั้งบิล ไม่ตัดสต็อกบางส่วน** พร้อมข้อความชัดเจนว่าสินค้าใดไม่พอ
- [x] หลัง checkout สำเร็จ แสดงใบเสร็จบนหน้าจอและพิมพ์ผ่าน browser ได้
- [x] เลขที่บิล (`saleNumber`) ไม่ซ้ำกันเสมอ แม้ขายพร้อมกันหลาย session (auto-gen ปลอดภัยจาก race condition)

### F6 — Void บิล (Same-day Cancellation)
- [x] Void บิลได้เฉพาะบิลที่ `status = COMPLETED` และขายในวันเดียวกับที่กด void
- [x] Void บิลที่ข้ามวันแล้ว → ระบบปฏิเสธพร้อมข้อความชัดเจน
- [x] Void สำเร็จ → สร้าง `StockTransaction(IN)` ชดเชยครบทุกบรรทัด และ `product.quantity` คืนถูกต้อง
- [x] Void ไม่ลบ/แก้ไข `StockTransaction(OUT)` เดิมที่เกิดตอนขาย
- [x] บิล `VOIDED` ไม่ถูกนับในยอดขายรวมของ Dashboard/Reports แต่ยังปรากฏในประวัติการขายพร้อมสถานะ

### F7 — Dashboard/Reports สำหรับยอดขาย
- [x] Dashboard แสดง**ยอดขายวันนี้** (Σ `total` ของ `Sale` ที่ `status = COMPLETED` และ `createdAt` = วันนี้) และ
      **จำนวนบิลวันนี้** ถูกต้องตรงกับข้อมูล Sale จริง พร้อม**รายการขายล่าสุด**คู่กับ recent stock transactions เดิม
- [x] `/reports` แสดงกราฟยอดขายรายวันย้อนหลัง 30 วัน, สินค้าขายดี Top N (group by `productId` จาก `SaleItem`),
      สัดส่วนวิธีชำระเงิน (CASH/TRANSFER/QR) ถูกต้อง
- [x] เมื่อ void บิล ตัวเลขใน Dashboard/Reports อัปเดตให้ไม่นับบิลนั้นทันที

### F8 — จัดการหมวดหมู่สินค้า (Category CRUD)
- [x] สร้าง/แก้ไข/ลบหมวดหมู่สินค้าได้
- [x] ชื่อหมวดหมู่ซ้ำ → ระบบปฏิเสธพร้อมข้อความแจ้งเตือน
- [x] ลบหมวดหมู่ที่มีสินค้าผูกอยู่ไม่ได้ → แจ้งจำนวนสินค้าที่ผูกอยู่
- [x] ฟอร์มสินค้า (สร้าง/แก้ไข) เลือกหมวดหมู่จาก dropdown ที่ดึงจากตาราง Category เท่านั้น
- [x] หน้ารายการสินค้า/ตะกร้า POS กรองตามหมวดหมู่ได้ถูกต้อง (อิง `categoryId`)

### F9 — ปิดการขายประจำวันของแคชเชียร์ (Cashier Daily Closing)
- [x] แคชเชียร์เปิดหน้าปิดยอด เห็นสรุปยอดขายวันนี้ของตัวเอง (ยอดรวม, แยกตามวิธีชำระเงิน, จำนวนบิล, จำนวนบิล voided)
      คำนวณจากข้อมูลจริงอัตโนมัติ ไม่ต้องกรอกเอง
- [x] กรอกเงินสดที่นับได้จริงแล้วระบบคำนวณส่วนต่าง (ขาด/เกิน) ให้ทันที
- [x] ยืนยันปิดยอดสำเร็จ → สร้าง `CashierClosing` 1 record ต่อแคชเชียร์ต่อวัน (ปิดซ้ำวันเดิมไม่ได้)
- [x] หลังปิดยอดแล้ว บิลของแคชเชียร์คนนั้นในวันนั้นกด Void ไม่ได้อีก (ปุ่ม Void ถูกปิด/ระบบปฏิเสธ)
- [x] ดูประวัติการปิดยอดย้อนหลังได้ (รายวัน ต่อแคชเชียร์)

### F10 — ระบบสิทธิ์ผู้ใช้ (Role & Permission Management)
> ⛔ **นอกขอบเขต v1** — พิมพ์เขียวสำหรับเฟสถัดไป (ดู [§7 Out of Scope](#7-out-of-scope-v1))
> Acceptance Criteria ด้านล่างไม่นับรวมใน Definition of Done ของ v1

- [ ] ผู้ที่มีสิทธิ์ `USERS:EDIT` สร้าง/แก้ไข/ลบ Role ได้ (ยกเว้น Role ระบบ "ผู้ดูแลระบบ" แก้ชื่อ/ลบไม่ได้)
- [ ] กำหนดสิทธิ์ต่อ Role แบบตาราง matrix ต่อหน้า: เลือก View/Add/Edit/Delete แยกช่อง หรือกดปุ่มลัด "Full"/"Readonly"
- [ ] Action ที่ไม่มีความหมายกับ resource นั้น (เช่น Edit/Delete บน Stock In/Stock Out) ถูก disable ในตาราง ไม่ให้เลือก
- [ ] กำหนด Role ให้ผู้ใช้แต่ละคนได้จากหน้า `/users`
- [ ] ผู้ใช้ที่ยังไม่มี Role เข้าได้เฉพาะหน้า `/settings` หน้าอื่นทั้งหมดถูกปฏิเสธและไม่แสดงในเมนู
- [ ] ไม่มีสิทธิ์ View หน้าใด → เมนูนั้นหายไปจาก Sidebar และเข้า URL ตรง ๆ ถูก redirect ไปหน้า Access Denied
- [ ] ไม่มีสิทธิ์ Add/Edit/Delete → ปุ่มที่เกี่ยวข้องในหน้านั้นถูกซ่อน/ปิดใช้งาน และ Server Action ปฏิเสธคำขอแม้เรียกตรง
- [ ] ห้ามลบ/เปลี่ยน Role ของผู้ใช้คนสุดท้ายที่เป็น "ผู้ดูแลระบบ" (กันระบบไม่มีผู้ดูแลเหลือ)

### F11 — ผังโต๊ะ (Table Overview + รวมโต๊ะ)
- [x] แสดงตารางโต๊ะทั้งหมดเป็น grid พร้อม filter chip นับจำนวนต่อสถานะ (ว่าง/เปิดโต๊ะ/สั่งแล้ว/รอเช็กบิล/
      ต้องการความช่วยเหลือ)
- [x] **การ์ดแต่ละโต๊ะที่ไม่ว่างแสดงเวลาที่เปิดโต๊ะ (นาฬิกา) และระยะเวลาที่เปิดโต๊ะ (นาที) พร้อมกันเสมอ**
- [x] รวมโต๊ะได้ (เลือกโต๊ะหลัก + โต๊ะรองที่ต้องว่าง) — โต๊ะรองเปลี่ยนเป็น "ไม่ว่าง/รวมกับโต๊ะหลัก" ทันที และบิล
      รวมเข้าโต๊ะหลักทั้งหมด
- [x] ยกเลิกการรวมโต๊ะได้ก่อนปิดบิล — โต๊ะรองกลับเป็นว่าง
- [x] คลิกการ์ดโต๊ะที่ไม่ว่าง → ไปหน้ารายละเอียดออร์เดอร์ต่อโต๊ะ (F13)

### F12 — การแจ้งเตือน (Call Staff / Check Bill Notifications)
- [x] แยกโซน "ด่วน-ยังไม่รับทราบ" กับ "รับทราบแล้ว"
- [x] แต่ละการ์ดแสดงโต๊ะ, ประเภท (เรียกพนักงาน/เช็กบิล), ข้อความ/เหตุผล, เวลาสัมพัทธ์ของการแจ้งเตือนเอง
      **และเพิ่มเวลาที่เปิดโต๊ะ (นาฬิกา) + เปิดโต๊ะมาแล้วกี่นาที ของโต๊ะนั้น**
- [x] กด "รับทราบ" ย้ายการ์ดไปโซนล่างทันที (real-time ไม่ต้อง refresh หน้า)

### F13 — รายละเอียดออร์เดอร์ต่อโต๊ะ (Table Order Detail)
- [x] Header แสดงโต๊ะ, เวลาเปิดโต๊ะ, เลขออร์เดอร์, ประเภท QR, ปุ่ม "ยกเลิกโต๊ะ" (ทั้งชุด)
- [ ] รายการอาหารแสดง badge สถานะต่อรายการ (รอครัวรับ/กำลังปรุง/เสิร์ฟแล้ว) + ตัวปรับจำนวน
      > badge ครบแล้ว · **ตัวปรับจำนวนยังไม่ทำ** — แก้จำนวนหลังส่งครัวแล้วต้องมีกติกาชดเชยของตัวเอง
      > (ตอนนี้ใช้ยกเลิกรายการแล้วให้ลูกค้าสั่งใหม่แทน) รอยืนยันขอบเขตก่อน
- [x] **ปุ่มยกเลิกรายการทีละรายการปรากฏเฉพาะรายการที่ `status = รอครัวรับ`** — หายไปทันทีที่ครัวเริ่มทำ (กด server
      ตรงก็ถูกปฏิเสธเช่นกัน)
- [x] log ประวัติการแจ้งเตือนของโต๊ะนี้แสดงอยู่ในหน้าเดียวกัน
- [x] Footer: ยอดรวม, พิมพ์ทิกเก็ตซ้ำ, ปุ่มไปหน้าปิดบิล

### F14 — สั่งอาหารผ่าน QR Code (Customer Ordering Flow)
- [x] สแกน QR → เปิด/เข้า session อัตโนมัติ ไม่ต้องรอพนักงาน
- [x] เมนูแสดงกลุ่มเมนูแนะนำ (สูงสุด 6 รายการ) แยกจากเมนูปกติ
- [x] เลือกสินค้า → หน้ากำหนดรายละเอียด (modifier group แบบ radio/checkbox ตาม `selectionType`, โน้ตถึงครัว) →
      ใส่ตะกร้า
- [x] ตะกร้าแก้จำนวน/ลบได้ก่อนกดยืนยัน — ยืนยันแล้วแก้ไม่ได้ (ต้องรอสถานะ "รอครัวรับ" แล้วให้พนักงานยกเลิกแทน)
- [x] "สั่งเพิ่ม" สร้าง `MobileOrder` รอบใหม่ในเซสชันเดิมได้ตลอดจนกว่าจะเช็กบิล

### F15 — เรียกพนักงาน (Call Staff)
- [x] มี preset reason chip + free text
- [x] กดแล้วขึ้นแจ้งเตือนที่หน้า Notifications (F12) แบบ real-time ภายในไม่กี่วินาที

### F16 — เช็กบิล (Check Bill)
- [x] กดแล้ว server ถามยอดปัจจุบันจาก POS แล้วส่งกลับให้ลูกค้าเห็นยอดก่อนเลือกวิธีจ่าย
- [x] ตั้ง `TableSession.status = AWAITING_BILL`, โต๊ะขึ้นสถานะ "รอเช็กบิล" บนผังโต๊ะ

### F17 — ชำระเงิน (PromptPay + Card/EDC) และปิดโต๊ะอัตโนมัติ
- [x] เลือกวิธีจ่าย: PromptPay (default) หรือ Card ที่เคาน์เตอร์ — `/order/[qrToken]/pay`
- [x] PromptPay: แสดง QR + countdown, auto-poll สถานะ, webhook ยืนยันแล้วปิดโต๊ะให้อัตโนมัติโดยลูกค้าไม่ต้องกด
      อะไรเพิ่ม
      > payload EMVCo สร้างเองที่ `lib/promptpay.ts` (ตั้งค่าด้วย env `PROMPTPAY_ID`) ไม่ผูกกับผู้ให้บริการ
      > รายใด · **ยังไม่ได้ต่อ provider จริง** — เปิดใช้เส้นทางอัตโนมัติด้วย `PAYMENT_WEBHOOK_SECRET`
      > (ไม่ตั้ง = endpoint ตอบ 503 และร้านปิดบิลด้วยมือจากหน้า billing ได้ตามปกติ)
- [x] Card: พนักงานกดยืนยันจากฝั่ง POS หลัง EDC ตัดบัตรสำเร็จ → ปิดโต๊ะอัตโนมัติเช่นกัน
- [x] ปิดโต๊ะสำเร็จ → สร้าง `Sale`+`SaleItem` ที่ปรากฏถูกต้องใน `/pos/history`, Dashboard, Reports เหมือนบิลขาย
      หน้าร้าน
- [x] DYNAMIC QR ของโต๊ะนั้นถูก invalidate ทันที; STATIC QR ไม่ถูกแตะต้อง

### F18 — Kitchen Display System (KDS) + fallback ไม่มี KDS
- [x] KDS แสดงทิกเก็ต 3 คอลัมน์ (ใหม่/กำลังปรุง/พร้อมเสิร์ฟ) พร้อมตัวนับเวลาที่ผ่านไปต่อทิกเก็ต
- [x] กด "เริ่มทำ"/"เสร็จ" เปลี่ยนสถานะกลับไปที่ POS (ผ่าน auto-refresh 10 วิ บน KDS / 15 วิ บนผังโต๊ะ)
- [x] ร้านที่ `hasKDS = false` ไม่มีหน้านี้เลย — สถานะจัดการทั้งหมดจากหน้ารายละเอียดออร์เดอร์โต๊ะ (F13) แทน
- [x] ทิกเก็ตพิมพ์ได้ทันทีที่ออร์เดอร์เข้า ไม่ว่าร้านจะมี KDS หรือไม่ (ปุ่มทิกเก็ต PDF อยู่ทั้งบน KDS
      และหน้ารายละเอียดโต๊ะ — พิมพ์กับ KDS ทำงานคู่ขนานกัน ไม่ใช่ทางเลือกแทนกัน)
      คู่ขนานกันได้ ไม่ใช่ทางเลือกแทนกัน)

### F19 — แจ้งเตือนผ่าน LINE
- [ ] ส่ง push 3 จุด: ยืนยันออร์เดอร์, อาหารพร้อม/เสิร์ฟแล้ว, ชำระเงินสำเร็จ
- [ ] ส่งไม่สำเร็จไม่กระทบ flow หลัก (บันทึก log ไว้ตรวจสอบภายหลัง)

### F20 — จัดการ QR Code (Static/Dynamic)
- [x] เลือกประเภท QR ต่อโต๊ะหรือเป็นช่วง (bulk) ได้
- [x] ดาวน์โหลด/สั่งพิมพ์ QR ทีละใบหรือทั้งชุด
- [x] DYNAMIC ที่ invalidate แล้ว มีปุ่ม "พิมพ์ใบใหม่" สร้าง token ใหม่ทันที

### F21 — POS Manager: ตั้งค่าธีม/แบรนด์/เมนูเด่น
- [x] แก้ไข cover/logo/สีธีม/ชื่อร้านผ่านหน้าเว็บได้ ไม่ต้องแก้โค้ด — สีธีมมีผลเฉพาะ route group
      `(customer)` โดย override `--brand` เป็น inline style บน `<body>` (ไม่ generate CSS ต่อร้าน)
      > สีถูกบังคับเป็น hex 6 หลักด้วย zod ก่อนลง inline style · ลิงก์รูปรับเฉพาะ http/https หรือ path
      > ภายในเว็บ (กัน `javascript:` และ `data:`)
      `(customer)` โดย override `--brand` เป็น inline style บน `<body>` (ไม่ generate CSS ต่อร้าน)
- [x] จัดลำดับ/ปักหมุดเมนูแนะนำสูงสุด 6 รายการ (validation ปฏิเสธรายการที่ 7 ที่ server ไม่ใช่แค่ปิดปุ่มบน UI)
- [x] สลับ `hasKDS` ได้ — **ปฏิเสธการสลับถ้ามี `TableSession` ที่เปิดอยู่อย่างน้อย 1 โต๊ะ**
      (เช็คในทรานแซคชันเดียวกับการเขียน ไม่ใช่เช็คก่อนแล้วค่อยเขียน)

### F22 — สมัครสมาชิก & สะสมแต้ม (CRM/Membership MVP)
> ⛔ **การใช้แต้มแลกส่วนลด/ของรางวัล (redemption), ระดับสมาชิก/tier, ระบบข้ามสาขา (multi-branch) อยู่นอกขอบเขต
> v1** — พิมพ์เขียวสำหรับเฟสถัดไป (ดู [§7 Out of Scope](#7-out-of-scope-v1))

- [x] สมัครด้วยเบอร์โทรบนหน้า payment-success ได้ทันที ไม่ต้อง scan ใบเสร็จภายหลัง
- [x] ได้แต้มทันทีตามยอดบิล แสดงยอดแต้มสะสมปัจจุบันให้เห็นทันที (1 แต้ม/25 บาท ปัดลง — `lib/points.ts`)
- [x] เบอร์เดิมสมัครซ้ำ = เข้าบัญชีเดิม ไม่สร้างซ้ำ (เบอร์ถูก normalize เป็นตัวเลขล้วนก่อนเทียบ unique)

---

## 6. Routes / UI (POS)

### `/pos` — หน้าขายหลัก (Cashier Screen)
- **ค้นหาสินค้า**: พิมพ์ชื่อหรือ SKU (ช่องค้นหารองรับ barcode scanner แบบ keyboard-wedge ได้ทันทีเพราะพิมพ์เป็น
  ข้อความเหมือนคีย์บอร์ด — กด Enter เพื่อเพิ่มลงตะกร้า)
- **ตะกร้า (cart)**: แสดงรายการที่เลือก, ปรับจำนวน/ลบรายการ, ใส่ส่วนลดท้ายบิล, สรุปยอดรวม
  - เตือนทันทีฝั่ง client ถ้าจำนวนในตะกร้า > สต็อกคงเหลือ (UX เท่านั้น — server ตรวจซ้ำเสมอเป็น source of truth)
- **ปุ่มชำระเงิน** → dialog เลือกวิธีชำระ (CASH/TRANSFER/QR), กรอกจำนวนเงินรับ (ถ้า CASH) → คำนวณเงินทอน
  real-time → ยืนยัน → เรียก server action checkout
- **หลังชำระสำเร็จ**: แสดงใบเสร็จบนหน้าจอ (เลขบิล, รายการ, ยอดรวม, ส่วนลด, วิธีชำระ, เงินทอน, พนักงานขาย, เวลา)
  พร้อมปุ่ม "พิมพ์ใบเสร็จ" (ใช้ print CSS + `window.print()` — พิมพ์จริงหรือ save เป็น PDF ผ่าน browser ได้เลย
  ไม่ต้องเชื่อมเครื่องพิมพ์เฉพาะทาง) และปุ่ม "เริ่มบิลใหม่"

### `/pos/history` — ประวัติการขาย
- ตารางบิลทั้งหมด พร้อมค้นหา/กรองตามช่วงวันที่และสถานะ (COMPLETED/VOIDED)
- ดูรายละเอียดบิล (รายการสินค้า, ยอด, วิธีชำระ, พนักงานขาย)
- ปุ่ม **Void** — แสดงเฉพาะบิลที่ขายวันนี้และยังไม่ถูก void (ปิดปุ่มอัตโนมัติเมื่อข้ามวัน)

### `/categories` — จัดการหมวดหมู่สินค้า
- ตาราง list หมวดหมู่ทั้งหมด พร้อมจำนวนสินค้าที่ผูกอยู่ในแต่ละหมวด
- ฟอร์มเพิ่ม/แก้ไขชื่อหมวดหมู่ (dialog), ปุ่มลบพร้อมยืนยัน (ปิดปุ่มลบถ้ามีสินค้าผูกอยู่)

### `/pos/closing` — ปิดการขายประจำวัน
- แสดงสรุปยอดขายวันนี้ของแคชเชียร์ปัจจุบัน (session user) แบบ real-time: ยอดรวม, แยกตามวิธีชำระเงิน, จำนวนบิล,
  จำนวนบิล voided
- ช่องกรอกเงินสดที่นับได้จริง → คำนวณส่วนต่างทันที → ปุ่ม "ยืนยันปิดยอด"
- ถ้าปิดยอดของวันนี้ไปแล้ว หน้าจะแสดงผลการปิดยอดเดิม (read-only) แทนฟอร์ม พร้อมลิงก์ไปประวัติการปิดยอด
- ประวัติการปิดยอดย้อนหลัง (ต่อแคชเชียร์)

### `/roles` — จัดการบทบาทและสิทธิ์ (ต้องมีสิทธิ์ `USERS:EDIT`)
> ⛔ **นอกขอบเขต v1** — พิมพ์เขียวสำหรับเฟสถัดไป (ดู [§7 Out of Scope](#7-out-of-scope-v1))

- ตาราง list บทบาททั้งหมด พร้อมจำนวนผู้ใช้ที่ผูกอยู่ในแต่ละบทบาท
- หน้าแก้ไขบทบาท: ตาราง matrix (แถว = resource/หน้า, คอลัมน์ = View/Add/Edit/Delete) พร้อมปุ่มลัด "Full"/"Readonly"
  ต่อแถว — ช่องที่ไม่มีความหมายกับ resource นั้นถูก disable (ดูตารางใน [4. ระบบสิทธิ์ผู้ใช้](#4-ระบบสิทธิ์ผู้ใช้-better-auth--role-based-permission))
- บทบาทระบบ ("ผู้ดูแลระบบ") แก้ชื่อ/ลบไม่ได้ — ปุ่มเหล่านี้ถูกปิดใช้งานในหน้า UI

### Sidebar / Navigation
- เพิ่มเมนู **"ขายหน้าร้าน (POS)"** → `/pos` (ตำแหน่งเด่น เพราะเป็นหน้าที่ใช้งานบ่อยที่สุดในแต่ละวัน)
- เพิ่มเมนู **"ประวัติการขาย"** → `/pos/history`
- เพิ่มเมนู **"ปิดยอดประจำวัน"** → `/pos/closing`
- เพิ่มเมนู **"หมวดหมู่สินค้า"** → `/categories` (จัดกลุ่มไว้ใกล้เมนูสินค้า)
- ⛔ *(นอกขอบเขต v1)* เพิ่มเมนู **"บทบาทและสิทธิ์"** → `/roles` (แสดงเฉพาะผู้ที่มีสิทธิ์ `USERS:EDIT`)
- ⛔ *(นอกขอบเขต v1)* **ทุกเมนูแสดง/ซ่อนตามสิทธิ์ `VIEW` ของผู้ใช้ที่ login อยู่เสมอ** — resource ที่ไม่มีสิทธิ์ View
  จะไม่ปรากฏใน Sidebar เลย (ดู [4. ระบบสิทธิ์ผู้ใช้](#4-ระบบสิทธิ์ผู้ใช้-better-auth--role-based-permission))
  — **v1 แสดงทุกเมนูให้ผู้ใช้ที่ล็อกอินแล้วเท่ากันทุกคน**

### Auth
- ทุก route ผ่าน guard เดิม (proxy) เหมือนหน้าอื่นทั้งหมด — **v1 ตรวจแค่ว่าล็อกอินแล้วหรือยัง**
  ผู้ใช้ที่ผ่านด่านนี้เข้าได้ทุกหน้าเท่ากันทุกคน
- `cashierId` ผูกกับ session user ปัจจุบันโดยอัตโนมัติตอน checkout (ไม่ให้เลือกเอง)
- ⛔ *(นอกขอบเขต v1)* **บวกการตรวจสิทธิ์ `VIEW` ต่อ resource** ตามที่กำหนดในระบบ Role-Based Permission
  (ดูหัวข้อ 4) — ผู้ใช้แต่ละคนเข้าได้เฉพาะหน้าที่บทบาทของตนอนุญาต
- ⛔ *(นอกขอบเขต v1)* ปุ่มชำระเงิน (checkout) ต้องมีสิทธิ์ `POS:ADD`, ปุ่ม Void ต้องมีสิทธิ์ `POS_HISTORY:DELETE`,
  ปุ่มปิดยอดต้องมีสิทธิ์ `POS_CLOSING:ADD`

---

## 6a. Routes / UI (MJD Mobile Order)

### โครงสร้าง Route Group และธีม
ทุก route ในระบบแบ่งเป็น **2 route group ที่มี root layout และชุด design token แยกกัน**:

| Route group | ครอบคลุม | `data-theme` | ธีม |
|---|---|---|---|
| `app/(staff)/…` | `/pos/*`, `/products`, `/categories`, `/reports`, `/users`, `/settings`, `/mobile-order/*` (รวม KDS) | `staff` | teal `#01787B` · Inter + Anuphan + JetBrains Mono |
| `app/(customer)/…` | `/order/[qrToken]/*` | `customer` | ส้ม `#E8571F` บนครีม `#FBF8F5` · Prompt + Sarabun |

- ทั้งสองกลุ่มเป็น **root layout แยกกัน** (ไม่มี `app/layout.tsx` กลาง) — แต่ละกลุ่ม render `<html>`/`<body>`
  ของตัวเอง และโหลดเฉพาะฟอนต์ของธีมตัวเอง (หน้าลูกค้าเปิดบนเน็ตมือถือ ไม่ควรโหลดฟอนต์ฝั่งพนักงานทิ้งเปล่า)
- `app/globals.css` เก็บ token ทั้งสองชุดในไฟล์เดียว — token เชิงโครงสร้าง (spacing/radius/shadow/สเกลฟอนต์)
  อยู่ใน `:root` ใช้ร่วมกัน, **เฉพาะสีกับ font-family** แยกใต้ `[data-theme="staff"]` / `[data-theme="customer"]`
- component class ทั้งหมด (`.btn`, `.card-ui`, `.chip`, …) ต้องอ้าง token เชิงความหมาย (`var(--brand)`,
  `var(--surface)`, `var(--ink)`) **ห้ามอ้างชื่อสีตรง ๆ** เพื่อให้ class ชุดเดียวใช้ได้ทั้งสองธีม
- **สีของร้าน (F21)**: `(customer)/layout.tsx` อ่าน `StoreSettings.themeColor` แล้วเซ็ต
  `style={{ '--brand': themeColor }}` บน `<body>` — inline style ชนะ `[data-theme]` เสมอ ไม่ต้อง generate
  CSS ใหม่ต่อร้าน

> ⚠️ **กับดัก**: root layout แยกกันแปลว่าไม่มี provider/state ที่แชร์ข้ามสองกลุ่ม และการนำทางข้ามกลุ่มเป็น
> full page load — ยอมรับได้เพราะลูกค้ากับพนักงานไม่สลับหน้ากันอยู่แล้ว แต่ component ที่ใช้ร่วมกันต้องไม่ผูก
> กับ provider ของกลุ่มใดกลุ่มหนึ่ง

### Customer-facing (public, ไม่ต้อง login, ระบุ session ผ่าน token ที่ไม่ใช่ raw tableId ใน URL)
- `/order/[qrToken]` — resolve token → เปิด/เข้า `TableSession` → redirect ไปเมนู
- `/order/[qrToken]/menu` — เมนูดิจิทัล + เมนูแนะนำ (F14)
- `/order/[qrToken]/item/[menuItemId]` — รายละเอียด/ปรับแต่งเมนู
- `/order/[qrToken]/cart` — ตะกร้าก่อนยืนยัน
- `/order/[qrToken]/confirmed` — ยืนยันออร์เดอร์แล้ว
- `/order/[qrToken]/status` — progress bar 4 ขั้น (ส่งแล้ว/รับออร์เดอร์/กำลังปรุง/พร้อมเสิร์ฟ) + footer สั่งเพิ่ม/
  เรียกพนักงาน/เช็กบิล — **โพลสถานะทุก 3–5 วินาที** ผ่าน route handler ไม่ใช้ WebSocket ฝั่งลูกค้า (ดูหมายเหตุ
  Realtime ด้านล่าง)
- `/order/[qrToken]/call-staff` — เรียกพนักงาน (F15)
- `/order/[qrToken]/check-bill` — เช็กบิล (F16)
- `/order/[qrToken]/pay` — เลือกวิธีชำระ (F17)
- `/order/[qrToken]/pay/promptpay` — QR ชำระเงิน + countdown + auto-poll
- `/order/[qrToken]/pay/success` — สำเร็จ + CRM upsell
- `/order/[qrToken]/join` — สมัครสมาชิก (F22)

### Staff-facing (ผ่าน guard เดิม เหมือน `/pos/...` — namespace ใหม่ `/mobile-order/...`)
- `/mobile-order/tables` — ผังโต๊ะ (F11)
- `/mobile-order/notifications` — การแจ้งเตือน (F12)
- `/mobile-order/tables/[tableId]` — รายละเอียดออร์เดอร์ต่อโต๊ะ (F13)
- `/mobile-order/tables/[tableId]/billing` — ปิดบิล/รับชำระเงิน (F17)
- `/mobile-order/qr-codes` — จัดการ QR Code (F20)
- `/mobile-order/settings` — POS Manager: ตั้งค่าธีม/แบรนด์/เมนูเด่น (F21)

### Kitchen
- `/mobile-order/kitchen` — Kitchen Display System (F18) แสดงเฉพาะเมื่อ `StoreSettings.hasKDS = true` —
  แนะนำให้ใช้บัญชี "kitchen station" ที่ใช้ร่วมกัน (shared login) แทนการเปิดข้อยกเว้น no-auth เนื่องจาก
  requirement ไม่ได้ระบุบัญชีแยกต่อพ่อครัว/แม่ครัว

### Sidebar / Navigation
- เพิ่มกลุ่มเมนู **"MJD Mobile Order"** → ผังโต๊ะ / การแจ้งเตือน (พร้อม badge นับ `Notification` ที่ `PENDING`) /
  จัดการ QR / ตั้งค่า — แสดงให้ผู้ใช้ที่ล็อกอินแล้วทุกคนเท่ากัน (v1 ยังไม่มี RBAC เหมือนเมนูอื่น)

### Realtime Transport
- **Staff/Kitchen**: Socket.IO ที่รันคู่กับ custom Next.js server เดิม (แอปโฮสต์เองบน VPS อยู่แล้ว ไม่ใช่
  serverless) — ใช้ push ออร์เดอร์ใหม่, เปลี่ยนสถานะรายการ, และแจ้งเตือนเรียกพนักงาน/เช็กบิล ระหว่าง POS ↔ ครัว
  แบบเรียลไทม์
- **Customer**: ใช้ polling แทน WebSocket ฝั่งลูกค้า เพื่อความทนทานบนเครือข่ายมือถือที่ไม่เสถียร

---

## 7. Out of Scope (v1)

ระบุชัดเพื่อกันขอบเขตบวม — ออกแบบ schema/โครงสร้างให้ต่อยอดได้ในอนาคตแต่ไม่ทำใน v1 นี้:

**ฝั่งคลังสินค้า (เดิม)**
- หลายคลัง (multi-warehouse)
- การอนุมัติเบิก (approval workflow)

**ฝั่ง POS (ใหม่)**
- Refund บางส่วน / split payment ในบิลเดียว (v1 คือ void ทั้งบิลเท่านั้น จ่ายด้วยวิธีเดียวต่อบิล)
- ส่วนลดรายสินค้า / โปรโมชั่น / คูปอง (v1 มีแค่ส่วนลดท้ายบิล)
- เชื่อมเครื่องพิมพ์ใบเสร็จจริง (ESC/POS) และลิ้นชักเก็บเงิน (cash drawer) — v1 พิมพ์ผ่าน browser เท่านั้น
- ระบบหลายกะต่อวัน (multi-shift) และการเปิดกะ/นับเงินสดตั้งต้น (opening float) — v1 มีแค่ **ปิดยอดขายท้ายวัน
  1 ครั้ง/แคชเชียร์/วัน** (ดู F9) ไม่ใช่ระบบกะเต็มรูปแบบ
- ลูกค้า/สมาชิก (CRM) — **สมัครสมาชิกด้วยเบอร์โทร + ได้แต้มอัตโนมัติตอนจ่ายเงินอยู่ใน scope แล้ว** (ดู F22)
  ส่วนที่ยังไม่ทำ: การใช้แต้มแลกส่วนลด/ของรางวัล (redemption), ระดับสมาชิก (tier), และการรวมแต้มข้ามสาขา
  (multi-branch)
- บัตรเครดิต/เดบิต (CARD) ผ่าน **payment gateway ในแอป** ยังไม่ทำ (คงเดิม) — แต่ CARD ผ่าน **เครื่อง EDC ที่
  เคาน์เตอร์ (พนักงานยืนยันด้วยมือ)** สำหรับบิลจาก MJD Mobile Order **อยู่ใน scope แล้ว** (ดู F17) เพราะ
  trust model เหมือน TRANSFER ทุกประการ ไม่ใช่การเชื่อมระบบชำระเงินจริง

**ฝั่ง MJD Mobile Order (ใหม่)**
- ~~รองรับหลายสาขา/หลายร้าน (multi-store) — v1 มี `StoreSettings` เดียวทั้งระบบ~~ → **ย้ายเข้า scope แล้ว
  (2026-09-14) ดู Phase 13 ท้าย §8** — v1 ที่ส่งมอบแล้วยังเป็นร้านเดียว การแยกร้านเริ่มตั้งแต่ Phase 13
- แบ่งบิล/หารบิลระหว่างลูกค้าหลายคนที่โต๊ะเดียวกัน (split bill)
- ตัดสต็อกวัตถุดิบตามสูตร/BOM เมื่อขายเมนูอาหาร — `MenuItem` เป็น catalog แบน ไม่ผูกกับ `Product`/`StockTransaction`
- ระบบชำระเงินผ่าน payment gateway จริงในแอป (คงเฉพาะ EDC ภายนอกสำหรับ CARD)
- โหมด offline สำหรับ POS/KDS — สมมติว่ามีอินเทอร์เน็ตต่อ MJD Cloud Server ตลอด (เครื่องพิมพ์ครัวเท่านั้นที่ทำงาน
  ผ่าน LAN/USB/Serial โดยไม่ง้อเน็ต)
- รายงานเฉพาะทาง เช่น รอบหมุนโต๊ะเฉลี่ย (table turnover analytics) — ใช้ `/reports` เดิมสำหรับยอดขายรวมไปก่อน
- ระบบจองโต๊ะล่วงหน้า/คิว (reservation/waitlist)
- Refund บางส่วนหลังปิดบิลของมือถือออร์เดอร์ — ใช้กติกา Void เดิม (F6) เท่านั้น (void ทั้งบิล same-day)

**ฝั่งสิทธิ์ผู้ใช้ (Role-Based Permission)**
- **ข้อยกเว้นตั้งแต่ Phase 13 (2026-09-14)**: บทบาทขั้นต่ำ `OWNER` / `STAFF` ต่อร้าน (`StoreMember.role`) และ
  `User.isPlatformAdmin` ถูกดึงเข้า scope เพราะแยกไม่ได้จาก multi-store — **ไม่ใช่** RBAC ตาม §4 (ไม่มี matrix
  สิทธิ์ราย resource) ข้อความด้านล่างยังใช้กับ RBAC เต็มรูปแบบตามเดิม
- **ระบบสิทธิ์ตามบทบาททั้งระบบอยู่นอกขอบเขต v1** — ไม่มีตาราง `Role` / `RolePermission`, ไม่มี `User.roleId`,
  ไม่มี page guard เช็ค `VIEW` และไม่มี action guard เช็ค `ADD`/`EDIT`/`DELETE`
  v1 มีด่านเดียวคือ **ล็อกอินแล้วหรือยัง** — ผ่านด่านนี้แล้วเข้าได้ทุกหน้า ทำได้ทุก action เท่ากันทุกคน
- แบบที่ออกแบบไว้แล้ว **ยังคงอยู่ในเอกสารนี้ในฐานะพิมพ์เขียวของเฟสถัดไป ไม่ใช่ข้อผูกพันของ v1** ได้แก่
  [§4 ระบบสิทธิ์ผู้ใช้](#4-ระบบสิทธิ์ผู้ใช้-better-auth--role-based-permission) ทั้งหัวข้อ · ส่วน `Role`,
  `RolePermission`, `User.roleId`, enum `PermissionAction`, enum `ResourceKey` ใน §2 Data Model ·
  F10 ใน §5 · route `/roles` และย่อหน้า Sidebar/Auth ใน §6 ·
  หัวข้อ "Phase ถัดไป (ยังไม่กำหนดวัน)" ท้าย §8 (เดิมคือ Phase 2.6)
- เมื่อยกมาทำจริงในเฟสถัดไป ขอบเขตต่อไปนี้ยังคงถูกกันออกอยู่ดี:
  - ผู้ใช้ 1 คนมีได้เพียง 1 บทบาท (ไม่รองรับหลายบทบาทซ้อนกันต่อผู้ใช้)
  - ไม่มีสิทธิ์ระดับ "แถว/รายการ" (row-level เช่น "เห็นเฉพาะบิลของตัวเอง") — คุมสิทธิ์ระดับหน้า/โมดูลเท่านั้น
  - ไม่มี audit log การเปลี่ยนแปลงสิทธิ์ (ใครแก้ role ให้ใคร เมื่อไหร่)

---

## 8. แผนการพัฒนา

### ✅ Phase 1 — Foundation (วันที่ 1)
ตั้งรากฐานโปรเจกต์ ฐานข้อมูล และสมองของโปรเจกต์

- [x] ตั้งโปรเจกต์ Next.js 16 (App Router) + TypeScript ด้วย pnpm
- [x] ติดตั้งและตั้งค่า Tailwind CSS v4 + shadcn/ui
- [x] วางโครง **route group 2 กลุ่ม** `app/(staff)/` + `app/(customer)/` เป็น root layout แยกกัน พร้อม
      design token 2 ชุดใน `app/globals.css` (`[data-theme="staff"]` / `[data-theme="customer"]`)
      ตาม [§6a โครงสร้าง Route Group และธีม](#6a-routes--ui-mjd-mobile-order) — ทำตั้งแต่แรกจะได้ไม่ต้อง
      รื้อโครง `app/` ตอน Phase 9
- [x] ติดตั้ง Prisma + เขียน schema: `Product`, `StockTransaction`, `enum TransactionType {IN, OUT}`
- [x] เชื่อมต่อ PostgreSQL (ตั้ง `DATABASE_URL` ใน `.env`)
- [x] รัน migration ครั้งแรก (`prisma migrate dev --name init`)
- [x] เขียน seed script + Seed ข้อมูลตัวอย่าง **SKU-1001 ถึง SKU-1007**
- [x] วาง `CLAUDE.md` (สมองของโปรเจกต์: โครงสร้าง, คำสั่ง, convention)
- [x] ตรวจสอบ: `pnpm dev` เปิดได้ + `prisma studio` เห็นข้อมูล seed 7 รายการ

### ✅ Phase 2 — Core Features (วันที่ 2)
ฟีเจอร์หลักที่ใช้งานได้จริง

- [x] CRUD สินค้าครบวงจร (Create / Read / Update / Delete) ผ่าน Server Actions + Zod
- [x] หน้ารายการสินค้า + ค้นหา/กรอง
- [x] Stock In: ฟอร์ม → `prisma.$transaction` (สร้าง txn + เพิ่ม quantity)
- [x] Stock Out: ฟอร์ม → `prisma.$transaction` (ตรวจยอด + **กันเบิกเกิน** + สร้าง txn + ลด quantity)
- [x] Dashboard: สรุปยอด + มูลค่าสต็อก + รายการเคลื่อนไหวล่าสุด
- [x] แจ้งเตือนสินค้าใกล้หมด (`quantity ≤ reorderPoint`) + Badge นับจำนวน
- [x] Custom Slash Commands สำหรับงานที่ทำบ่อย (`/action`, `/check`, `/migration`, `/create-crud`, `/add-feature`, `/review-code` ใน `.claude/commands/`)
- [x] ระบบ Auth (Better Auth): login / register / forgot-password / reset-password + guard ทุกหน้าด้วย proxy
      (Next.js 16)
- [x] หน้าเสริมตาม design + เชื่อมลิงก์ใน Sidebar/ProfileMenu: **รายงาน** (`/reports` — สรุป 30 วัน + กราฟ),
      **ผู้ใช้งาน** (`/users` — list จากตาราง user), **ตั้งค่า** (`/settings` — แก้โปรไฟล์/เปลี่ยนรหัสผ่านผ่าน Better Auth)

### ✅ Phase 2.5 — POS Module (แทรกต่อจาก Phase 2 ก่อนเริ่ม Phase 3)
เพิ่มระบบขายหน้าร้าน ต่อยอดจากกลไก Stock Out เดิม

- [x] เพิ่ม schema: `Sale`, `SaleItem`, enum `PaymentMethod`, enum `SaleStatus`, `StockTransaction.saleId` (FK optional)
- [x] รัน migration: `20260903041500_add_pos` — **เขียน SQL เอง** ไม่ใช้ `migrate dev` เพราะการย้าย
      `product.category` (String) → `categoryId` (FK) ต้อง backfill ข้อมูลก่อนลบคอลัมน์ (ดูกับดักใน CLAUDE.md)
- [x] Server actions (Zod validation ตาม pattern เดียวกับ Stock In/Out เดิม):
  - `createSale` — checkout, atomic `$transaction`, กันขายเกินสต็อก
  - `voidSale` — atomic `$transaction`, ตรวจ same-day, สร้าง StockTransaction(IN) ชดเชย
  - `listSales`, `getSaleById` — สำหรับหน้าประวัติการขาย
- [x] Auto sale-number generator รูปแบบ `INV-000001` (max +1 **+ `pg_advisory_xact_lock`** — max+1 เฉย ๆ
      ชนกันจริงตอนขายพร้อมกัน 8 บิล ผ่านแค่ 5 · มีเทส concurrent ยืนยัน)
- [x] หน้า `/pos` — product picker + cart + checkout dialog + receipt/print view
- [x] หน้า `/pos/history` — list + filter วันที่/สถานะ + void action
- [x] Sidebar: เพิ่มเมนู "ขายหน้าร้าน (POS)" และ "ประวัติการขาย"
- [x] Dashboard: การ์ดยอดขายวันนี้ / จำนวนบิลวันนี้ / รายการขายล่าสุด
- [x] `/reports`: กราฟยอดขาย 30 วัน, สินค้าขายดี Top N, สัดส่วนวิธีชำระเงิน
- [x] Seed script: เพิ่มตัวอย่างบิลขาย ~5-10 บิล (คละวิธีชำระเงิน + มีบิล voided อย่างน้อย 1 บิล) สำหรับ demo/report
- [x] เพิ่ม schema: `Category`, เปลี่ยน `Product.category` (String) เป็น `Product.categoryId` (FK → Category) +
      migrate ข้อมูลหมวดหมู่เดิมที่เป็น string ให้กลายเป็น Category record
- [x] เพิ่ม schema: `CashierClosing` + unique `(cashierId, closingDate)`
- [x] Server actions: `createCategory`, `updateCategory`, `deleteCategory` (block ถ้ามีสินค้าผูกอยู่)
- [x] Server actions: `closeCashierDay` (atomic — สรุปยอด + บันทึก CashierClosing), `getTodayClosingStatus`,
      `listClosingHistory`
- [x] แก้ `voidSale` ให้ตรวจก่อนว่ามี `CashierClosing` ของแคชเชียร์+วันนั้นแล้วหรือยัง ถ้ามี → ปฏิเสธการ void
- [x] หน้า `/categories` (list + create/edit/delete dialog)
- [x] หน้า `/pos/closing` (สรุปยอดวันนี้ + ฟอร์มนับเงินสด + ประวัติปิดยอด)
- [x] Sidebar: เพิ่มเมนู "หมวดหมู่สินค้า" และ "ปิดยอดประจำวัน"
- [x] ตรวจสอบ: ขายเกินสต็อกที่มี → ถูกปฏิเสธทั้งบิล ไม่ตัดสต็อกบางส่วน; checkout และ void เป็น atomic ทั้งคู่
      (ทดสอบ concurrent checkout ไม่ทำให้สต็อกติดลบ); ตัวเลข Dashboard/Reports ตรงกับข้อมูล Sale จริงเสมอ
      รวมถึงหลัง void; ลบหมวดหมู่ที่มีสินค้าผูกอยู่ไม่ได้; ปิดยอดซ้ำวันเดิมไม่ได้; void บิลหลังปิดยอดแล้วไม่ได้

> ℹ️ **Phase 2.6 (Role-Based Permission) ถูกยกออกจากไทม์ไลน์ v1 แล้ว** — checklist เดิมย้ายไปอยู่ท้ายหัวข้อนี้
> ใต้ Phase 5 ในชื่อ "Phase ถัดไป (ยังไม่กำหนดวัน)" · เหตุผลดูที่ [§7 Out of Scope](#7-out-of-scope-v1)

### ✅ Phase 3 — Agentic Quality (วันที่ 3)
ยกระดับคุณภาพด้วย agent, MCP และ automation

- [x] Sub-agent: `code-reviewer` (รีวิวโค้ดตาม convention โปรเจกต์)
- [x] Sub-agent: `test-writer` (เขียน/เติม test ให้ฟีเจอร์)
- [x] Sub-agent: `security-auditor` (ตรวจช่องโหว่/แนวปฏิบัติด้านความปลอดภัย)
- [x] MCP integration: **PostgreSQL MCP** (query/inspect DB) + **GitHub MCP** (issue/PR)
      — `.mcp.json` (อยู่ใน `.gitignore` เพราะมี credential) + `.mcp.json.example` ที่ commit ไว้ให้ทีมคัดลอก
      > ⚠️ กับดัก: connection string ใน `.mcp.json` ต้องตรงกับ `DATABASE_URL` ใน `.env` เป๊ะ ๆ
      > (host/port/user/ชื่อฐาน) ถ้าชี้ไปฐานที่ไม่มีอยู่จริง MCP จะต่อไม่ติดแบบเงียบ ๆ ·
      > GitHub MCP ให้อ่าน token จาก `${GITHUB_TOKEN}` **ห้ามเก็บ token ไว้ในไฟล์**
- [x] Hooks: lint / format อัตโนมัติหลังแก้ไขโค้ด (post-edit hook)
      — `.claude/settings.json` (commit เข้า git ให้ทีมใช้ร่วมกัน) เรียก `.claude/hooks/post-edit.mjs`
      ทุกครั้งที่ `Edit`/`Write` ไฟล์ `.ts`/`.tsx`: รัน `eslint --fix` เฉพาะไฟล์นั้น แล้วเตือนถ้าเจอ
      semicolon ปิดท้ายบรรทัด (กติกาข้อ 1) · เขียนเป็น Node ไม่ใช่ shell เพราะเครื่อง Windows ของทีมไม่มี `jq`
- [x] ตรวจสอบ: แก้โค้ดแล้ว hook รัน lint อัตโนมัติ, เรียก sub-agent ทำงานได้
      — ทดสอบ hook ด้วยการป้อน payload จริงเข้า stdin: ไฟล์สะอาดต้องเงียบ, ไฟล์ที่มี semicolon ต้องรายงานเลขบรรทัดถูกต้อง
      > ⚠️ MCP ต่อฐานจริงได้ต่อเมื่อเปิด Docker Desktop (พอร์ต 5435) และเปิด Claude Code ใหม่ · ตรวจด้วย `/mcp`

### ✅ Phase 4 — Team & Containerization (วันที่ 4)
ทำงานเป็นทีมและแพ็กเป็น container

- [x] แชร์ `.claude/` config ผ่าน Git ให้ทีมใช้ร่วมกัน (agents, commands, hooks, settings)
- [x] Git workflow: commit message convention (Conventional Commits) — [`CONTRIBUTING.md`](../CONTRIBUTING.md)
      (ตาราง type/scope, กติกาตั้งชื่อ branch, checklist ก่อนเปิด PR, สิ่งที่เกิดขึ้นหลัง merge เข้า `main`)
- [x] PR template + แนวทาง code review — [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md)
      มี checklist แยกตามสิ่งที่แตะ (สต็อก/เงิน · Server Action · schema) และหัวข้อ "ผลกระทบตอน deploy"
      · แนวทาง review 5 ข้อเรียงตามความสำคัญอยู่ท้าย `CONTRIBUTING.md`
- [x] `Dockerfile` แบบ multi-stage build (ใช้ Next.js `output: 'standalone'`)
      — stage `runner` (แอป) + stage `migrator` (prisma CLI + schema + migrations + seed)
- [x] `docker-compose.yml` (บริการ app + postgres) + healthcheck
      · `docker-compose.prod.yml` (stack บน VPS) ต้อง commit เข้า git ด้วย — CI scp ทับไฟล์บน server ทุกครั้งที่ deploy
- [x] CI ด้วย GitHub Actions: build + push image ไป `ghcr.io` (`:latest` + `:sha-xxxx` และ `:latest-migrate`)
- [x] ตรวจสอบ: `docker compose up` รันแอป + DB ได้ครบ, CI ผ่านและ push image สำเร็จ

### ⏭️ Phase 5 — Production (วันที่ 5)
นำขึ้น production พร้อมความปลอดภัยและการดูแล

- [x] Deploy บน VPS Ubuntu: SSH hardening (ปิด password login, key-only), สร้าง user ไม่ใช่ root
      > รัน `ops/setup-vps.sh` บน VPS แล้ว (2026-09-04) · ตรวจจากภายนอกผ่านทั้งสองเงื่อนไข:
      > ล็อกอินด้วย key ได้ปกติ และ `ssh -o PubkeyAuthentication=no` ได้ `Permission denied (publickey)`
      > · `sshd -T` ยืนยัน `permitrootlogin no` + `passwordauthentication no` · fail2ban `active`
      > ⚠️ สคริปต์เดิมเขียน `/etc/sudoers.d/90-deploy` เป็น `NOPASSWD:ALL` = ใครได้ SSH key
      > (ซึ่งเก็บใน GitHub Secrets ของ CI ด้วย) ก็ได้ root ทันที — **ลบไฟล์นั้นออกแล้ว** และแก้สคริปต์
      > ให้เปิด NOPASSWD:ALL เฉพาะตอนบัญชียังไม่มีรหัสผ่านเท่านั้น
      > 🔧 `ops/setup-vps.sh` ทำครบทั้ง user `deploy` + fail2ban + drop-in `01-hardening.conf` แล้ว
      > **แต่ยังไม่เคยรันบน VPS** — ต้องรันด้วยมือพร้อม public key จริง (พลาดแล้วล็อกตัวเองออกจากเครื่องได้)
      — ใช้ user `deploy` (ไม่ใช่ root) · เปิด fail2ban ให้ `active` · รัน `harden-ssh.sh`
      เกณฑ์ผ่าน (ตรวจจากภายนอก): ต่อด้วย password → `Permission denied (publickey)` และเข้าด้วย key ได้ปกติ
      > กับดัก: แก้ `PasswordAuthentication` ใน `/etc/ssh/sshd_config` เฉย ๆ **ไม่มีผล** เพราะ Ubuntu
      > `Include /etc/ssh/sshd_config.d/*.conf` ไว้บรรทัดบนสุดและ OpenSSH ใช้ "ค่าแรกที่เจอชนะ" —
      > ไฟล์ `60-cloudimg-settings.conf` ของผู้ให้บริการจึงชนะเสมอ ต้องวางไฟล์ที่เรียงมาก่อน
      > (`01-hardening.conf`) หรือปิดบรรทัดในไฟล์นั้นด้วย
- [x] UFW firewall (เปิดเฉพาะ 22/80/443) — `ufw` ต้องมีสถานะ `active/enabled` และตรวจจากภายนอกแล้ว
      > `ufw status` = `active` เปิดเฉพาะ OpenSSH / 80/tcp / 443/tcp · `ss -tln` ยืนยันว่าแอปทั้งสองสี
      > ผูกกับ 127.0.0.1 เท่านั้น และ postgres ไม่ map ออก host เลย จึงไม่ทะลุ UFW ผ่าน iptables ของ Docker
      > 🔧 อยู่ในขั้นที่ 4 ของ `ops/setup-vps.sh` แล้ว · **รันพร้อมกับ SSH hardening ข้างบน**
      > พอร์ตของแอปทั้งสองสีผูกกับ 127.0.0.1 อยู่แล้ว จึงไม่ทะลุ UFW ผ่าน iptables ของ Docker
      ต้องเปิดเฉพาะ 22/80/443 จริง (3000 และ 5432 ต้องปิด)
      > ⚠️ Docker เขียน iptables เองจึง **ทะลุกฎ UFW** ได้: พอร์ตที่ `ports:` ประกาศไว้จะเปิดออกเน็ต
      > แม้ UFW จะ deny — ต้องผูกเป็น `127.0.0.1:3000:3000` ใน `docker-compose.prod.yml` เสมอ
      > (ให้ nginx ต่อผ่าน loopback)
- [x] Nginx reverse proxy ไปยัง app container (`/etc/nginx/sites-enabled/posmobileorder` → `127.0.0.1:3001`,
      gzip + cache `/_next/static` 1 ปี)
- [x] HTTPS ด้วย Let's Encrypt (certbot) + auto-renew (cert `posqr.jayjayservices.com` ออกโดย Let's Encrypt,
      `/etc/cron.d/certbot` ต่ออายุอัตโนมัติ, HTTP → HTTPS 301)
- [x] CD อัตโนมัติ: pull image ใหม่ + **zero-downtime restart** — ปลดเงื่อนไข `vars.DEPLOY_ENABLED`
      > ตั้งบน VPS แล้วด้วย `ops/setup-zero-downtime.sh` · `ops/verify-zero-downtime.sh` วัดจริงบน
      > production: **36 คำขอ ล้ม 0 ครั้ง** ตลอดช่วงสลับ green → blue (2026-09-04)
      > · sudoers แบบจำกัด (`nginx -t` / `-s reload` / `tee` upstream) พิสูจน์แล้วว่าพอสำหรับ CI
      > หลังถอด `NOPASSWD:ALL` ออก · คอนเทนเนอร์เดิมชื่อ `posmobileorder-app` ถูกลบทิ้งแล้ว
      > (ไม่งั้นจองพอร์ต 3001 ค้างจนสลับรอบถัดไปชนพอร์ต)
      > **หมายเหตุ**: job `deploy` ของ CI จะได้วิ่งเส้นทางใหม่นี้ครั้งแรกตอน merge เข้า `main`
      > 🔧 **โค้ดครบแล้ว รอรันบน VPS**: `docker-compose.prod.yml` แยกเป็น `app-blue`/`app-green`
      > (profile ละสี ผูก 127.0.0.1 ทั้งคู่) · `ops/switch-deploy.sh` สลับสี · `ops/setup-zero-downtime.sh`
      > ตั้งเครื่องครั้งเดียว (upstream + sudoers เฉพาะ `nginx -t`/`-s reload` + `max-concurrent-downloads`)
      > · CI เรียงเป็น pull → migrate → `switch-deploy.sh` แล้ว
      > **ติ๊กได้เมื่อรัน `bash ops/verify-zero-downtime.sh` บน VPS แล้วได้ล้ม 0 ครั้ง**
      ลำดับใน job `deploy`: tag image เดิมเป็น `:previous` → pull → **migrate ก่อน** →
      `ops/switch-deploy.sh` สลับ blue/green
      - รันแอปสองชุดสลับกัน `app-blue` (127.0.0.1:3001) / `app-green` (3002) — สีเดียวเท่านั้นที่รับ traffic
      - nginx ชี้ผ่าน `upstream pos_app` ใน `/etc/nginx/conf.d/pos-upstream.conf` ที่สคริปต์เขียนทับทุกครั้ง
      - สตาร์ตสีใหม่ → รอ healthcheck → ตรวจพอร์ตซ้ำ → สลับ upstream → `nginx -s reload` (graceful) →
        ยืนยันผ่าน HTTPS → **ค่อยหยุดสีเก่า** · ล้มขั้นไหนก็ไม่แตะ nginx ของเดิมยังรับ traffic ต่อ
      - ตั้งค่าครั้งเดียวด้วย `sudo bash ops/setup-zero-downtime.sh` (เปิด NOPASSWD เฉพาะ `nginx -t`/`-s reload`)
      - **เกณฑ์ผ่าน: ยิง `/api/health` ทุก 0.2 วินาทีตลอดช่วงสลับสี ต้องไม่มีคำขอใดล้มเลย (ล้ม 0 ครั้ง)**
      > ⚠️ กับดัก: ช่วง `docker pull` image ใหม่ (~300MB บนเครื่อง 2 vCPU) แอปอาจตอบช้าจน
      > timeout ได้ราว 40 วินาที **ก่อน** ถึงขั้นสลับสี — ลดผลกระทบด้วยการตั้ง
      > `max-concurrent-downloads` ใน `/etc/docker/daemon.json` (ต้องใช้ sudo)
- [x] Backup strategy: dump PostgreSQL ตามรอบ — `ops/backup-db.sh` + cron ทุกวัน 03:17
      (`pg_dump -Fc` → ตรวจไฟล์ด้วย `pg_restore --list` → เก็บย้อนหลัง 14 วัน → ล้มเหลวเมื่อไหร่ส่งอีเมลเตือน)
      · ซ้อมกู้คืนด้วย `ops/restore-db.sh --drill` — ต้องกู้ได้ครบทุกตารางโดยไม่แตะฐานจริง
      · **สำเนาที่สองนอก VPS**: `ops/pull-backup.ps1` + Windows Task Scheduler (`MJD-PullBackup`)
      ดึง dump ลงเครื่องผู้ใช้ (`D:\MJD_Backup`) ทุกวัน 20:00 เก็บย้อนหลัง 60 วัน
      > ⚠️ สำเนาที่สองดึงได้ **เฉพาะตอนเปิดเครื่อง** ถ้าปิดคอมยาวจะได้เท่าที่ VPS ยังไม่หมุนทิ้ง (14 วัน)
      > ถ้าต้องการสำเนาที่ทำงานตลอดเวลา ติดตั้ง `rclone` แล้วตั้ง `BACKUP_REMOTE=` ใน `.env`
      > (ให้ `ops/backup-db.sh` รองรับ path นี้ไว้ตั้งแต่แรก เผื่อต่อปลายทาง S3/B2 ภายหลัง)
- [x] Rollback strategy: กลับไป image เวอร์ชันก่อนหน้าได้ — `ops/rollback.sh <tag>`
      > ทดสอบบน production แล้ว: `latest` → `previous` → `latest` ผ่านทั้งสองทาง health 200 ทุกครั้ง
      > และย้อนแบบไม่มี downtime ด้วยเพราะเรียก `switch-deploy.sh` ต่อ (2026-09-04)
      > 🔧 สคริปต์พร้อมแล้ว และย้อนแบบไม่มี downtime ด้วย (เรียก `switch-deploy.sh` ต่อ)
      > **เหลือทดสอบสลับ `latest` ↔ `previous` บน VPS จริง — health ต้องผ่านทั้งสองทาง**
      เปลี่ยน `APP_TAG` ใน `.env` → pull (หรือใช้ image บนเครื่องถ้าดึงไม่ได้) → `up -d --wait` → เช็ก health
      ไม่ผ่านใน 60 วิ ย้อนค่ากลับให้เอง · CD เก็บ tag `:previous` ไว้ทุกครั้งจึงย้อนได้แม้ registry ล่ม
      · ทดสอบสลับ `latest` ↔ `previous` — health ต้องผ่านทั้งสองทาง
- [x] Monitoring: health check endpoint + alert เมื่อ service ล่ม — `/api/health` + `ops/health-alert.sh`
      > cron ทุก 5 นาทีทำงานอยู่จริงบน VPS · ทดสอบส่งอีเมลจริงผ่านครบทั้งสองทิศทาง (2026-09-04):
      > ล้มครั้งแรกไม่เตือน → ล้มครั้งที่ 2 ส่ง `ปกติ→ล่ม` → กลับมา 200 ส่ง `ล่ม→ปกติ`
      > ทดสอบด้วย `STATE_FILE`/`HEALTH_URL` แยก จึงไม่แตะ state ของ cron จริง
      > 🐞 **เจอบั๊กจริงตอนทดสอบ**: `json_str()` ใน `lib-common.sh` ใช้ `s/$/\\n/` ซึ่ง sed มองว่า
      > "ทุกบรรทัด" รวมบรรทัดสุดท้าย จึงเติม `\n` ต่อท้าย subject เสมอ แล้ว Resend ตอบ 422
      > `The \\n is not allowed in the subject field` — **อีเมลแจ้งเตือนไม่เคยส่งออกได้เลย**
      > ทั้งที่ทุกอย่างอื่นถูกหมด · host ไม่มี `node` (อยู่แต่ในคอนเทนเนอร์) เส้นทางที่ทำงานจริงจึงเป็น
      > fallback sed เสมอ — เวลาแก้ต้องทดสอบเส้นทางนั้น ไม่ใช่เส้นทาง node
      > `ALERT_EMAIL` ชี้กล่องจดหมายจริงของผู้ดูแลแล้ว และยิงทดสอบผ่านทั้งสองทิศทาง
      > ⚠️ ปลายทางต้องเป็นกล่องที่ **รับอีเมลขาเข้าได้จริง** — `mail.jayjayservices.com` กับ
      > `jayjayservices.com` ไม่มี MX เลย (ตั้งไว้ส่งออกอย่างเดียว) ตั้งเป็น `no-reply@` ของโดเมนนี้
      > จะ hard-bounce ทุกฉบับ เท่ากับระบบล่มแล้วไม่มีใครรู้
      > cron ทุก 5 นาทีทำงานอยู่จริงบน VPS แล้ว (log `ปกติ (HTTP 200)` ต่อเนื่อง)
      > ทดสอบตรรกะเปลี่ยนสถานะครบทั้งสองทิศทางด้วย `STATE_FILE`/`HEALTH_URL` แยก (ไม่แตะ state ของ cron จริง):
      > ล้มครั้งแรกไม่เตือน → ล้มครั้งที่ 2 เตือน `ปกติ→ล่ม` → กลับมา 200 เตือน `ล่ม→ปกติ`
      > **ติ๊กได้เมื่อเติม `RESEND_API_KEY`/`MAIL_FROM`/`ALERT_EMAIL` ลง `.env` บน server แล้วได้รับอีเมลจริง**
      > 🔧 สคริปต์พร้อมแล้ว (อ่านคอนเทนเนอร์ของสีที่รับ traffic อยู่ผ่าน `active_app_container`)
      > **เหลือติดตั้ง cron บน VPS แล้วทดสอบส่งจริงทั้งสองทิศทาง (ปกติ→ล่ม, ล่ม→ปกติ)**
      cron ทุก 5 นาที ส่งอีเมลผ่าน Resend **เฉพาะตอนสถานะเปลี่ยน** (ปกติ→ล่ม, ล่ม→ปกติ) ไม่สแปมซ้ำ
      ต้องล้มติดกัน 2 ครั้งถึงเตือน กันเตือนหลอกตอน deploy · ทดสอบส่งจริงให้ครบทั้งสองทิศทาง
- [x] **ต่อ mail provider จริง (Resend HTTP API) — ย้ายฟังก์ชันส่งอีเมลออกมาไว้ที่ `lib/mail.ts`**
      (`sendVerificationMail` / `sendResetPasswordMail`) แล้วให้ `lib/auth.ts` เรียกใช้
      - ตั้งค่าผ่าน env: `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO` (ไม่บังคับ)
      - โดเมนผู้ส่งที่ verify ไว้: `mail.jayjayservices.com` (SPF `v=spf1 include:amazonses.com ~all`,
        DKIM `resend._domainkey.mail`, MX return-path `feedback-smtp.ap-northeast-1.amazonses.com`)
      - ยังไม่ตั้งค่า key → dev พิมพ์ลิงก์ลง console เหมือนเดิม · production **throw ทิ้ง** ไม่พิมพ์ลิงก์ลง log
        เพราะลิงก์ยืนยัน/รีเซ็ตรหัสผ่านคือ credential ชั่วคราว
- [x] **เปิดยืนยันอีเมลตอนสมัครสมาชิก** (`emailVerification.sendOnSignUp` + `requireEmailVerification`)
      > โค้ดครบแล้ว: `requireEmailVerification: true`, หน้า `/verify-email` + ฟอร์มขอลิงก์ใหม่,
      > `/login` ดัก `EMAIL_NOT_VERIFIED` แล้วเสนอปุ่ม “ส่งอีเมลยืนยันอีกครั้ง”
      > **เกณฑ์ผ่านบน production ยังทดสอบไม่ได้** จนกว่า `.env` บน server จะมี `RESEND_API_KEY`/`MAIL_FROM`
      - สมัครเสร็จ → ส่งลิงก์ยืนยัน (อายุ 1 ชม.) → หน้าสมัครเปลี่ยนเป็นการ์ด "ตรวจอีเมลของคุณ" + ปุ่มส่งซ้ำ
      - บัญชีที่ยังไม่ยืนยันล็อกอินไม่ได้ (403 `EMAIL_NOT_VERIFIED`) — หน้า `/login` ต้องดักไว้
        แล้วเสนอปุ่ม "ส่งอีเมลยืนยันอีกครั้ง"
      - หน้าใหม่ `/verify-email` (public ใน `proxy.ts`) เป็นปลายทางหลังกดลิงก์ — สำเร็จแสดงการ์ดพร้อมปุ่มไปล็อกอิน
        ล้มเหลว (`?error=TOKEN_EXPIRED|INVALID_TOKEN|…`) แสดงเหตุผลภาษาไทย + ฟอร์มขอลิงก์ใหม่
      - เกณฑ์ผ่าน (ทดสอบบน production): ส่งผ่าน Resend ได้ message id,
        สมัคร → `emailVerified=false` + ไม่ auto sign-in, ล็อกอินก่อนยืนยัน → 403 `EMAIL_NOT_VERIFIED`,
        ขอลิงก์ใหม่ → 200, ไม่มี error ใน log ฝั่งแอป และชื่อภาษาไทยเก็บถูกต้อง (นับไบต์ UTF-8 ไม่เพี้ยน)
- [ ] ตรวจสอบ: เข้าผ่าน HTTPS ได้, deploy ใหม่ไม่มี downtime, กู้คืนจาก backup ได้,
      สมัครสมาชิกแล้วได้รับอีเมลยืนยันจริงและยืนยันสำเร็จ,
      ขอลิงก์ลืมรหัสผ่านแล้วได้รับอีเมลจริงและตั้งรหัสผ่านใหม่สำเร็จ
      - [x] เข้าผ่าน HTTPS ได้ (HTTP → HTTPS 301, cert Let's Encrypt ต่ออายุอัตโนมัติ)
      - [x] กู้คืนจาก backup ได้ — ซ้อมด้วย `restore-db.sh --drill` ต้องกู้ครบทุกตารางโดยไม่แตะฐานจริง
      - [ ] สมัครสมาชิกแล้วได้รับอีเมลยืนยันจริงและยืนยันสำเร็จ (`emailVerified = true` ใน production)
            > ⛔ **ทดสอบตามข้อนี้ไม่ได้ใน v1 โดยตั้งใจ** — `disableSignUp: true` ปิดการสมัครเองไว้
            > บัญชีทั้งหมดสร้างด้วย `pnpm db:create-user` ซึ่งตั้ง `emailVerified = true` มาแล้ว
            > กลไกส่งอีเมลตัวเดียวกัน (`deliver()` → Resend) พิสูจน์แล้วผ่านเส้นทางลืมรหัสผ่านข้างบน
            > จะติ๊กข้อนี้ได้ต่อเมื่อเปิดสมัครเองพร้อม invite/allowlist ในเฟสถัดไป
            > ⚠️ กับดัก: ถ้าโดเมนผู้ส่งยังไม่มีเรคคอร์ดของตัวเองใน DNS (query แล้วได้ NXDOMAIN) อีเมล
            > จะเข้า junk — ต้องเพิ่ม TXT `v=spf1 include:amazonses.com -all` ที่ host ของโดเมนผู้ส่ง
            > แล้วรอชื่อเสียงโดเมนสะสม
      - [x] เส้นทางอีเมลลืมรหัสผ่าน — `request-password-reset` ต้องตอบ 200 และ Resend รับงานโดยไม่มี error
            > ทดสอบบน production แล้ว (2026-09-04): HTTP 200 และ log ของแอปไม่มีบรรทัด
            > `[mail] ส่งอีเมลตั้งรหัสผ่านใหม่ไม่สำเร็จ` แปลว่า `deliver()` ได้ 2xx จาก Resend
            > credential พร้อมแล้วและพิสูจน์แล้วว่าใช้ได้: ยิง `POST https://api.resend.com/emails` จาก
            > production ตรง ๆ ได้ HTTP 200 + message id · DNS ตรวจจาก 8.8.8.8 ครบ (SPF `-all` ที่
            > `mail.jayjayservices.com`, DKIM `resend._domainkey.mail`, MX return-path, DMARC `p=none`)
            > **ติ๊กไม่ได้จนกว่าจะ merge** — image ที่รันบน production ตอนนี้ยังเป็นตัวเก่าที่
            > `lib/mail.ts` ยัง throw "ยังไม่ได้ต่อ Resend" อยู่
      - [x] deploy ใหม่ไม่มี downtime — blue/green + `nginx -s reload` แบบ graceful
            (วัดจริง 2026-09-04: 36 คำขอ ล้ม 0 ครั้ง ตลอดช่วงสลับสี)
            (วัดระหว่างสลับสี: ทุกคำขอต้องผ่าน ล้ม 0 ครั้ง)
      - [x] backup เก็บนอกเครื่อง — ดึงลงเครื่อง Windows ทุกวัน 20:00 (ข้อจำกัด: เฉพาะตอนเปิดเครื่อง)
      - [x] ทดสอบระบบเต็มรูปแบบบน production: หน้าสาธารณะต้องตอบ 200 ·
            หน้าในระบบต้องเด้งไป `/login?callbackUrl=…` เมื่อยังไม่ล็อกอิน ·
            ล็อกอินแล้วต้องเข้าได้ครบทุกหน้าและ render ภาษาไทยครบ
            > ทดสอบด้วย session จริง (2026-09-04): 16 หน้าตอบ 200 ครบและมีภาษาไทยทุกหน้า —
            > `/`, products, categories, stock-in/out, reports, users, settings, pos ทั้ง 3 หน้า
            > และ mobile-order ทั้ง 5 หน้า · ยังไม่ล็อกอิน → 307 ไป `/login?callbackUrl=…` ทุกหน้า
            หน้าในระบบต้องเด้งไป `/login?callbackUrl=…` เมื่อยังไม่ล็อกอิน ·
            ล็อกอินแล้วต้องเข้าได้ครบทุกหน้า (dashboard, pos, pos/history, pos/closing, products,
            categories, stock-in, stock-out, reports, users, settings + หน้า MJD Mobile Order
            ตาม [§6a](#6a-routes--ui-mjd-mobile-order)) และ render ภาษาไทยครบทุกหน้า

### ⏭️ Phase ถัดไป (ยังไม่กำหนดวัน) — Role-Based Permission
> ⛔ **นอกขอบเขต v1** — พิมพ์เขียวสำหรับเฟสถัดไป (ดู [§7 Out of Scope](#7-out-of-scope-v1))
> เดิมคือ "Phase 2.6" ที่แทรกอยู่ระหว่าง Phase 2.5 กับ Phase 3 — ยกออกจากไทม์ไลน์ v1 แล้ว
> เริ่มทำเมื่อ Phase 1–5 ปิดครบและมีการอนุมัติขอบเขตใหม่ · ไม่นับรวมใน
> [§9 Definition of Done](#9-เกณฑ์ความสำเร็จโดยรวม-definition-of-done) ของ v1

เพิ่มระบบสิทธิ์ผู้ใช้ให้ Better Auth ครอบทุกหน้าที่มีอยู่ในระบบ (F1–F9)

- [ ] เพิ่ม schema: `Role`, `RolePermission`, enum `PermissionAction`, enum `ResourceKey`
- [ ] เพิ่ม `roleId` ให้ตาราง `user` ของ Better Auth ผ่าน `additionalFields` แล้ว sync ด้วย
      `npx @better-auth/cli generate`
- [ ] รัน migration: `prisma migrate dev --name add_rbac`
- [ ] Seed บทบาทเริ่มต้น 3 บทบาท: ผู้ดูแลระบบ (Full ทุก resource, `isSystem=true`), ผู้จัดการร้าน, แคชเชียร์
      ตามตารางสิทธิ์เริ่มต้นใน [4. ระบบสิทธิ์ผู้ใช้](#4-ระบบสิทธิ์ผู้ใช้-better-auth--role-based-permission)
- [ ] เขียน helper กลาง `requirePermission(resource, action)` เรียกใช้ต้นทุก Server Action ที่มีผลต่อข้อมูล
      (add/edit/delete) ของทุกโมดูล (Products, Categories, Stock In/Out, POS, POS History, POS Closing, Users)
- [ ] เพิ่ม page guard ฝั่ง server เช็คสิทธิ์ `VIEW` ก่อน render ทุกหน้า — ไม่ผ่าน → redirect ไปหน้า Access Denied
- [ ] Sidebar: กรองเมนูตามสิทธิ์ `VIEW` ของผู้ใช้ที่ login อยู่ (ซ่อนเมนูที่ไม่มีสิทธิ์)
- [ ] ปุ่ม เพิ่ม/แก้ไข/ลบ ในทุกหน้าที่มีอยู่แล้ว (Products, Categories, Stock In/Out, POS History) ผูกกับสิทธิ์
      ที่ตรงกันของ resource นั้น (ซ่อน/ปิดใช้งานเมื่อไม่มีสิทธิ์)
- [ ] Server actions: `createRole`, `updateRole`, `deleteRole` (block role ที่ `isSystem=true`), `assignUserRole`
- [ ] หน้า `/roles` — list บทบาท + ตาราง matrix แก้สิทธิ์ (View/Add/Edit/Delete + ปุ่มลัด Full/Readonly)
- [ ] หน้า `/users` — เพิ่มคอลัมน์ Role + dropdown เปลี่ยน role ต่อผู้ใช้
- [ ] Sidebar: เพิ่มเมนู "บทบาทและสิทธิ์" (แสดงเฉพาะผู้มีสิทธิ์ `USERS:EDIT`)
- [ ] ตรวจสอบ: ผู้ใช้ที่ `roleId=null` เข้าได้เฉพาะ `/settings`; ไม่มีสิทธิ์ View → เมนูหายและเข้า URL ตรงถูก
      block; ไม่มีสิทธิ์ Add/Edit/Delete → เรียก Server Action ตรงถูกปฏิเสธแม้ UI ไม่ได้ซ่อนปุ่ม; ลบ/เปลี่ยน role
      ผู้ดูแลระบบคนสุดท้ายไม่ได้; แก้ชื่อ/ลบบทบาทระบบไม่ได้

### ✅ Phase 6 — MJD Mobile Order: Data Model & Table/Session Core
- [x] Schema: `Table`, `TableSession`, `MenuItem`, `ModifierGroup`, `ModifierOption`, `MobileOrder`,
      `MobileOrderItem`, `QRCode`, `Notification`, `LineNotificationLog`, `StoreSettings`, `Member`,
      `MemberPointTransaction` + ทุก enum ใหม่ + แก้ `Sale` (`channel`, `tableSessionId`)
- [x] Migration: `prisma migrate dev --name add_mobile_order`
- [x] Seed: โต๊ะตัวอย่าง 16 โต๊ะ, เมนูตัวอย่าง 15–20 รายการ (มี featured 6, มี modifier), `StoreSettings` เริ่มต้น
- [x] Server actions หลัก: `openTableSession`, `mergeTables`, `unmergeTables`, `cancelTableSession`
- [x] ตรวจสอบ: เปิด/รวม/ยกเลิกโต๊ะผ่าน server action ได้ครบ ผ่าน `prisma studio`

### ✅ Phase 7 — Staff Table Overview, Notifications & Merge UI
- [x] หน้า `/mobile-order/tables` (grid + filter + 2 จุดเวลาใหม่)
- [x] หน้า `/mobile-order/notifications` (2 จุดเวลาใหม่ + acknowledge)
- [x] Sidebar: เพิ่มกลุ่มเมนู MJD Mobile Order
- [x] ตรวจสอบ: รวมโต๊ะแล้วบิลรวมเข้าโต๊ะหลักถูกต้อง, เวลาเปิดโต๊ะ/นาทีที่เปิดแสดงถูกทั้ง 2 หน้า

> ⚠️ **กับดัก**: อย่าเก็บ "นาทีที่เปิดโต๊ะ" เป็นฟิลด์ที่คำนวณครั้งเดียวตอนสร้างการ์ด — ต้องคำนวณสดจาก `openedAt`
> ทุกครั้งที่ render/refresh มิฉะนั้นตัวเลขจะค้าง

### ⏭️ Phase 8 — Kitchen Ticket Flow (Printer + KDS) & Per-Item Cancel
- [x] พิมพ์ทิกเก็ตครัวได้ทันทีที่ `MobileOrder` ถูกสร้าง — **พิมพ์ผ่านเครื่องพิมพ์ PDF**
      > หน้า `/tickets/[orderId]` เป็นทิกเก็ตขนาดใบเสร็จ · `?auto=1` เปิดกล่องพิมพ์ให้ทันที แล้วเลือก
      > เครื่องพิมพ์เป็น “Microsoft Print to PDF” / “Save as PDF” · ปุ่มอยู่ทั้งบน KDS และหน้ารายละเอียดโต๊ะ
      > ผลการพิมพ์บันทึกที่ `MobileOrder.printedAt` (ประทับครั้งแรกครั้งเดียว ไม่เลื่อนเวลาเมื่อพิมพ์ซ้ำ)
      > **เบราว์เซอร์เป็นตัวสร้าง PDF โดยตั้งใจ** — ไลบรารี PDF ฝั่ง server ต้องฝังฟอนต์ไทยเอง ซึ่งเป็นจุดที่
      > สระ/วรรณยุกต์ลอยบ่อยที่สุด · ไดรเวอร์ ESC/POS เดิมที่ `lib/kitchen-printer.ts` ยังอยู่ครบและ
      > ทำงานทันทีที่ตั้ง `KITCHEN_PRINTER_HOST` (ใช้คู่กันได้ ไม่ใช่ทางเลือกแทนกัน)
      > 🔧 เขียนไดรเวอร์ไว้แล้วที่ `lib/kitchen-printer.ts` (ESC/POS over TCP พอร์ต 9100 + code page ไทย PC874)
      > เปิดใช้ด้วย env `KITCHEN_PRINTER_HOST` · ไม่ตั้ง = ไม่มีเครื่องพิมพ์ ระบบทำงานต่อได้ปกติ
      > **ยังติ๊กไม่ได้เพราะต้องทดสอบกับเครื่องพิมพ์จริงในร้าน** (ผลการพิมพ์บันทึกที่ `MobileOrder.printedAt`)
- [x] หน้า `/mobile-order/kitchen` (KDS 3 คอลัมน์ + ปุ่มเริ่มทำ/เสร็จ)
- [x] Fallback ไม่มี KDS: ปุ่ม "เสิร์ฟอาหารแล้ว" บน `/mobile-order/tables/[tableId]`
- [x] ปุ่มยกเลิกรายการ (เฉพาะ `AWAITING_KITCHEN`) บนหน้ารายละเอียดออร์เดอร์โต๊ะ
- [ ] Socket.IO server ติดตั้งคู่กับ custom Next.js server สำหรับ push สถานะ POS↔ครัว
      > 🔧 **ยังไม่ทำ — ต้องตัดสินใจเรื่องสถาปัตยกรรมก่อน**: Socket.IO ต้องมี custom server ซึ่งใช้ร่วมกับ
      > `output: "standalone"` + blue/green ตอน deploy ไม่ได้ตรง ๆ · ตอนนี้ใช้ทางสำรองที่ทำงานได้จริงแทน:
      > `components/auto-refresh.tsx` (ดึงซ้ำทุก 10 วิ บน KDS, 15 วิ บนผังโต๊ะ, หยุดเมื่อแท็บถูกซ่อน)
      > `+ GET /api/mobile-order/events?since=…` ที่สเปกกำหนดไว้เป็น fallback อยู่แล้ว
- [x] ตรวจสอบ: ยกเลิกรายการหลังครัวกดเริ่มทำแล้ว → ถูกปฏิเสธเสมอ (ทดสอบ concurrent)
      — `__tests__/integration/order-items.test.ts` ยิงยกเลิกพร้อมกับ "เริ่มปรุง" ต้องสำเร็จฝั่งเดียวเสมอ

> ⚠️ **กับดัก — race condition ยกเลิก vs เริ่มทำ**: ลูกค้า/พนักงานกดยกเลิกรายการ พร้อม ๆ กับครัวกด "เริ่มทำ" บน
> KDS ต้องใช้ conditional update (`UPDATE ... WHERE status='AWAITING_KITCHEN'`) ใน `prisma.$transaction`
> ทั้งสองฝั่ง ไม่ใช่ read-then-write ธรรมดา มิฉะนั้นจะมีโอกาสยกเลิกรายการที่ครัวเริ่มทำไปแล้ว
>
> ⚠️ **กับดัก — WebSocket reconnect**: POS/KDS terminal หลุดเน็ตชั่วคราวต้องมี endpoint REST สำรอง
> (`GET /api/mobile-order/events?since=<lastSeenAt>`) ให้ดึงเหตุการณ์ที่พลาดไปตอนเชื่อมต่อกลับ ห้ามพึ่ง
> WebSocket delivery guarantee อย่างเดียว มิฉะนั้นออร์เดอร์อาจ "หาย" จากมุมมองของ POS

### ✅ Phase 9 — Customer Ordering Flow & QR Code Management
- [x] Route `/order/[qrToken]/*` ทั้งชุด (เมนู, รายละเอียด, ตะกร้า, ยืนยัน, สถานะ)
- [x] หน้า `/mobile-order/qr-codes` (generate ด้วย `qrcode` npm, bulk/individual download+reprint)
- [x] Server actions: `generateQRCode`, `invalidateQRCode`, `reprintQRCode`
- [ ] ตรวจสอบ: สแกนแล้วสั่งอาหารครบ flow ได้จริงบนมือถือ
      > ✅ ทดสอบครบ flow ด้วย integration test (__tests__/integration/customer-order.test.ts) และยิง HTTP
      > ทุกหน้าบนเครื่อง dev แล้ว · **เหลือทดสอบด้วยมือถือจริงที่สแกน QR จากหน้าจอ/กระดาษ**
      > (ต้องตั้ง APP_BASE_URL ให้ชี้โดเมนที่มือถือเปิดได้ก่อน ไม่ใช่ localhost)

> ⚠️ **กับดัก — dynamic QR reuse-after-payment race**: ต้องตรวจ `QRCode.status=ACTIVE` **และ** ไม่มี
> `TableSession` ที่ `OPEN` อยู่ของโต๊ะนั้น ในทรานแซคชันเดียวกันตอนเปิด session ใหม่ — ป้องกันลูกค้า refresh
> หน้า payment-success แล้วดันไปเปิด session ใหม่ซ้ำด้วย token เดิมก่อนพนักงานพิมพ์ใบใหม่ทัน

### ✅ Phase 10 — Payment Integration (PromptPay Webhook + Card/EDC) & Auto-Close
- [x] Route handler รับ webhook จากธนาคาร/PromptPay provider — idempotent ด้วย unique payment reference
      > `POST /api/payments/webhook` · ยืนยันตัวตนด้วย header `x-webhook-secret` เทียบแบบ timing-safe
      > payload เป็นกลาง (`reference` + `sessionId`/`qrToken` + `amount`) ถ้า provider จริงส่งรูปอื่นให้
      > เขียน adapter ที่ไฟล์นี้จุดเดียว
- [x] แก้ enum `PaymentMethod` เพิ่ม `PROMPTPAY`, `CARD` + migration
      > `20260903070000_add_payment` — เพิ่ม `Sale.paymentReference` (unique) และทำให้ `SaleItem` อ้าง
      > ได้ทั้ง `Product` (หน้าร้าน) และ `MenuItem` (Mobile Order) พร้อมชื่อรายการแบบ snapshot ในแถวเอง ·
      > `20260904030000_add_closing_card` — แยกยอดพร้อมเพย์/บัตรออกจากถัง "สแกน QR" ในใบปิดยอด
- [x] Server action `closeTableSessionByPayment` — atomic: สร้าง `Sale`+`SaleItem`, ปิด `TableSession`,
      invalidate DYNAMIC QR, คืนสถานะโต๊ะ
      > ตรรกะจริงอยู่ที่ `lib/close-session.ts` (`closeSessionWithPayment`) ใช้ร่วมกันทั้งฝั่ง webhook และ
      > `confirmMobilePayment` ที่พนักงานกด — เส้นทางเดียวกันเป๊ะ จึงไม่มีทางได้ผลต่างกัน
- [x] หน้าปิดบิล `/mobile-order/tables/[tableId]/billing` (ใบเสร็จ, service charge, ปุ่มยืนยัน Card)
- [x] ตรวจสอบ: บิลจาก mobile order ปรากฏถูกต้องใน `/pos/history`, Dashboard, `/reports`, `/pos/closing`
      — `__tests__/integration/payment.test.ts` (18 เคส) ครอบทั้ง idempotency, ปิดบิลพร้อมกัน, ค่าบริการ,
      invalidate QR, คืนโต๊ะที่รวมไว้ และการปรากฏในทุกหน้ารายงาน

> ⚠️ **กับดัก — webhook ซ้ำ/มาไม่เรียงลำดับ**: bank webhook อาจยิงซ้ำหรือมาช้ากว่าที่คาด ต้อง guard ด้วย
> unique reference ก่อนสร้าง `Sale` มิฉะนั้นจะปิดบิล/สร้างบิลซ้ำ

### ⏭️ Phase 11 — LINE Messaging Integration
- [ ] ต่อ LINE Messaging API SDK, ผูก `lineUserId` ตอนลูกค้าเปิดผ่าน LIFF/LINE
- [ ] ส่ง push 3 จุด (F19) + บันทึก `LineNotificationLog`
- [ ] ตรวจสอบ: ส่งจริง 3 ประเภทสำเร็จ, ส่งไม่สำเร็จไม่กระทบ flow ชำระเงิน

### ✅ Phase 12 — POS Manager Branding Settings & CRM/Membership MVP
- [x] หน้า `/mobile-order/settings` (โลโก้/ปก/ธีม/เมนูแนะนำ/สลับ `hasKDS`/ค่าบริการ/เปิด-ปิดระบบสมาชิก)
- [x] Schema: `Member`, `MemberPointTransaction` (สร้างไว้แล้วตั้งแต่ Phase 6) + server action `registerMember`
      ที่สมัครและให้แต้มในทรานแซคชันเดียว (idempotent ด้วย unique `MemberPointTransaction.saleId`)
      `awardPoints`
- [x] ฟอร์มสมัครสมาชิกบน payment-success (F22) — โผล่เฉพาะร้านที่เปิด `crmEnabled` ไว้
- [x] ตรวจสอบ: สมัคร+ได้แต้มอัตโนมัติถูกต้อง, สลับ `hasKDS` ถูกบล็อกขณะมีโต๊ะเปิดอยู่
      — `__tests__/integration/store-settings.test.ts` (13 เคส)

> ⚠️ **กับดัก — สลับ `hasKDS` กลางไลฟ์**: ถ้าเปลี่ยนขณะมี `TableSession.status=OPEN` อยู่ รายการที่ค้างอยู่
> ระหว่าง `COOKING`/`READY` จะกำพร้า (ไม่มีใครกด "เสิร์ฟอาหารแล้ว" เพราะ UI ไม่มีปุ่มนี้อีก) — ต้อง validate
> ที่ server action `updateStoreSettings` ปฏิเสธการสลับถ้ามี session เปิดอยู่อย่างน้อย 1 โต๊ะ

### ✅ Phase 13 — Multi-tenant: หลายร้านในระบบเดียว (`Store` + `storeId`)
> ✅ **โค้ดและเทสเสร็จแล้ว (2026-09-15)** — `pnpm test` 29 ไฟล์ / 347 เทสเขียวทั้งหมด · `prisma migrate diff` สะอาด ·
> `pnpm lint` มีกฎ `no-restricted-imports` กัน `@/lib/prisma` ใน `app/actions/**` + `lib/queries.ts` แล้ว
> (ยกเว้น 2 จุดที่จงใจ: `profile.ts` ข้อมูลของตัวผู้ใช้ · `switchActiveStore()` ค้นข้ามร้านก่อนสลับ) ·
> **ที่ยังค้าง**: ข้อสุดท้าย "production migrate + smoke test" — ต้อง `pg_dump` และซ้อมบนสำเนาก่อน merge ตามกติกา
>
> 📝 **สิ่งที่ทำต่างจากร่าง (ตัดสินใจระหว่างทำ)**:
> - ไม่มีหน้า `/select-store` — ผู้ใช้ที่อยู่หลายร้านตกไปใช้ร้านแรกโดยอัตโนมัติแล้วสลับผ่านตัวสลับร้านใน topbar ·
>   cookie ที่ชี้ร้านที่ไม่ได้เป็นสมาชิก **ไม่โยน error** แต่ตกไปร้านแรกของตัวเอง (ไม่มีทางได้ร้านนั้น — มีเทสล็อกไว้ที่
>   `__tests__/integration/store-guard.test.ts`) เพราะโยน error จะทำให้ผู้ใช้ที่ถูกถอดจากร้านค้างหน้าเปล่า
> - `Role`/`RolePermission` (§4) ถูกย้ายให้เป็นของร้านไปพร้อมกัน (`Role.storeId`, `StoreMember.roleId` แทน `User.roleId`)
>   เพราะแยกไม่ได้ — บทบาทที่ตั้งในร้าน A ต้องไม่ติดตัวไปร้าน B · OWNER ได้ทุก resource โดยไม่ต้องมี Role
> - เทส isolation จับบั๊กจริงได้ 2 จุดตอนเขียน: `createProduct`/`updateProduct` รับ `categoryId` ของร้านอื่นได้ (FK ไม่รู้ร้าน)
>   และ `markTicketPrinted` ตอบ ok:true กับออร์เดอร์ของร้านอื่น — แก้แล้วทั้งคู่
> - `nextSaleNumber()` ย้ายไป `lib/sale-number.ts` ใช้ร่วมกันทั้ง POS และ Mobile Order · lock key = `(namespace, hashtext(storeId))`
>
> 🧭 **ทิศทางใหม่ (ตัดสินใจ 2026-09-14)**: เปลี่ยนระบบจากร้านเดียวเป็น **แพลตฟอร์มให้ร้านค้าหลายรายสมัครเข้ามา
> ใช้เอง** และรับเงินเข้าบัญชีของตัวเอง · แผนแบ่งเป็น 4 เฟส — **13 แยกข้อมูลตามร้าน (เฟสนี้)** → 14 สมัคร/
> สร้างร้าน/เชิญพนักงาน → 15 ตั้งค่ารับเงินต่อร้าน 3 ระดับ (ก / ก+ / ข) → 16 ระบบสิทธิ์เต็มรูปแบบ (ถ้าต้องการ)
> · เฟส 13 เป็น**ฐานที่ทุกเฟสถัดไปต้องพึ่ง** ไม่ว่าจะเลือกวิธีรับเงินแบบใด
>
> ⚠️ **ปลดล็อกขอบเขตบางส่วนจาก §7**: (1) multi-store ย้ายเข้า scope แล้ว (2) RBAC **ขั้นต่ำ 2 บทบาท
> `OWNER` / `STAFF` ต่อร้าน** ทำในเฟสนี้เพราะแยกไม่ได้จากการมีหลายร้าน (เจ้าของร้านต้องคุมบัญชีรับเงิน/พนักงาน)
> · ตาราง matrix สิทธิ์ราย resource (F10, `Role`/`RolePermission`) **ยังคงถูกพักไว้** ตามหัวข้อ
> "Phase ถัดไป — Role-Based Permission" ไม่เอามาทำปนในเฟสนี้

**การตัดสินใจเชิงสถาปัตยกรรมที่ล็อกแล้ว (ห้ามเปิดคุยใหม่ระหว่างทำ)**
- **ฐานเดียว + คอลัมน์ `storeId`** (shared database, row-level) — ไม่แยก schema/ฐานต่อร้าน เพราะ Prisma/migration/
  blue-green deploy ทั้งหมดออกแบบมาสำหรับฐานเดียว
- เอนทิตีร้านชื่อ **`Store`** — ห้ามใช้ `Member` (นั่นคือ**ลูกค้า**สะสมแต้มของร้าน) และห้ามใช้ `Tenant`
  (ผู้ใช้ไม่รู้จักคำนี้ ข้อความ UI ต้องเป็น "ร้าน")
- `StoreSettings` เลิกเป็น singleton → **1 แถวต่อร้าน** (`id = storeId`, FK unique) — ค่าเริ่มต้นถูกสร้างพร้อมร้าน
  ในทรานแซคชันเดียวกันเสมอ ไม่มีร้านที่ไม่มี settings
- ผู้ใช้ 1 คนอยู่ได้หลายร้านผ่านตารางกลาง `StoreMember` — **ห้ามเพิ่ม `storeId` ลงตาราง `user`** ของ Better Auth
- **ร้านที่กำลังทำงานอยู่ (active store) ผูกกับ session ฝั่งเซิร์ฟเวอร์** (cookie `activeStoreId` ที่ต้องถูกตรวจกับ
  `StoreMember` **ทุกคำขอ** ห้ามเชื่อค่าใน cookie ตรง ๆ) · ไม่ใช้ subdomain ต่อร้านในเฟสนี้ (ต้อง wildcard DNS +
  cert — ยกไปเฟสหลัง)
- **ฝั่งลูกค้าไม่ต้องแก้ URL** — `qrToken` → `QRCode.storeId` เป็นตัวบอกร้านอยู่แล้ว ธีม/ชื่อร้าน/ค่าบริการ
  อ่านจาก `StoreSettings` ของร้านนั้น
- ผู้ดูแลแพลตฟอร์ม (เรา) = `User.isPlatformAdmin` — เป็นคนละแกนกับ `StoreMember.role` และไม่ผูกกับร้านใด

**Schema**
- [x] `Store` — `id`, `slug` (unique, ใช้ใน URL/รายงาน), `name`, `status` enum `StoreStatus {ACTIVE, SUSPENDED}`,
      `createdAt`, `updatedAt`
- [x] `StoreMember` — `userId` FK, `storeId` FK, `role` enum `StoreRole {OWNER, STAFF}`, `createdAt` ·
      `@@unique([userId, storeId])` · **ต้องมี OWNER อย่างน้อย 1 คนต่อร้านเสมอ** (บังคับที่ action ไม่ใช่ DB)
- [x] `User.isPlatformAdmin Boolean @default(false)` ผ่าน `additionalFields` ของ Better Auth
- [x] เพิ่ม `storeId` (FK → Store, NOT NULL, index) ให้ **entity ราก** ที่ถูก query ตามร้านโดยตรง:
      `Product`, `Category`, `StockTransaction`, `Sale`, `CashierClosing`, `Table`, `TableSession`, `MenuItem`,
      `ModifierGroup`, `MobileOrder`, `QRCode`, `Notification`, `StoreSettings`, `Member`, `PaymentIntent`
      · entity ลูกไม่ต้องมี (`SaleItem`, `MobileOrderItem`, `ModifierOption`, `MemberPointTransaction`,
      `LineNotificationLog`) — เข้าถึงผ่านพ่อแม่ที่มี `storeId` เสมอ
- [x] **แก้ unique ให้เป็นต่อร้าน** (จุดที่พลาดแล้วร้าน B สร้างข้อมูลไม่ได้เพราะชนกับร้าน A):

      | เดิม | ใหม่ |
      |---|---|
      | `Product.sku @unique` | `@@unique([storeId, sku])` |
      | `Category.name @unique` | `@@unique([storeId, name])` |
      | `Sale.saleNumber @unique` | `@@unique([storeId, saleNumber])` — เลขบิลเริ่ม `INV-000001` ใหม่ทุกร้าน |
      | `Table.code @unique` | `@@unique([storeId, code])` |
      | `Member.phone @unique` | `@@unique([storeId, phone])` — ลูกค้าคนเดียวเป็นสมาชิกได้หลายร้าน แต้มไม่รวมกัน |
      | `CashierClosing @@unique([cashierId, closingDate])` | `@@unique([storeId, cashierId, closingDate])` |
      | `QRCode.token`, `PaymentIntent.ref1`, `Sale.paymentReference`, `PaymentIntent.transactionId` | **คง global unique** — เป็นตัวที่เดินทางออกนอกระบบ (URL / ธนาคาร) ต้องหาร้านกลับได้จากค่าเดียว |

- [x] **Migration เขียน SQL เอง** ตามกับดัก `@@map` ใน `CLAUDE.md` ห้ามให้ Prisma generate: (1) สร้าง `store`
      แถวแรกจาก `store_settings.store_name` เดิม (`slug = 'default'`) (2) เพิ่มคอลัมน์ `store_id` แบบ nullable →
      backfill ทุกตารางด้วย id นั้น → `SET NOT NULL` (3) drop unique เดิม + สร้าง unique ใหม่ตามตาราง
      ข้างบน (4) สร้าง `store_member` ให้ผู้ใช้ทุกคนที่มีอยู่เป็น `OWNER` ของร้านแรก (5) ปิดท้ายด้วย
      `prisma migrate diff --exit-code` ต้อง `No difference detected.`

**Guard และการเข้าถึงข้อมูล**
- [x] `requireStore()` ใน `lib/session.ts` คืน `{ user, storeId, role }` — ตรวจ session → อ่าน `activeStoreId` →
      ยืนยันว่ามี `StoreMember` แถวนั้นและ `Store.status = ACTIVE` → ไม่ผ่านโยน `UNAUTHENTICATED`/`NO_STORE`
      · **ทุก Server Action ที่แตะข้อมูลร้านเปลี่ยนจาก `requireUser()` เป็น `requireStore()`** (ปัจจุบัน 15 ไฟล์)
      · `requireUser()` เหลือใช้เฉพาะหน้าที่เป็นของ "ตัวผู้ใช้" ไม่ใช่ของร้าน (`/settings` โปรไฟล์/เปลี่ยนรหัสผ่าน)
- [x] `requireOwner()` = `requireStore()` + `role === OWNER` — ใช้กับ: ตั้งค่าร้าน (`updateStoreSettings`),
      จัดการพนักงาน, และทุกอย่างในเฟส 15 ที่แตะบัญชีรับเงิน
- [x] `requirePlatformAdmin()` — ไว้ให้เฟส 14 (`/admin/*`) · เฟสนี้แค่มี helper + เทส
- [x] **ชั้นกันลืม `where: { storeId }`** — Prisma Client Extension `forStore(storeId)` ใน `lib/db.ts` ที่ inject
      `storeId` เข้า `where` ของทุก `find*/update*/delete*/count/aggregate` และเข้า `data` ของ `create*` ให้กับ
      model ที่มีคอลัมน์นี้ · `lib/queries.ts` และ action ทั้งหมดต้องเรียกผ่าน `db.forStore(storeId)` ไม่ใช่
      `prisma` ตรง ๆ · ชื่อ `prisma` ที่ import ตรงให้เหลือเฉพาะ: auth, health, webhook (ก่อนรู้ร้าน), และ
      สคริปต์ · เพิ่ม ESLint rule `no-restricted-imports` กัน `@/lib/prisma` ใน `app/actions/**` และ
      `lib/queries.ts`
- [x] **raw SQL 12 จุดต้องเติม `WHERE store_id = ${storeId}` ด้วยมือ** (extension ช่วยไม่ได้): `lib/queries.ts`
      (8 จุด), `lib/close-session.ts` (2), `app/actions/products.ts` `nextSku()` (1), `app/actions/sales.ts`
      `nextSaleNumber()` (1) — ไล่ด้วย `grep -rn '\$queryRaw\|\$executeRaw'` ตอนปิดเฟส
- [x] **advisory lock ต้องเป็นต่อร้าน**: `SALE_NUMBER_LOCK` ตอนนี้เป็น key เดียวทั้งระบบ → ทุกร้านต่อคิวออกเลขบิล
      ร่วมกัน · เปลี่ยนเป็น `pg_advisory_xact_lock(hashtext(${storeId}))` ทั้งใน `lib/close-session.ts` และ
      `app/actions/sales.ts` (ใช้ helper เดียวกัน) · `nextSku()` ก็ต้องกรองร้าน
- [x] ฝั่งลูกค้า `/order/[qrToken]/*` และ `/api/order/[qrToken]/*`: หา `storeId` จาก `QRCode` ครั้งเดียวต้นทาง แล้ว
      ส่งต่อ — `(customer)/layout.tsx` อ่าน `StoreSettings` ของร้านนั้น (สี/ชื่อ/โลโก้/ค่าบริการ/`crmEnabled`)
- [x] Webhook SCB `/api/payments/webhook/scb/[secret]`: หาร้านจาก `PaymentIntent.ref1` แล้วปิดบิลใต้ร้านนั้น ·
      credential ของ SCB **ยังอยู่ใน env ชุดเดียวในเฟสนี้** (ทุกร้านที่เปิด SCB ใช้ Biller ID เดียวกัน = ยังเป็น
      ร้านของเราเท่านั้น) — แยกต่อร้านในเฟส 15
- [x] `proxy.ts`: ผู้ใช้ที่ล็อกอินแล้วแต่ไม่มี `StoreMember` เลย → ส่งไป `/no-store` (หน้าบอกว่ายังไม่ได้อยู่ในร้านใด
      รอเชิญ) · หน้าเลือกร้าน `/select-store` เมื่ออยู่หลายร้านและยังไม่ได้เลือก · เฟส 14 จะเปลี่ยน `/no-store`
      เป็น onboarding สร้างร้าน
- [x] `StoreSettings` เลิกอ้าง `id: "default"` ทุกจุด (ปัจจุบัน ~10 จุดในโค้ด/เทส) → อ่านด้วย `storeId` เสมอ

**UI ฝั่งพนักงาน**
- [x] Topbar: ชื่อร้านที่ทำงานอยู่ + ตัวสลับร้าน (โผล่เฉพาะเมื่ออยู่ >1 ร้าน) · สลับ = ตั้ง cookie ใหม่ +
      `router.refresh()`
- [x] `/users` → กลายเป็น "พนักงานในร้าน" (รายการ `StoreMember` ของร้านที่ทำงานอยู่) · คอลัมน์บทบาทแสดง
      `OWNER`/`STAFF` แทน "ยังไม่กำหนดสิทธิ์" · OWNER เปลี่ยนบทบาท/ถอดพนักงานได้ · ถอด OWNER คนสุดท้ายไม่ได้
- [x] ปุ่ม/เมนูที่ต้องเป็น OWNER (ตั้งค่าร้าน, พนักงาน) ซ่อนจาก STAFF — แต่ **action ถูกกันที่ `requireOwner()`
      อยู่แล้ว** UI แค่ไม่ให้งง
- [x] Seed/สคริปต์: `pnpm db:seed` สร้างร้านตัวอย่าง 2 ร้านเพื่อให้เทสข้ามร้านมีข้อมูลจริง ·
      `pnpm db:create-user` รับ `--store <slug>` และ `--role OWNER|STAFF` (ค่าเริ่มต้น: ร้านแรก, OWNER)

**การทดสอบ (กติกาโปรเจกต์: แตะเงิน/สต็อกต้องมีเทส — เฟสนี้แตะทุกอย่าง)**
- [x] `__tests__/integration/tenant-isolation.test.ts` — สร้างร้าน A/B พร้อมข้อมูลครบทุก entity แล้วยืนยันว่า
      **ทุกฟังก์ชันใน `lib/queries.ts`** เรียกใต้ร้าน A ได้ 0 แถวของ B และ**ทุก Server Action** ที่รับ id
      ของ B ตอบ `ok: false` ข้อความ "ไม่พบข้อมูล" (ไม่ใช่ 500 และไม่ใช่สำเร็จ) — ใช้ตารางชื่อฟังก์ชัน +
      `it.each` เพื่อให้เพิ่ม query ใหม่แล้วเทสฟ้องถ้าลืมใส่ในตาราง
- [x] เลขบิลต่อร้าน: ร้าน A และ B ออก `INV-000001` ได้พร้อมกัน · ภายในร้านเดียวยิง checkout 8 บิลพร้อมกัน
      ยังต้องได้เลขเรียงไม่มีช่องว่าง (เทสเดิมย้ายมาใส่ `storeId`)
- [x] กันขายเกินสต็อกแบบ concurrent (กติกาข้อ 4) และยกเลิกรายการ vs ครัวเริ่มทำ (ข้อ 7) **ยังผ่านเหมือนเดิม**
      หลังใส่ `storeId` — เทสเดิม 18 ไฟล์ต้องเขียวทั้งหมด
- [x] `requireStore()`: cookie ชี้ร้านที่ไม่ได้เป็นสมาชิก → ปฏิเสธ · ร้าน `SUSPENDED` → ปฏิเสธ · STAFF เรียก action
      ของ OWNER ตรง ๆ → ปฏิเสธ
- [x] Webhook: `ref1` ของร้าน A ปิดบิลได้เฉพาะโต๊ะของร้าน A และบิลออกใต้ `storeId` ของ A
- [ ] ตรวจสอบปิดเฟส: ✅ `pnpm test` เขียวทั้งหมด · ✅ `prisma migrate diff --exit-code` สะอาด · ✅ `grep` raw SQL ครบ
      (12 จุด — อยู่ที่ `lib/queries.ts` 8, `lib/sale-number.ts` 2, `app/actions/products.ts` 1, `app/api/health` 1) ·
      ✅ ไม่มี `prisma.` ตรง ๆ เหลือใน `app/actions/**` และ `lib/queries.ts` (ESLint บังคับ) · **⏳ ค้างเฉพาะ** production migrate
      แล้วร้าน `default` ใช้งานได้เหมือนเดิมทุกหน้า (smoke test ด้วยการล็อกอินกดจริง ไม่ใช่แค่ `/api/health`)

> ⚠️ **กับดักที่คาดไว้**
> - **ลืม `where: { storeId }` จุดเดียว = ร้านหนึ่งเห็นบิล/ลูกค้าของอีกร้าน** — เป็นเหตุการณ์ระดับ "ต้องแจ้งลูกค้า"
>   ไม่ใช่บั๊กธรรมดา · ถึงมี extension ก็ต้องมีเทส isolation ครอบ**ทุก** query เพราะ raw SQL และ `include`
>   ซ้อนลึกหลุดจาก extension ได้
> - `findUnique` ด้วย id ที่รับจากผู้ใช้: `prisma.sale.findUnique({ where: { id } })` — ถ้า `id` เป็นของร้านอื่น
>   จะเจอแถวนั้นทันที · **ต้องเปลี่ยนเป็น `findFirst({ where: { id, storeId } })`** ทุกจุดที่ id มาจากภายนอก
> - cookie `activeStoreId` เป็นข้อมูลจากเบราว์เซอร์ = ไม่น่าเชื่อถือ ต้องตรวจกับ `StoreMember` ทุกครั้ง
>   ห้าม cache ผลข้ามคำขอ (ถอดพนักงานแล้วต้องมีผลทันที)
> - advisory lock key เดิมเป็นค่าคงที่ — ถ้าลืมแก้ ร้านทั้งหมดจะต่อคิวออกเลขบิลผ่าน lock เดียว ช้าลงตามจำนวนร้าน
>   และเทสเลขบิลต่อร้านจะไม่จับได้ (ยังถูกต้องแค่ช้า) — ต้องรีวิวด้วยตา
> - migration เฟสนี้แตะ ~15 ตารางบน production ที่มีข้อมูลจริง → ต้อง `pg_dump` ก่อน และซ้อมรันบนสำเนาฐาน
>   production ในเครื่องก่อน merge · ห้าม merge วันที่ร้านเปิดขายอยู่
> - `Member.phone` เลิก unique ทั้งระบบ → ฟอร์มสมัครสมาชิกบน `pay/success` ต้องรู้ `storeId` จาก session
>   ของโต๊ะ ไม่ใช่จาก cookie พนักงาน (ลูกค้าไม่มี cookie นั้น)

### ⏭️ Phase 14 — Onboarding: สมัคร/สร้างร้าน/เชิญพนักงาน + ผู้ดูแลแพลตฟอร์ม + ค่าใช้งานแบบต่ออายุ
> ร่างคร่าว ๆ — ลงรายละเอียดเมื่อ Phase 13 ปิด
- [ ] สมัคร → ยืนยันอีเมล → `/onboarding` สร้างร้าน (ชื่อ, slug, สีธีม) → เป็น OWNER อัตโนมัติ ในทรานแซคชันเดียว
      กับ `StoreSettings` เริ่มต้น + โต๊ะ/เมนูตัวอย่างชุดเล็กให้ลองกดได้ทันที
- [ ] เชิญพนักงานทางอีเมล (`lib/mail.ts` ฟังก์ชันที่ 3 `sendStoreInviteMail`) → ลิงก์มี token หมดอายุ → ผู้รับสมัคร/
      ล็อกอินแล้วถูกผูกเป็น STAFF
- [ ] `/admin/stores` (เฉพาะ `isPlatformAdmin`): รายชื่อร้าน, ระงับ/ปลดระงับ, ดูจำนวนบิล/ยอดขายรวมต่อร้าน —
      **อ่านอย่างเดียว ไม่ให้ผู้ดูแลแพลตฟอร์มแก้ข้อมูลในร้าน**
- [ ] **ร้านหลายสาขา (`Brand`)** — ตัดสินใจ 2026-09-14: **1 สาขา = 1 `Store` เสมอ** (เมนู/โต๊ะ/QR/tier/รายงาน
      แยกกันโดยธรรมชาติ สาขาเล็กจ่าย S สาขาใหญ่จ่าย L) · `Brand` เป็นแค่ชั้นบาง ๆ ครอบด้านบนเพื่อลดงานซ้ำของเจ้าของ
      **ไม่ใช่ที่เก็บข้อมูลขาย** — ห้ามย้าย `Table`/`MenuItem`/`Sale` ขึ้นไปอยู่ระดับ Brand
      - Schema: `Brand` (`id`, `name`, `ownerId` FK → User, `createdAt`) · `Store.brandId String?` (optional —
        ร้านสาขาเดียวไม่ต้องมี Brand) · **เจ้าของ Brand = OWNER ของทุก Store ใต้ Brand โดยอัตโนมัติ** (บังคับที่
        `requireStore()`: ถ้า `user.id === store.brand.ownerId` → role OWNER แม้ไม่มีแถว `StoreMember`) ·
        พนักงานยังผูกรายสาขาผ่าน `StoreMember` เหมือนเดิม
      - **คัดลอกเมนูข้ามสาขา** (`copyMenuFromStore(sourceStoreId)` — ต้องเป็น OWNER ทั้งสองร้าน): คัดลอก `MenuItem` +
        `ModifierGroup`/`ModifierOption` + `Category` เป็น**สำเนาอิสระ** แล้วแต่ละสาขาแก้ราคา/ซ่อนรายการ/เพิ่มเมนูเฉพาะ
        สาขาได้เอง · **ไม่ทำ "เมนูกลาง sync อัตโนมัติ" ในเฟสนี้** — ต้องมี override ราคา/ความพร้อมขายต่อสาขาซึ่งซับซ้อน
        รอร้านจริงร้องขอ · ตอนสร้างสาขาใหม่ใต้ Brand ถามว่า "คัดลอกเมนูจากสาขาไหน" ทันที
      - **รายงานรวมแบรนด์** `/brand/reports` (เจ้าของ Brand): ยอดขาย/จำนวนบิลรายสาขาเทียบกัน + ยอดรวม — **อ่านอย่างเดียว**
        query เดิมใน `lib/queries.ts` เรียกซ้ำต่อ `storeId` แล้วรวมในโค้ด ไม่เขียน query ข้ามร้านใหม่ (กัน isolation รั่ว)
      - **จ่ายค่าใช้งานใบเดียว**: `/brand/billing` เลือก tier + ระยะเวลาให้หลายสาขาในครั้งเดียว → สร้าง `StoreSubscription`
        แถวละสาขา (`status = PENDING`) ผูกกัน `batchId` เดียว → QR ยอดรวมใบเดียว → ผู้ดูแลยืนยันครั้งเดียวทั้ง batch
        (ทรานแซคชันเดียว) · แต่ละสาขาเลือก tier ต่างกันได้ในใบเดียวกัน · ไม่มีส่วนลดหลายสาขาในเฟสนี้
      - สลับสาขาเร็ว: ตัวสลับร้านใน topbar (Phase 13) จัดกลุ่มตาม Brand
      - **ยังไม่ทำ**: สมาชิก/แต้มร่วมข้ามสาขา (`Member` ยังผูกรายสาขาตาม §7), เมนูกลาง sync, โอนโต๊ะ/พนักงานข้ามสาขา,
        ย้าย `Store` ระหว่าง Brand
      - เทส: เจ้าของ Brand เข้าสาขาใต้ Brand ได้เป็น OWNER โดยไม่มี `StoreMember` · เจ้าของ Brand A เข้าสาขาของ
        Brand B ไม่ได้ · คัดลอกเมนูแล้วแก้ราคาที่สาขาปลายทางไม่กระทบต้นทาง · ยืนยัน batch ครึ่งเดียวไม่ได้ (ทั้งหมดหรือไม่เลย)
- [ ] **ค่าใช้งานแบบต่ออายุ (Store Subscription)** — เก็บเงินร้านเป็น "วัน" ต่ออายุล่วงหน้าได้ มีส่วนลดจูงใจ
      ให้ซื้อนาน และ**เก็บประวัติเรตทุกครั้งที่เปลี่ยน** (ตัดสินใจ 2026-09-14)

      **กติกา**
      - หน่วยขั้นต่ำ = **1 วัน = 10 บาท** (`BASE_RATE_PER_DAY`) · แพ็กเกจมาตรฐาน 6 แบบ: 7 · 15 · 30 วัน · 3 · 6 · 12 เดือน
        (นับเป็นวัน 90/180/365) — แพ็กเกจยาวขึ้น = ส่วนลดมากขึ้น · ราคาสุทธิเป็นบาทเต็มเสมอ
      - **ต่ออายุแบบต่อท้าย (stack)**: `periodStart = max(now, Store.planExpiresAt)` → จ่ายล่วงหน้าไม่เสียวันที่เหลือ
      - **หมดอายุ = อ่านได้ ขายไม่ได้**: `requireStore()` โยน `STORE_EXPIRED` ให้ทุก action ที่สร้าง/แก้ข้อมูลขาย
        (เปิดโต๊ะ, checkout POS, รับออเดอร์ลูกค้า) · หน้า reports/history/settings ยังเข้าได้ · ฝั่งลูกค้าสแกน QR เห็น
        "ร้านปิดรับออเดอร์ชั่วคราว" ไม่ใช่ error · ไม่มี grace period แต่**เตือนล่วงหน้า 7 / 3 / 1 วัน** (แบนเนอร์ +
        อีเมลถึง OWNER ผ่าน `lib/mail.ts`)
      - **ทดลองใช้ 7 วัน — ผูกกับพร้อมเพย์ของร้าน ไม่ใช่กับอีเมล** (ตัดสินใจ 2026-09-14 หลังพบว่าอีเมลสร้างใหม่ได้
        ไม่จำกัด): สิทธิ์ทดลองเริ่มนับ**ต่อเมื่อร้านกรอกเลขพร้อมเพย์/บัญชีรับเงินแล้ว** (ต้องกรอกอยู่แล้วเพื่อรับเงินลูกค้า
        ใน Phase 15) และ **1 เลขพร้อมเพย์ = ทดลองได้ครั้งเดียวตลอดกาล** · บันทึกที่ `TrialClaim` (`promptPayIdHash`
        unique, `claimedAt`, `storeId`) — **ไม่ลบแม้ร้านถูกลบ** เลขเดิมโผล่อีก = ไม่ได้ทดลอง ต้องจ่าย · แถวทดลองบันทึกเป็น
        `StoreSubscription` `kind = TRIAL`, `amount = 0`, tier S · ไม่ทำชั้นกันอื่น (จำกัดฟีเจอร์/บล็อกอีเมลชั่วคราว)
        จนกว่าจะเห็นสถิติสมัครซ้ำจริง
      - **ราคาคิดตามจำนวนโต๊ะ (tier) × จำนวนวัน** (ตัดสินใจ 2026-09-14 หลังพบว่าไม่จำกัดโต๊ะ = ร้านหลายสาขาแจ้งสาขาเดียว
        แล้วเพิ่มโต๊ะไม่จำกัดได้): เราไม่ต้องรู้ว่าร้านมีกี่สาขา — **โต๊ะทุกตัวที่มีอยู่ต้องอยู่ในเพดานของ tier ที่จ่าย**
        · เพดานบังคับที่ `createTable` (นับ `Table` ที่ยังใช้งานของร้าน ≥ `Store.tableLimit` → `ok:false`
        "แพ็กเกจของร้านรองรับได้ N โต๊ะ อัปเกรดได้ที่หน้า ค่าใช้งาน") ภายใต้ advisory lock ต่อร้าน กันสร้างพร้อมกันทะลุเพดาน
        · รวมโต๊ะ (merge) ไม่นับเป็นสร้าง · ลบโต๊ะแล้วสร้างใหม่ได้แต่ QR บนโต๊ะนั้นต้องพิมพ์ใหม่ (แรงเสียดทานธรรมชาติ)
        · ร้านที่มีหลายสาขาจริง แนะนำให้ "สร้างร้านเพิ่ม" (ผู้ใช้เป็น OWNER ได้หลายร้าน — รายงาน/QR แยกกันอยู่แล้ว)
      - **อัปเกรด tier กลางทาง**: จ่ายส่วนต่าง `(rateใหม่ − rateเดิม) × วันที่เหลือ` ไม่มีส่วนลด ปัดขึ้นเป็นบาทเต็ม
        บันทึกเป็นแถว `kind = UPGRADE` (`periodStart = now`, `periodEnd = วันหมดอายุเดิม` ไม่ยืดวัน) →
        `Store.tableLimit` เปลี่ยนทันทีที่ยืนยันจ่าย · **ดาวน์เกรดตอนต่ออายุ**ได้เฉพาะเมื่อโต๊ะที่ใช้อยู่ ≤ เพดานใหม่
        ไม่งั้นปฏิเสธพร้อมบอกจำนวนโต๊ะที่ต้องลบก่อน
      - ใครจ่ายอย่างไร: **Phase 14 = โอนเข้าพร้อมเพย์ของแพลตฟอร์ม แล้วผู้ดูแลกดยืนยัน** (แถว `PENDING → PAID`)
        · Phase 15 ค่อยต่อ "ตรวจสลิปอัตโนมัติ" (ก+) ให้ร้านต่ออายุเองได้โดยไม่ต้องรอเรา — ใช้ตัวตรวจสลิปตัวเดียวกับ
        ที่ร้านใช้รับเงินลูกค้า

      **Schema**
      - `SubscriptionPlan` — `id`, `code` (เช่น `S-D7`, `M-M3`, `TRIAL`, `CUSTOM`), `name`, `tier` enum `{S, M, L, XL}`,
        `tableLimit Int`, `durationDays Int`, `ratePerDay Decimal(8,2)`, `discountPercent Decimal(5,2)`,
        `price Decimal(10,2)` (สุทธิ ตั้งตรง ๆ ไม่คำนวณ), `isActive`, `sortOrder`, `version Int`,
        `supersededById String?`, `createdAt`, `createdById`
        · **append-only เหมือน `StockTransaction`**: แก้ราคา/เพดานโต๊ะ = สร้างแถว version ใหม่ + ตั้ง `supersededById`
        และ `isActive=false` ให้แถวเก่า **ห้าม UPDATE แถวเดิม** — นี่คือ "ประวัติเรต" ที่ตรวจย้อนหลังได้ว่าวันไหนขายเรตไหน
        · `@@unique([code, version])`
      - `StoreSubscription` (ledger การต่ออายุ — append-only) — `id`, `storeId`, `planId` (FK ไป version ที่ใช้จริง),
        `kind` enum `{RENEWAL, UPGRADE, TRIAL, CUSTOM}`, **snapshot ตัวเลข ณ ตอนซื้อ**: `tier`, `tableLimit`, `days`,
        `ratePerDay`, `discountPercent`, `listPrice`, `amount`, `periodStart`, `periodEnd`, `status` enum
        `{PENDING, PAID, VOID}`, `paymentMethod` enum `{TRANSFER, PROMPTPAY, FREE}`, `paymentReference String? @unique`
        (กันยืนยันซ้ำ), `paidAt`, `confirmedById`, `createdById`, `note`, `createdAt`
        · ยกเลิกรายการที่ PAID ไปแล้ว = สร้างแถว `VOID` ชดเชย ไม่ลบ
      - `TrialClaim` — `id`, `promptPayIdHash String @unique` (SHA-256 ของเลขที่ normalize แล้ว ไม่เก็บเลขดิบ),
        `storeId`, `claimedAt` · **ไม่มี FK cascade** — ร้านถูกลบแถวนี้ต้องอยู่
      - `Store.planExpiresAt DateTime?` + `Store.tableLimit Int` — denormalized จากแถว `PAID` ล่าสุด ·
        **อัปเดตในทรานแซคชันเดียวกับการยืนยันจ่ายเสมอ** (กติกาเดียวกับ `product.quantity` ↔ `StockTransaction`)

      **ตารางแพ็กเกจเริ่มต้น (seed — แก้ได้ที่ `/admin/plans` แต่จะกลายเป็น version ใหม่)**

      tier กำหนดเรตต่อวัน · ระยะเวลากำหนดส่วนลด · ราคาสุทธิ = ปัดเป็นเลขกลม (ตั้งตรง ๆ ในแถว ไม่คำนวณสด)

      | tier | เพดานโต๊ะ | เรต/วัน | 7 วัน | 15 วัน | 30 วัน | 3 เดือน (90) | 6 เดือน (180) | 1 ปี (365) |
      |---|---|---|---|---|---|---|---|---|
      | **S** | ≤ 12 | 10 | **70** | **145** | **280** | **800** | **1,500** | **2,800** |
      | **M** | ≤ 30 | 20 | **140** | **290** | **560** | **1,600** | **3,000** | **5,600** |
      | **L** | ≤ 60 | 35 | **245** | **505** | **980** | **2,800** | **5,250** | **9,800** |
      | **XL** | ≤ 120 | 60 | **420** | **870** | **1,680** | **4,800** | **9,000** | **16,800** |
      | ส่วนลดตามระยะ | | | 0% | ~3% | ~7% | ~11% | ~17% | ~23% |
      | TRIAL | ≤ 12 | 0 | 7 วัน — ครั้งเดียวต่อพร้อมเพย์ | | | | | |
      | CUSTOM | ตาม tier ปัจจุบัน | เรตของ tier | n วัน × เรต ไม่มีส่วนลด — เฉพาะผู้ดูแลแพลตฟอร์ม (ชดเชย/ปรับวัน) | | | | | |

      เกิน 120 โต๊ะ = ติดต่อเรา (ไม่มีในระบบ ผู้ดูแลใช้ CUSTOM + ตั้ง `tableLimit` เอง)

      **หน้าจอ**
      - ฝั่งร้าน `/billing` (OWNER เท่านั้น): วันหมดอายุ + นับถอยหลัง · **โต๊ะที่ใช้อยู่ / เพดาน** · เลือก tier แล้วเห็น
        การ์ดระยะเวลา 6 ใบโชว์ราคาสุทธิ/ส่วนลด/เฉลี่ยต่อวัน · ปุ่ม "อัปเกรดตอนนี้" โชว์ส่วนต่างที่ต้องจ่ายสำหรับวันที่เหลือ ·
        กดเลือก → ได้ QR พร้อมเพย์ของแพลตฟอร์ม + เลขอ้างอิง → สถานะ "รอผู้ดูแลยืนยัน" · ตารางประวัติทุกแถว (kind/tier/วัน/ยอด)
      - ฝั่งแพลตฟอร์ม `/admin/stores`: คอลัมน์ "หมดอายุ", "โต๊ะ/เพดาน" + ตัวกรอง "ใกล้หมด ≤ 7 วัน / หมดแล้ว / โต๊ะเต็มเพดาน" ·
        `/admin/stores/[id]`: ledger ต่ออายุ, ปุ่มยืนยัน `PENDING` (ใส่ `paymentReference`), เติมวัน CUSTOM, ตั้ง
        `tableLimit` พิเศษ, ระงับร้าน · `/admin/plans`: รายการ version ทั้งหมด (active/superseded) + ฟอร์มออก version ใหม่
      - Server actions: `requestRenewal(planCode)` / `requestUpgrade(tier)` (OWNER), `confirmRenewal(id, reference)` /
        `voidRenewal(id, reason)` / `grantCustomDays(storeId, days, note)` / `setTableLimit(storeId, n, note)`
        (ผู้ดูแลแพลตฟอร์ม), `publishPlanVersion(...)` (ผู้ดูแลแพลตฟอร์ม)

      **เทส (แตะเงิน → ต้องมี)**
      - stack ถูกต้อง: ต่ออายุตอนเหลือ 10 วัน ด้วย S-D30 → หมดอายุ +40 วัน ไม่ใช่ +30
      - ร้านหมดอายุ: `openTableSession` / `checkout` / `createMobileOrder` ตอบ `ok:false` ข้อความไทย ส่วน `getReports`
        ยังอ่านได้
      - **เพดานโต๊ะ**: tier S มี 12 โต๊ะแล้ว `createTable` ตอบ `ok:false` · ยิง `createTable` พร้อมกัน 5 คำขอตอนมี 10 โต๊ะ
        → ผ่านแค่ 2 · merge ไม่ติดเพดาน · ลบ 1 แล้วสร้างใหม่ได้
      - **อัปเกรดกลางทาง**: S→M เหลือ 20 วัน → ส่วนต่าง (20−10)×20 = 200 บาท · `tableLimit` เป็น 30 ทันทีที่ยืนยัน ·
        `planExpiresAt` ไม่เปลี่ยน · ดาวน์เกรด M→S ตอนมี 20 โต๊ะ → ปฏิเสธพร้อมบอกว่าต้องลบ 8 โต๊ะ
      - **ทดลองครั้งเดียว**: พร้อมเพย์เดิมสร้างร้านที่ 2 → ไม่ได้ TRIAL · ลบร้านแรกแล้วสมัครใหม่ด้วยเลขเดิม → ยังไม่ได้ ·
        เลขเดียวกันเขียนต่างรูปแบบ (`081-234-5678` / `0812345678` / `+66812345678`) ต้อง hash ตรงกัน
      - ยืนยันซ้ำด้วย `paymentReference` เดิม → ไม่เพิ่มวันซ้ำ (unique)
      - แก้ราคา/เพดานแพ็กเกจหลังร้านซื้อไปแล้ว → แถว `StoreSubscription` เดิมตัวเลขไม่เปลี่ยน และ plan version เก่ายังอ้างได้
      - `voidRenewal` แถว PAID → `planExpiresAt`/`tableLimit` ถอยกลับถูกต้องและแถวเดิมยังอยู่
      - ยืนยัน 2 คำขอพร้อมกันกับแถว PENDING เดียว → ผ่านแค่ 1 (`updateMany` + `where: { status: 'PENDING' }`
        กติกาเดียวกับข้อ 7)

### ⏭️ Phase 15 — ตั้งค่ารับเงินต่อร้าน 3 ระดับ (ก / ก+ / ข)
> ร่างคร่าว ๆ · ตัดสินใจแล้วว่า**ไม่ใช้ payment gateway แบบโอนต่อ (marketplace)** เพราะค่าธรรมเนียม/รอบโอน
> ไม่เหมาะกับร้านเป้าหมาย — เงินต้องเข้าบัญชีร้านโดยตรงทุกระดับ
- [ ] `Store.paymentMode` enum `{PROMPTPAY_DIRECT, PROMPTPAY_SLIP, SCB_BILLER}` + `StorePaymentConfig`
      (เลขพร้อมเพย์, เลขบัญชี/ชื่อบัญชีไว้เทียบผู้รับ, credential SCB ต่อร้าน**เข้ารหัส**ด้วย key ใน env)
      — แก้ได้เฉพาะ OWNER
- [ ] **ก — พร้อมเพย์ตรง**: ย้าย `PROMPTPAY_ID` จาก env → ต่อร้าน · พนักงานกดยืนยัน (flow เดิม) · ค่าเริ่มต้นของทุกร้าน
- [ ] **ก+ — พร้อมเพย์ตรง + ตรวจสลิปอัตโนมัติ**: หน้า `pay/promptpay` เพิ่ม "แนบสลิป" → อ่าน QR บนสลิป**ฝั่ง
      เบราว์เซอร์** (ไม่อัปโหลดรูป) → action `verifySlipAndSettle()` เรียก API ตรวจสลิป (เลือกผู้ให้บริการ: SlipOK /
      EasySlip — ขอราคาเทียบก่อน) → เทียบ 4 เงื่อนไข: ผู้รับตรงบัญชีร้าน · ยอด ≥ บิล · รหัสอ้างอิงไม่เคยใช้
      (`Sale.paymentReference` unique) · เวลาไม่เกิน N นาที → `closeSessionWithPayment()` ตัวเดิม ·
      API ล่ม → ตกไปปิดมือแบบ ก
- [ ] **ข — SCB Biller ID ของร้าน**: token cache ต่อร้าน, `inquireBillPayment` ใช้ credential ของร้านเจ้าของ intent,
      webhook URL ต่อร้าน `/api/payments/webhook/scb/[storeWebhookToken]` · **ปุ่ม "ทดสอบการเชื่อมต่อ"** ออก QR
      1 บาทให้เจ้าของจ่ายแล้วรอ callback ≤ 2 นาที — **ผ่านแล้วเท่านั้นถึงเปิดปิดบิลอัตโนมัติ** · ระหว่างนี้ติดต่อ SCB
      เรื่อง partner program (แอปเดียวของเรา ผูกหลาย Biller ID) ถ้าได้จะตัดการถือ credential ของร้านทิ้ง
- [ ] `lib/payment-provider/` → interface กลางเลือกตาม `Store.paymentMode` · `isScbConfigured()` เลิกอ่าน env
- [ ] เทส: สลิปซ้ำไม่ปิดบิลซ้ำ · สลิปโอนเข้าบัญชีร้านอื่นถูกปฏิเสธ · ยอดขาดถูกส่งให้พนักงาน · webhook ร้าน A ปิดบิล
      ร้าน B ไม่ได้

### ⏭️ Phase 16 — Role-Based Permission เต็มรูปแบบ (ถ้าจำเป็น)
> = หัวข้อ "Phase ถัดไป — Role-Based Permission" ข้างบน ปรับให้ `Role` อยู่ใต้ `Store` (ร้านกำหนดบทบาทเอง) ·
> เริ่มเมื่อมีร้านจริงร้องขอมากกว่า OWNER/STAFF เท่านั้น


---

## 9. เกณฑ์ความสำเร็จโดยรวม (Definition of Done)
- ผู้ใช้สร้าง/แก้/ลบสินค้า และรับเข้า/เบิกจ่ายได้ครบ โดยยอดคงเหลือถูกต้องเสมอ
- ผู้ใช้ขายสินค้าได้ครบวงจร: เลือกสินค้า → ชำระเงิน (CASH/TRANSFER/QR) → ออกใบเสร็จ → สต็อกลดถูกต้องผ่านกลไก
  `StockTransaction` เดียวกับระบบเดิม
- **ไม่มีทางเบิกเกิน/ขายเกินยอดคงเหลือได้** ไม่ว่าจากเบิกจ่ายภายในหรือ POS (ผ่านการทดสอบ concurrent)
- Void บิลได้เฉพาะวันเดียวกับที่ขาย และคืนสต็อกถูกต้องโดยไม่ลบ/แก้ ledger เดิม
- Dashboard และ `/reports` แสดงภาพรวมสต็อก แจ้งเตือนใกล้หมด และยอดขายถูกต้องตรงกับข้อมูลจริงเสมอ
- หมวดหมู่สินค้าเป็น master data ที่จัดการ (เพิ่ม/แก้/ลบ) ได้ และผูกกับสินค้าแบบ referential integrity
  (ลบไม่ได้ถ้ายังมีสินค้าผูกอยู่)
- แคชเชียร์ปิดยอดขายประจำวันได้ถูกต้อง 1 ครั้ง/คน/วัน พร้อมส่วนต่างเงินสดที่คำนวณอัตโนมัติ และหลังปิดยอดแล้ว void
  บิลของวันนั้นไม่ได้อีก
- ผู้ใช้ต้องยืนยันอีเมลก่อนจึงล็อกอินได้ และต้องล็อกอินก่อนจึงเข้าถึงหน้าใด ๆ ได้
  (login/register/verify-email/forgot-password/reset-password ใช้งานได้ครบ และ
  proxy guard เด้งผู้ที่ยังไม่ล็อกอินไปหน้า login เสมอ) — **v1 ยังไม่แบ่งสิทธิ์รายหน้า/ราย action**
  ผู้ใช้ที่ล็อกอินแล้วเข้าถึงได้ทุกหน้าเท่ากัน
- ลูกค้าสแกน QR แล้วสั่งอาหาร → ติดตามสถานะ → ชำระเงิน (PromptPay หรือ Card) → ได้รับ LINE แจ้งเตือนครบ 3 จุด
  ได้ end-to-end จริงบนมือถือ
- ผังโต๊ะแสดงสถานะจริงเรียลไทม์ รวมทั้งเวลาเปิดโต๊ะและระยะเวลาเปิดโต๊ะครบทุกการ์ด และการรวมโต๊ะทำให้บิลรวมเข้า
  โต๊ะหลักถูกต้องเสมอ
- **ยกเลิกรายการอาหารได้เฉพาะก่อนครัวเริ่มทำเท่านั้น** ผ่านการทดสอบ concurrent (ยกเลิก vs เริ่มทำพร้อมกัน)
- Dynamic QR ถูก invalidate ทันทีเมื่อปิดบิล และไม่สามารถเปิด session ใหม่ซ้ำด้วย token เดิมได้; Static QR
  ใช้ซ้ำได้ตลอด
- บิลจาก MJD Mobile Order (PromptPay/Card) ปรากฏถูกต้องใน `/pos/history`, Dashboard, `/reports`, `/pos/closing`
  เหมือนบิลขายหน้าร้านทุกประการ ไม่มีตัวเลขตกหล่น
- ร้านที่ไม่มี KDS ยังคงส่งอาหารและรับชำระเงินได้ครบ flow ผ่านการกดสถานะด้วยมือบนหน้ารายละเอียดออร์เดอร์โต๊ะ
- สมัครสมาชิกด้วยเบอร์โทรแล้วได้แต้มอัตโนมัติถูกต้องตามยอดบิล ไม่ต้องรอ/สแกนใบเสร็จภายหลัง
- ระบบขึ้น production ผ่าน HTTPS พร้อม CI/CD, backup และ monitoring
