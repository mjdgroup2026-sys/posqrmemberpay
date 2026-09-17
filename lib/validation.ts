import { z } from "zod"
import type { FieldErrors } from "@/lib/types"

export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง"
}

export function zodToFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".")
    if (key && !result[key]) result[key] = issue.message
  }
  return result
}

/// เพดานของจำนวนนับ — กันค่าที่ทำให้ยอดสต็อกเพี้ยนถาวร (ledger เป็น append-only ลบคืนไม่ได้)
/// และกัน integer out of range ของคอลัมน์ Int (int4) ใน PostgreSQL
const MAX_COUNT = 1_000_000

const positiveInt = (label: string) =>
  z.coerce
    .number({ error: `${label} ต้องเป็นตัวเลข` })
    .int(`${label} ต้องเป็นจำนวนเต็ม`)
    .positive(`${label} ต้องมากกว่า 0`)
    .max(MAX_COUNT, `${label} ต้องไม่เกิน ${MAX_COUNT.toLocaleString("th-TH")}`)

const nonNegativeInt = (label: string) =>
  z.coerce
    .number({ error: `${label} ต้องเป็นตัวเลข` })
    .int(`${label} ต้องเป็นจำนวนเต็ม`)
    .min(0, `${label} ต้องไม่ติดลบ`)
    .max(MAX_COUNT, `${label} ต้องไม่เกิน ${MAX_COUNT.toLocaleString("th-TH")}`)

export const productSchema = z.object({
  name: z.string().trim().min(1, "กรุณากรอกชื่อสินค้า").max(120, "ชื่อสินค้ายาวเกินไป"),
  sku: z
    .string()
    .trim()
    .max(40, "SKU ยาวเกินไป")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  categoryId: z.string({ error: "กรุณาเลือกหมวดหมู่สินค้า" }).trim().min(1, "กรุณาเลือกหมวดหมู่สินค้า"),
  unit: z.string().trim().min(1, "กรุณาระบุหน่วยนับ").max(20, "หน่วยนับยาวเกินไป"),
  price: z.coerce
    .number({ error: "ราคาต้องเป็นตัวเลข" })
    .min(0, "ราคาต้องไม่ติดลบ")
    .max(9_999_999, "ราคาสูงเกินไป"),
  reorderPoint: nonNegativeInt("จุดสั่งซื้อ"),
})

/// รับ null ได้ด้วย เพราะ formData.get() คืน null เมื่อไม่มีฟิลด์นั้น —
/// ถ้าไม่ดักไว้ zod จะคืนข้อความอังกฤษดิบ "expected string, received null" ให้ผู้ใช้ (ละเมิดกติกาข้อ 6)
export const stockMoveSchema = z.object({
  productId: z.string({ error: "กรุณาเลือกสินค้า" }).trim().min(1, "กรุณาเลือกสินค้า"),
  quantity: positiveInt("จำนวน"),
  note: z
    .string({ error: "หมายเหตุไม่ถูกต้อง" })
    .trim()
    .max(200, "หมายเหตุยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

export const idSchema = z.object({
  id: z.string().trim().min(1, "ไม่พบรายการที่ต้องการ"),
})

export const profileSchema = z.object({
  name: z.string().trim().min(1, "กรุณากรอกชื่อ").max(80, "ชื่อยาวเกินไป"),
})

export type ProductInput = z.infer<typeof productSchema>
export type StockMoveInput = z.infer<typeof stockMoveSchema>

// ───────────────────────────── POS (Phase 2.5) ─────────────────────────────

/// เพดานจำนวนเงินต่อบิล — กัน Decimal(12,2) ล้นและกันค่าที่พิมพ์พลาดจนยอดขายเพี้ยนถาวร
const MAX_MONEY = 9_999_999

const money = (label: string) =>
  z.coerce
    .number({ error: `${label} ต้องเป็นตัวเลข` })
    .min(0, `${label} ต้องไม่ติดลบ`)
    .max(MAX_MONEY, `${label} สูงเกินไป`)

export const categorySchema = z.object({
  name: z.string({ error: "กรุณากรอกชื่อหมวดหมู่" }).trim().min(1, "กรุณากรอกชื่อหมวดหมู่").max(60, "ชื่อหมวดหมู่ยาวเกินไป"),
})

export const cartItemSchema = z.object({
  productId: z.string({ error: "กรุณาเลือกสินค้า" }).trim().min(1, "กรุณาเลือกสินค้า"),
  quantity: positiveInt("จำนวน"),
})

/// ตะกร้าถูกส่งมาเป็น JSON string ในฟิลด์ `items` ของ FormData
export const saleSchema = z.object({
  items: z
    .array(cartItemSchema, { error: "ตะกร้าไม่ถูกต้อง" })
    .min(1, "กรุณาเพิ่มสินค้าลงตะกร้าก่อนชำระเงิน")
    .max(200, "รายการในตะกร้ามากเกินไป"),
  discount: money("ส่วนลด"),
  paymentMethod: z.enum(["CASH", "TRANSFER", "QR"], { error: "กรุณาเลือกวิธีชำระเงิน" }),
  amountReceived: money("จำนวนเงินที่รับ"),
  note: z
    .string({ error: "หมายเหตุไม่ถูกต้อง" })
    .trim()
    .max(200, "หมายเหตุยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

export const voidSaleSchema = z.object({
  id: z.string({ error: "ไม่พบบิลที่ต้องการยกเลิก" }).trim().min(1, "ไม่พบบิลที่ต้องการยกเลิก"),
  reason: z
    .string({ error: "เหตุผลไม่ถูกต้อง" })
    .trim()
    .min(1, "กรุณาระบุเหตุผลที่ยกเลิกบิล")
    .max(200, "เหตุผลยาวเกินไป"),
})

export const closingSchema = z.object({
  countedCash: money("เงินสดที่นับได้"),
  note: z
    .string({ error: "หมายเหตุไม่ถูกต้อง" })
    .trim()
    .max(200, "หมายเหตุยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

/// แปลง JSON string ของตะกร้าเป็น array ก่อนส่งเข้า zod — พังเมื่อไหร่คืน [] ให้ zod ฟ้องเป็นภาษาไทยแทน
export function parseCartJson(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== "string" || raw.trim() === "") return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export type CategoryInput = z.infer<typeof categorySchema>
export type SaleInput = z.infer<typeof saleSchema>
export type ClosingInput = z.infer<typeof closingSchema>

// ───────────────────── MJD Mobile Order (Phase 6) ─────────────────────

const requiredId = (label: string) =>
  z.string({ error: label }).trim().min(1, label)

/// เปิดโต๊ะได้ 2 ทาง: ลูกค้าสแกน QR (qrToken) หรือพนักงานกดเปิดเอง (tableId) — ต้องมีอย่างน้อยหนึ่งอย่าง
export const openTableSchema = z
  .object({
    tableId: z.string().trim().optional().transform((v) => (v === "" ? undefined : v)),
    qrToken: z.string().trim().optional().transform((v) => (v === "" ? undefined : v)),
  })
  .refine((v) => Boolean(v.tableId ?? v.qrToken), { message: "ไม่พบโต๊ะที่ต้องการเปิด" })

export const mergeTablesSchema = z
  .object({
    primaryTableId: requiredId("กรุณาเลือกโต๊ะหลัก"),
    secondaryTableId: requiredId("กรุณาเลือกโต๊ะที่จะรวม"),
  })
  .refine((v) => v.primaryTableId !== v.secondaryTableId, {
    message: "รวมโต๊ะกับตัวเองไม่ได้",
    path: ["secondaryTableId"],
  })

export const unmergeTableSchema = z.object({
  secondaryTableId: requiredId("กรุณาเลือกโต๊ะที่จะยกเลิกการรวม"),
})

export const cancelSessionSchema = z.object({
  sessionId: requiredId("ไม่พบโต๊ะที่ต้องการยกเลิก"),
  reason: z
    .string({ error: "เหตุผลไม่ถูกต้อง" })
    .trim()
    .min(1, "กรุณาระบุเหตุผลที่ยกเลิกโต๊ะ")
    .max(200, "เหตุผลยาวเกินไป"),
})

/// ลดจำนวนรายการอาหารหลังส่งครัวแล้ว (F13) — ทำได้เฉพาะรายการที่ครัวยังไม่รับ
export const reduceOrderItemSchema = z.object({
  id: requiredId("ไม่พบรายการอาหารที่ต้องการลดจำนวน"),
  quantity: positiveInt("จำนวนใหม่"),
})

export const cancelOrderItemSchema = z.object({
  id: requiredId("ไม่พบรายการอาหารที่ต้องการยกเลิก"),
  reason: z
    .string({ error: "เหตุผลไม่ถูกต้อง" })
    .trim()
    .min(1, "กรุณาระบุเหตุผลที่ยกเลิกรายการ")
    .max(200, "เหตุผลยาวเกินไป"),
})

// ───────────────────── ฝั่งลูกค้า (Phase 9) ─────────────────────

export const cartLineSchema = z.object({
  menuItemId: requiredId("กรุณาเลือกเมนู"),
  quantity: positiveInt("จำนวน"),
  optionIds: z.array(z.string().trim().min(1)).max(20, "เลือกตัวเลือกมากเกินไป").default([]),
  note: z
    .string({ error: "โน้ตไม่ถูกต้อง" })
    .trim()
    .max(200, "โน้ตยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

export const submitOrderSchema = z.object({
  qrToken: requiredId("ไม่พบ QR Code ของโต๊ะนี้"),
  items: z
    .array(cartLineSchema, { error: "ตะกร้าไม่ถูกต้อง" })
    .min(1, "กรุณาเลือกเมนูก่อนยืนยันออร์เดอร์")
    .max(100, "รายการในตะกร้ามากเกินไป"),
})

/// พนักงานกดสั่งแทนลูกค้าจากจอขาย (Phase 17b) — ตะกร้าชุดเดียวกับฝั่งลูกค้า ต่างกันแค่ตัวระบุโต๊ะ
export const staffTableOrderSchema = z.object({
  tableId: requiredId("กรุณาเลือกโต๊ะ"),
  items: z
    .array(cartLineSchema, { error: "ตะกร้าไม่ถูกต้อง" })
    .min(1, "กรุณาเลือกเมนูก่อนส่งออร์เดอร์")
    .max(100, "รายการในตะกร้ามากเกินไป"),
})

/// ขายอาหารกลับบ้าน (Phase 17c) — ไม่มีโต๊ะ รับเงินตอนสั่ง จึงต้องมีวิธีจ่ายและเงินที่รับเหมือนหน้า POS
export const takeawaySaleSchema = z.object({
  items: z
    .array(cartLineSchema, { error: "ตะกร้าไม่ถูกต้อง" })
    .min(1, "กรุณาเลือกเมนูก่อนรับเงิน")
    .max(100, "รายการในตะกร้ามากเกินไป"),
  paymentMethod: z.enum(["CASH", "TRANSFER", "QR"], { error: "กรุณาเลือกวิธีชำระเงิน" }),
  amountReceived: z.coerce.number({ error: "จำนวนเงินที่รับต้องเป็นตัวเลข" }).min(0, "จำนวนเงินที่รับต้องไม่ติดลบ"),
  customerLabel: z
    .string({ error: "ชื่อลูกค้าไม่ถูกต้อง" })
    .trim()
    .max(40, "ชื่อลูกค้ายาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

export const callStaffSchema = z.object({
  qrToken: requiredId("ไม่พบ QR Code ของโต๊ะนี้"),
  reason: z
    .string({ error: "ข้อความไม่ถูกต้อง" })
    .trim()
    .max(200, "ข้อความยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

export const qrTokenSchema = z.object({
  qrToken: requiredId("ไม่พบ QR Code ของโต๊ะนี้"),
})

export const generateQrSchema = z.object({
  tableId: requiredId("กรุณาเลือกโต๊ะ"),
  type: z.enum(["STATIC", "DYNAMIC"], { error: "ประเภท QR ไม่ถูกต้อง" }),
})

export type CartLineInput = z.infer<typeof cartLineSchema>

// ───────────────────── ชำระเงิน (Phase 10) ─────────────────────

/// ลูกค้าแนบสลิป (Phase 15b) — payload คือข้อความที่อ่านได้จาก mini-QR บนสลิป (เบราว์เซอร์ถอดให้ ไม่ส่งรูป)
export const submitSlipSchema = z.object({
  qrToken: requiredId("ไม่พบ QR Code ของโต๊ะนี้"),
  payload: z.string({ error: "ไม่พบข้อมูลจากสลิป" }).trim().min(20, "อ่าน QR บนสลิปไม่ได้ กรุณาลองใหม่").max(1000, "ข้อมูลสลิปยาวผิดปกติ"),
})

export const confirmPaymentSchema = z.object({
  sessionId: requiredId("ไม่พบโต๊ะที่ต้องการปิดบิล"),
  paymentMethod: z.enum(["PROMPTPAY", "CARD", "CASH", "TRANSFER"], {
    error: "กรุณาเลือกวิธีชำระเงิน",
  }),
  amountReceived: z.coerce
    .number({ error: "จำนวนเงินที่รับต้องเป็นตัวเลข" })
    .min(0, "จำนวนเงินที่รับต้องไม่ติดลบ")
    .max(9_999_999, "จำนวนเงินสูงเกินไป")
    .optional(),
  reference: z
    .string({ error: "เลขอ้างอิงไม่ถูกต้อง" })
    .trim()
    .max(120, "เลขอ้างอิงยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

/// payload ที่ webhook ของผู้ให้บริการต้องส่งมา — ตั้งใจให้เล็กและเป็นกลาง ไม่ผูกกับเจ้าใดเจ้าหนึ่ง
export const paymentWebhookSchema = z.object({
  reference: z.string({ error: "ต้องมี reference" }).trim().min(1, "ต้องมี reference").max(120),
  sessionId: z.string().trim().min(1).optional(),
  qrToken: z.string().trim().min(1).optional(),
  amount: z.coerce.number({ error: "amount ต้องเป็นตัวเลข" }).min(0).max(9_999_999).optional(),
})

export const startPaymentSchema = z.object({
  qrToken: requiredId("ไม่พบ QR Code ของโต๊ะนี้"),
  method: z.enum(["PROMPTPAY", "CARD"], { error: "กรุณาเลือกวิธีชำระเงิน" }),
})

// ───────────────────── ตั้งค่าร้าน + สมาชิก (Phase 12) ─────────────────────

/// สีธีมต้องเป็น hex 6 หลักเท่านั้น — ค่านี้ถูกยัดลง inline style บน <body> ของฝั่งลูกค้า
/// รับค่าอิสระไม่ได้ เพราะเท่ากับให้ผู้ใช้เขียน CSS ลงหน้าเว็บได้ตามใจ
const hexColor = z
  .string({ error: "กรุณาเลือกสีธีม" })
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "สีธีมต้องเป็นรหัส hex 6 หลัก เช่น #E8571F")

/// URL รูปภาพ — อนุญาตเฉพาะ http/https และ path ภายในเว็บ (กัน javascript: กับ data:)
const imageUrl = z
  .string()
  .trim()
  .max(500, "ลิงก์รูปยาวเกินไป")
  .refine((v) => v === "" || /^(https?:\/\/|\/)/.test(v), "ลิงก์รูปต้องขึ้นต้นด้วย http://, https:// หรือ /")
  .transform((v) => (v === "" ? null : v))

export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(1, "กรุณากรอกชื่อร้าน").max(80, "ชื่อร้านยาวเกินไป"),
  themeColor: hexColor,
  logoUrl: imageUrl,
  coverImageUrl: imageUrl,
  serviceChargePercent: z.coerce
    .number({ error: "ค่าบริการต้องเป็นตัวเลข" })
    .min(0, "ค่าบริการต้องไม่ติดลบ")
    .max(100, "ค่าบริการต้องไม่เกิน 100%"),
  hasKDS: z.coerce.boolean(),
  /// โหมดเริ่มต้นของจอขายอาหาร (2026-09-17)
  posDefaultMode: z.enum(["TABLE", "TAKEAWAY"], { error: "โหมดเริ่มต้นของจอขายไม่ถูกต้อง" }).default("TABLE"),
  crmEnabled: z.coerce.boolean(),
})

/// เมนูแนะนำสูงสุด 6 รายการ — รายการที่ 7 ต้องถูกปฏิเสธที่ server ไม่ใช่แค่ปิดปุ่มบน UI (F21)
export const MAX_FEATURED_MENU = 6

export const featuredMenuSchema = z.object({
  menuItemIds: z
    .array(z.string().trim().min(1))
    .max(MAX_FEATURED_MENU, `ปักหมุดเมนูแนะนำได้สูงสุด ${MAX_FEATURED_MENU} รายการ`)
    .refine((ids) => new Set(ids).size === ids.length, "มีเมนูซ้ำในรายการที่เลือก"),
})

/// เบอร์โทรไทย 10 หลักขึ้นต้นด้วย 0 — เก็บเป็นตัวเลขล้วนเสมอ เบอร์เดียวกันที่พิมพ์คนละรูปแบบ
/// (มีขีด/เว้นวรรค) ต้อง normalize ให้ตรงกัน ไม่งั้น unique ของ Member กันซ้ำไม่ได้จริง
export const registerMemberSchema = z.object({
  qrToken: requiredId("ไม่พบ QR Code ของโต๊ะนี้"),
  phone: z
    .string({ error: "กรุณากรอกเบอร์โทร" })
    .trim()
    .transform((v) => v.replace(/[^0-9]/g, ""))
    .refine((v) => /^0\d{9}$/.test(v), "เบอร์โทรต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0"),
})

// ───────────────────── บทบาทและสิทธิ์ (§4) ─────────────────────

export const roleSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, "กรุณากรอกชื่อบทบาท").max(60, "ชื่อบทบาทยาวเกินไป"),
  description: z
    .string()
    .trim()
    .max(200, "คำอธิบายยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

export const assignRoleSchema = z.object({
  userId: requiredId("ไม่พบผู้ใช้ที่ต้องการแก้ไข"),
  /// ว่าง = ถอดบทบาทออก (ผู้ใช้จะเข้าได้เฉพาะ /settings ตาม §4)
  roleId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
})

// ───────────────── จัดการโต๊ะและเมนู (master data ของ MJD Mobile Order) ─────────────────

/// รหัสโต๊ะ — ตัวอักษร/ตัวเลข/ขีด เท่านั้น เพราะถูกใช้เป็นข้อความบนทิกเก็ตครัวและใบเสร็จ
const tableCode = z
  .string({ error: "กรุณากรอกรหัสโต๊ะ" })
  .trim()
  .min(1, "กรุณากรอกรหัสโต๊ะ")
  .max(12, "รหัสโต๊ะยาวเกินไป (ไม่เกิน 12 ตัวอักษร)")
  .regex(/^[A-Za-z0-9ก-๙\-]+$/, "รหัสโต๊ะใช้ได้เฉพาะตัวอักษร ตัวเลข และขีด (-)")

export const createTableSchema = z.object({ code: tableCode })

export const renameTableSchema = z.object({
  id: requiredId("ไม่พบโต๊ะที่ต้องการแก้ไข"),
  code: tableCode,
})

/// สร้างโต๊ะเป็นชุด เช่น prefix "T" ตั้งแต่ 1 ถึง 16 → T01…T16
/// เพดาน 100 ตัวต่อครั้ง — กันพลาดพิมพ์ 1 ถึง 10000 แล้วถล่มฐาน
export const bulkTableSchema = z
  .object({
    prefix: z
      .string()
      .trim()
      .max(6, "คำนำหน้ายาวเกินไป")
      .regex(/^[A-Za-z0-9ก-๙\-]*$/, "คำนำหน้าใช้ได้เฉพาะตัวอักษร ตัวเลข และขีด (-)"),
    from: z.coerce.number({ error: "เลขเริ่มต้นต้องเป็นตัวเลข" }).int().min(1, "เลขเริ่มต้นต้องมากกว่า 0").max(9999),
    to: z.coerce.number({ error: "เลขสิ้นสุดต้องเป็นตัวเลข" }).int().min(1, "เลขสิ้นสุดต้องมากกว่า 0").max(9999),
  })
  .refine((v) => v.to >= v.from, { message: "เลขสิ้นสุดต้องไม่น้อยกว่าเลขเริ่มต้น", path: ["to"] })
  .refine((v) => v.to - v.from + 1 <= 100, { message: "สร้างได้สูงสุด 100 โต๊ะต่อครั้ง", path: ["to"] })

export const menuItemSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, "กรุณากรอกชื่อเมนู").max(120, "ชื่อเมนูยาวเกินไป"),
  description: z
    .string()
    .trim()
    .max(300, "คำอธิบายยาวเกินไป")
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v)),
  price: z.coerce
    .number({ error: "ราคาต้องเป็นตัวเลข" })
    .min(0, "ราคาต้องไม่ติดลบ")
    .max(999_999, "ราคาสูงเกินไป"),
  imageUrl: z
    .string()
    .trim()
    .max(500, "ลิงก์รูปยาวเกินไป")
    .refine((v) => v === "" || /^(https?:\/\/|\/)/.test(v), "ลิงก์รูปต้องขึ้นต้นด้วย http://, https:// หรือ /")
    .transform((v) => (v === "" ? null : v)),
  isActive: z.coerce.boolean(),
})

// ───────────────── payment confirmation ของ SCB (Phase 10) ─────────────────

/// payload ที่ SCB POST มาที่ปลายทาง payment confirmation
///
/// รับเฉพาะฟิลด์ที่เราใช้ตัดสินใจ ที่เหลือปล่อยผ่าน (ธนาคารส่งฟิลด์ต่างกันตามชนิดการชำระเงิน)
/// **ห้ามเชื่อ payload นี้ตรง ๆ** — SCB ไม่แนบ signature หรือ credential ใด ๆ มาเลย
/// ต้องเอา billPaymentRef1 ไปถามกลับที่ธนาคารด้วย inquireBillPayment() ก่อนปิดบิลเสมอ
export const scbPaymentConfirmationSchema = z.object({
  transactionId: z.string({ error: "ต้องมี transactionId" }).trim().min(1, "ต้องมี transactionId").max(120),
  billPaymentRef1: z.string({ error: "ต้องมี billPaymentRef1" }).trim().min(1, "ต้องมี billPaymentRef1").max(20),
  amount: z.coerce.number({ error: "amount ต้องเป็นตัวเลข" }).min(0).max(9_999_999),
  /// yyyy-MM-ddThh:mm:ss.sss±hh:mm — ใช้ดึงวันที่ไปถาม inquiry (ธนาคารบังคับให้ระบุ transactionDate)
  transactionDateandTime: z.string().trim().min(1).optional(),
  billPaymentRef2: z.string().trim().max(20).optional(),
  billPaymentRef3: z.string().trim().max(20).optional(),
  currencyCode: z.string().trim().max(10).optional(),
})

// ───────────────────── สมาชิกร้าน (Phase 13) ─────────────────────

export const storeSwitchSchema = z.object({
  storeId: requiredId("ไม่พบร้านที่ต้องการสลับไป"),
})

export const userIdSchema = z.object({
  userId: requiredId("ไม่พบผู้ใช้ที่ต้องการแก้ไข"),
})

export const storeMemberRoleSchema = z.object({
  userId: requiredId("ไม่พบผู้ใช้ที่ต้องการแก้ไข"),
  role: z.enum(["OWNER", "STAFF"], { message: "บทบาทในร้านไม่ถูกต้อง" }),
})

// ───────────────────── Onboarding + คำเชิญ (Phase 14a) ─────────────────────

/// slug ที่ชนกับ route/ความหมายพิเศษ — ไม่ให้ร้านใช้ (default = ร้านที่ migrate มาจาก v1)
export const RESERVED_STORE_SLUGS = ["default", "admin", "api", "order", "login", "register", "onboarding", "invite"] as const

export const createStoreSchema = z.object({
  name: z.string().trim().min(2, "ชื่อร้านต้องมีอย่างน้อย 2 ตัวอักษร").max(60, "ชื่อร้านยาวเกินไป (ไม่เกิน 60 ตัวอักษร)"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,30}$/, "รหัสร้าน (slug) ต้องเป็น a-z, 0-9 หรือ - ยาว 3–30 ตัว")
    .refine((v) => !v.startsWith("-") && !v.endsWith("-"), "รหัสร้านต้องไม่ขึ้นต้นหรือลงท้ายด้วย -")
    .refine((v) => !(RESERVED_STORE_SLUGS as readonly string[]).includes(v), "รหัสร้านนี้สงวนไว้สำหรับระบบ กรุณาใช้ชื่ออื่น"),
  themeColor: hexColor,
  /// Phase 14c: "on" = สร้างเป็นสาขาใต้แบรนด์ของผู้ใช้ · copyMenuFromStoreId = คัดลอกเมนูจากสาขานั้นแทนเมนูตัวอย่าง
  joinBrand: z.union([z.literal("on"), z.literal("")]).nullish().transform((v) => v === "on"),
  copyMenuFromStoreId: z.string().trim().max(64).nullish().transform((v) => v || null),
  /// ใส่เมนูตัวอย่าง 3 รายการให้ลองใช้ไหม (2026-09-17) — "off" = ไม่ใส่ · ไม่ส่งมา = ใส่ (ของเดิม) · ถูกข้ามเมื่อคัดลอกเมนู
  sampleMenu: z.union([z.literal("on"), z.literal("off"), z.literal("")]).nullish().transform((v) => v !== "off"),
})

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("รูปแบบอีเมลไม่ถูกต้อง").max(254, "อีเมลยาวเกินไป"),
  role: z.enum(["OWNER", "STAFF"], { message: "บทบาทในร้านไม่ถูกต้อง" }),
})

export const inviteIdSchema = z.object({
  id: requiredId("ไม่พบคำเชิญที่ต้องการยกเลิก"),
})

/// token ดิบจาก URL — 32 ไบต์ base64url = 43 ตัว · ตรวจรูปแบบก่อน hash เพื่อไม่ต้องยิง DB กับค่าขยะ
export const inviteTokenSchema = z.object({
  token: z.string().trim().regex(/^[A-Za-z0-9_-]{32,64}$/, "ลิงก์คำเชิญไม่ถูกต้อง"),
})

/// ตอบรับได้ 2 ทาง: token จากลิงก์ในอีเมล หรือ inviteId จากรายการคำเชิญค้างบน /no-store (ลิงก์หายระหว่างสมัคร)
export const acceptInviteSchema = z
  .object({
    token: z.string().trim().optional().transform((v) => (v === "" ? undefined : v)),
    inviteId: z.string().trim().optional().transform((v) => (v === "" ? undefined : v)),
  })
  .refine((v) => Boolean(v.token || v.inviteId), { message: "ไม่พบคำเชิญที่ต้องการตอบรับ" })
  .refine((v) => !v.token || /^[A-Za-z0-9_-]{32,64}$/.test(v.token), { message: "ลิงก์คำเชิญไม่ถูกต้อง", path: ["token"] })

export const storeStatusSchema = z.object({
  storeId: requiredId("ไม่พบร้านที่ต้องการแก้ไข"),
  status: z.enum(["ACTIVE", "SUSPENDED"], { message: "สถานะร้านไม่ถูกต้อง" }),
})

// ───────────────────── ค่าใช้งานแบบต่ออายุ (Phase 14b) ─────────────────────

const planTierEnum = z.enum(["S", "M", "L", "XL"], { message: "ระดับแพ็กเกจไม่ถูกต้อง" })

export const claimTrialSchema = z.object({
  promptPayId: z.string({ error: "กรุณากรอกเลขพร้อมเพย์ของร้าน" }).trim().min(10, "กรุณากรอกเลขพร้อมเพย์ของร้าน").max(32, "เลขพร้อมเพย์ยาวเกินไป"),
})

export const renewalRequestSchema = z.object({
  planCode: z.string({ error: "กรุณาเลือกแพ็กเกจ" }).trim().regex(/^[A-Z]{1,2}-[A-Z]\d{1,2}$/, "รหัสแพ็กเกจไม่ถูกต้อง"),
})

export const upgradeRequestSchema = z.object({
  tier: planTierEnum,
})

export const subscriptionIdSchema = z.object({
  id: requiredId("ไม่พบรายการค่าใช้งานที่ต้องการ"),
})

export const confirmSubscriptionSchema = z.object({
  id: requiredId("ไม่พบรายการค่าใช้งานที่ต้องการยืนยัน"),
  paymentReference: z
    .string({ error: "กรุณากรอกเลขอ้างอิงจากธนาคาร" })
    .trim()
    .min(4, "เลขอ้างอิงจากธนาคารต้องมีอย่างน้อย 4 ตัว")
    .max(64, "เลขอ้างอิงยาวเกินไป"),
})

export const voidSubscriptionSchema = z.object({
  id: requiredId("ไม่พบรายการค่าใช้งานที่ต้องการยกเลิก"),
  reason: z.string({ error: "กรุณาระบุเหตุผล" }).trim().min(3, "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร").max(200, "เหตุผลยาวเกินไป"),
})

export const grantCustomDaysSchema = z.object({
  storeId: requiredId("ไม่พบร้านที่ต้องการเติมวัน"),
  days: z.coerce.number({ error: "จำนวนวันต้องเป็นตัวเลข" }).int("จำนวนวันต้องเป็นจำนวนเต็ม").min(1, "อย่างน้อย 1 วัน").max(3650, "ไม่เกิน 3650 วัน"),
  tier: planTierEnum.optional(),
  note: z.string({ error: "กรุณาระบุหมายเหตุ" }).trim().min(3, "กรุณาระบุหมายเหตุอย่างน้อย 3 ตัวอักษร").max(200, "หมายเหตุยาวเกินไป"),
})

export const setTableLimitSchema = z.object({
  storeId: requiredId("ไม่พบร้านที่ต้องการแก้ไข"),
  tableLimit: z.coerce.number({ error: "เพดานโต๊ะต้องเป็นตัวเลข" }).int("เพดานโต๊ะต้องเป็นจำนวนเต็ม").min(1, "อย่างน้อย 1 โต๊ะ").max(1000, "ไม่เกิน 1000 โต๊ะ"),
  note: z.string({ error: "กรุณาระบุหมายเหตุ" }).trim().min(3, "กรุณาระบุหมายเหตุอย่างน้อย 3 ตัวอักษร").max(200, "หมายเหตุยาวเกินไป"),
})

/// ออกแพ็กเกจ version ใหม่ — code เดิม = แทนที่ version ก่อน · code ใหม่ = version 1
export const publishPlanSchema = z.object({
  code: z.string({ error: "กรุณากรอกรหัสแพ็กเกจ" }).trim().toUpperCase().regex(/^[A-Z]{1,2}-[A-Z]\d{1,2}$/, "รหัสต้องเป็นรูปแบบ เช่น S-D7, M-M3"),
  name: z.string({ error: "กรุณากรอกชื่อแพ็กเกจ" }).trim().min(2, "ชื่อแพ็กเกจสั้นเกินไป").max(60, "ชื่อแพ็กเกจยาวเกินไป"),
  tier: planTierEnum,
  tableLimit: z.coerce.number({ error: "เพดานโต๊ะต้องเป็นตัวเลข" }).int().min(1, "อย่างน้อย 1 โต๊ะ").max(1000, "ไม่เกิน 1000 โต๊ะ"),
  durationDays: z.coerce.number({ error: "จำนวนวันต้องเป็นตัวเลข" }).int().min(1, "อย่างน้อย 1 วัน").max(3650, "ไม่เกิน 3650 วัน"),
  ratePerDay: z.coerce.number({ error: "เรตต่อวันต้องเป็นตัวเลข" }).min(0, "เรตต่อวันติดลบไม่ได้").max(100000, "เรตต่อวันสูงเกินไป"),
  price: z.coerce.number({ error: "ราคาสุทธิต้องเป็นตัวเลข" }).min(0, "ราคาติดลบไม่ได้").max(10_000_000, "ราคาสูงเกินไป"),
  sortOrder: z.coerce.number({ error: "ลำดับต้องเป็นตัวเลข" }).int().min(0).max(999).default(0),
})

export const planCodeSchema = z.object({
  code: z.string({ error: "ไม่พบรหัสแพ็กเกจ" }).trim().toUpperCase().min(1, "ไม่พบรหัสแพ็กเกจ").max(20),
})

// ───────────────────── ร้านหลายสาขา / Brand (Phase 14c) ─────────────────────

const brandName = z
  .string({ error: "กรุณากรอกชื่อแบรนด์" })
  .trim()
  .min(2, "ชื่อแบรนด์ต้องมีอย่างน้อย 2 ตัวอักษร")
  .max(60, "ชื่อแบรนด์ยาวเกินไป (ไม่เกิน 60 ตัวอักษร)")

export const createBrandSchema = z.object({
  name: brandName,
  /// สาขาที่จะดึงเข้าแบรนด์ทันที (เลือกได้หลายร้าน · ว่างได้) — ต้องเป็น OWNER ของทุกร้านที่เลือก
  storeIds: z.array(requiredId("ไม่พบร้านที่เลือก")).max(50, "เลือกร้านได้ไม่เกิน 50 ร้านต่อครั้ง"),
})

export const renameBrandSchema = z.object({ name: brandName })

export const attachStoreToBrandSchema = z.object({
  storeId: requiredId("ไม่พบร้านที่ต้องการดึงเข้าแบรนด์"),
})

export const copyMenuSchema = z.object({
  sourceStoreId: requiredId("กรุณาเลือกสาขาต้นทางที่จะคัดลอกเมนู"),
})

/// รายการในใบจ่ายรวม — ฟอร์มส่งมาเป็น "storeId|planCode" ต่อสาขา
export const brandBatchSchema = z.object({
  items: z
    .array(
      z.object({
        storeId: requiredId("ไม่พบสาขาในรายการ"),
        planCode: z.string({ error: "กรุณาเลือกแพ็กเกจ" }).trim().regex(/^[A-Z]{1,2}-[A-Z]\d{1,2}$/, "รหัสแพ็กเกจไม่ถูกต้อง"),
      }),
    )
    .min(1, "เลือกอย่างน้อย 1 สาขา")
    .max(50, "จ่ายรวมได้ไม่เกิน 50 สาขาต่อใบ")
    .refine((items) => new Set(items.map((i) => i.storeId)).size === items.length, "มีสาขาซ้ำกันในรายการ"),
})

export const batchIdSchema = z.object({
  batchId: requiredId("ไม่พบใบจ่ายรวมที่ต้องการ"),
})

export const confirmBatchSchema = z.object({
  batchId: requiredId("ไม่พบใบจ่ายรวมที่ต้องการยืนยัน"),
  paymentReference: z
    .string({ error: "กรุณากรอกเลขอ้างอิงจากธนาคาร" })
    .trim()
    .min(4, "เลขอ้างอิงจากธนาคารต้องมีอย่างน้อย 4 ตัว")
    .max(64, "เลขอ้างอิงยาวเกินไป"),
})

export const voidBatchSchema = z.object({
  batchId: requiredId("ไม่พบใบจ่ายรวมที่ต้องการยกเลิก"),
  reason: z.string({ error: "กรุณาระบุเหตุผล" }).trim().min(3, "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร").max(200, "เหตุผลยาวเกินไป"),
})

// ───────────────────── บัญชีรับเงินของร้าน (Phase 15a) ─────────────────────

/// ฝั่งเจ้าของร้าน — เลือกได้เฉพาะโหมดพร้อมเพย์ตรง (ก) · ก+ รอ 15b · ข ให้ผู้ดูแลตั้ง (setStorePaymentMode)
export const paymentConfigSchema = z.object({
  paymentMode: z.enum(["PROMPTPAY_DIRECT", "PROMPTPAY_SLIP", "SCB_BILLER"], { error: "กรุณาเลือกวิธีรับเงิน" }),
  promptPayId: z.string().trim().max(32, "เลขพร้อมเพย์ยาวเกินไป").default(""),
  accountName: z.string().trim().max(100, "ชื่อบัญชียาวเกินไป").default(""),
  bankAccountNumber: z
    .string()
    .trim()
    .max(20, "เลขบัญชียาวเกินไป")
    .refine((v) => v === "" || /^[0-9-]{6,20}$/.test(v), "เลขบัญชีต้องเป็นตัวเลข (ใส่ - ได้)")
    .default(""),
})

/// ฝั่งผู้ดูแลแพลตฟอร์ม — เปลี่ยนโหมดให้ร้านใดก็ได้ (รวม SCB_BILLER)
export const adminPaymentModeSchema = z.object({
  storeId: requiredId("ไม่พบร้านที่ต้องการตั้งค่า"),
  paymentMode: z.enum(["PROMPTPAY_DIRECT", "PROMPTPAY_SLIP", "SCB_BILLER"], { error: "กรุณาเลือกวิธีรับเงิน" }),
})

// ───────────────────── SCB Open API ต่อร้าน (Phase 15c) ─────────────────────

/// key/secret เว้นว่างได้เมื่อแก้ค่าอื่นโดยไม่พิมพ์ซ้ำ (action จะคงค่าเดิมที่เข้ารหัสไว้)
export const scbCredentialsSchema = z.object({
  environment: z.enum(["production", "sandbox"], { error: "กรุณาเลือกสภาพแวดล้อมของ SCB" }),
  apiKey: z.string().trim().max(200, "API key ยาวเกินไป").default(""),
  apiSecret: z.string().trim().max(200, "API secret ยาวเกินไป").default(""),
  billerId: z
    .string({ error: "กรุณากรอก Biller ID" })
    .trim()
    .regex(/^\d{10,20}$/, "Biller ID ต้องเป็นตัวเลข 10–20 หลัก"),
  ref3Prefix: z
    .string({ error: "กรุณากรอก ref3 prefix" })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, "ref3 prefix ต้องเป็น A-Z/0-9 ยาว 2–8 ตัว ตามที่ SCB กำหนดให้"),
})
