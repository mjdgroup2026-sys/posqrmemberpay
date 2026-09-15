import { randomBytes } from "node:crypto"
import type { PrismaClient } from "../generated/prisma/client"

/// ข้อมูลตั้งต้นของ MJD Mobile Order (Phase 6) — โต๊ะ 16 โต๊ะ, เมนู 18 รายการ (แนะนำ 6),
/// modifier ของเมนูที่ต้องเลือกเพิ่ม และ StoreSettings แถวเดียวของระบบ
///
/// idempotent ทั้งหมด: รันซ้ำได้โดยไม่สร้างซ้ำ (upsert ด้วย unique key ของแต่ละตาราง)

const TABLE_COUNT = 16

type ModifierSeed = {
  name: string
  selectionType: "SINGLE" | "MULTIPLE"
  required: boolean
  options: { name: string; priceDelta: string }[]
}

type MenuSeed = {
  name: string
  description?: string
  price: string
  featured?: number
  modifiers?: ModifierSeed[]
}

const SPICE_LEVEL: ModifierSeed = {
  name: "ระดับความเผ็ด",
  selectionType: "SINGLE",
  required: true,
  options: [
    { name: "ไม่เผ็ด", priceDelta: "0.00" },
    { name: "เผ็ดน้อย", priceDelta: "0.00" },
    { name: "เผ็ดกลาง", priceDelta: "0.00" },
    { name: "เผ็ดมาก", priceDelta: "0.00" },
  ],
}

const EXTRA_TOPPING: ModifierSeed = {
  name: "ท็อปปิ้งเพิ่ม",
  selectionType: "MULTIPLE",
  required: false,
  options: [
    { name: "ไข่ดาว", priceDelta: "15.00" },
    { name: "ไข่เจียว", priceDelta: "20.00" },
    { name: "เพิ่มเนื้อสัตว์", priceDelta: "30.00" },
    { name: "ข้าวเพิ่ม", priceDelta: "10.00" },
  ],
}

const SWEETNESS: ModifierSeed = {
  name: "ระดับความหวาน",
  selectionType: "SINGLE",
  required: true,
  options: [
    { name: "หวานน้อย", priceDelta: "0.00" },
    { name: "หวานปกติ", priceDelta: "0.00" },
    { name: "หวานมาก", priceDelta: "0.00" },
  ],
}

const MENU_ITEMS: MenuSeed[] = [
  { name: "ข้าวกะเพราหมูสับไข่ดาว", description: "กะเพราใบใหญ่ ผัดไฟแรง", price: "75.00", featured: 1, modifiers: [SPICE_LEVEL, EXTRA_TOPPING] },
  { name: "ข้าวผัดกุ้ง", description: "กุ้งสด 5 ตัว", price: "95.00", featured: 2, modifiers: [EXTRA_TOPPING] },
  { name: "ต้มยำกุ้งน้ำข้น", description: "เข้มข้นแบบต้นตำรับ", price: "180.00", featured: 3, modifiers: [SPICE_LEVEL] },
  { name: "ผัดไทยกุ้งสด", price: "110.00", featured: 4, modifiers: [EXTRA_TOPPING] },
  { name: "ส้มตำไทย", price: "65.00", featured: 5, modifiers: [SPICE_LEVEL] },
  { name: "หมูกรอบคั่วพริกเกลือ", price: "150.00", featured: 6, modifiers: [SPICE_LEVEL] },
  { name: "ข้าวผัดหมู", price: "70.00", modifiers: [EXTRA_TOPPING] },
  { name: "ข้าวหมูทอดกระเทียม", price: "80.00" },
  { name: "แกงเขียวหวานไก่", price: "120.00", modifiers: [SPICE_LEVEL] },
  { name: "ยำวุ้นเส้นทะเล", price: "130.00", modifiers: [SPICE_LEVEL] },
  { name: "ไก่ทอดน้ำปลา", price: "140.00" },
  { name: "ปลาทับทิมนึ่งมะนาว", description: "ปลาสดทั้งตัว", price: "320.00", modifiers: [SPICE_LEVEL] },
  { name: "ผัดผักบุ้งไฟแดง", price: "60.00", modifiers: [SPICE_LEVEL] },
  { name: "ไข่เจียวหมูสับ", price: "60.00" },
  { name: "ข้าวสวย", price: "15.00" },
  { name: "น้ำเปล่า", price: "15.00" },
  { name: "ชาไทยเย็น", price: "45.00", modifiers: [SWEETNESS] },
  { name: "น้ำมะนาวโซดา", price: "55.00", modifiers: [SWEETNESS] },
]

function qrToken(): string {
  return randomBytes(16).toString("base64url")
}

/// ทุกอย่างในนี้เป็นของร้าน `storeId` (Phase 13) — StoreSettings ถูกสร้างพร้อมร้านแล้วโดย provisionStore()
export async function seedMobileOrder(prisma: PrismaClient, storeId: string) {

  // ── โต๊ะ 16 โต๊ะ + QR แบบ STATIC โต๊ะละ 1 ใบ ───────────────────────────
  for (let i = 1; i <= TABLE_COUNT; i++) {
    const code = String(i).padStart(2, "0")
    const table = await prisma.table.upsert({
      where: { storeId_code: { storeId, code } },
      update: {},
      create: { storeId, code },
    })

    const hasQr = await prisma.qRCode.findFirst({ where: { tableId: table.id, status: "ACTIVE" } })
    if (!hasQr) {
      await prisma.qRCode.create({
        data: { storeId, tableId: table.id, type: "STATIC", token: qrToken() },
      })
    }
  }

  // ── เมนู + modifier ───────────────────────────────────────────────────
  for (const item of MENU_ITEMS) {
    const existing = await prisma.menuItem.findFirst({ where: { storeId, name: item.name } })
    if (existing) continue

    const created = await prisma.menuItem.create({
      data: {
        storeId,
        name: item.name,
        description: item.description,
        price: item.price,
        isFeatured: item.featured !== undefined,
        featuredSortOrder: item.featured,
      },
    })

    let groupOrder = 0
    for (const group of item.modifiers ?? []) {
      groupOrder += 1
      const createdGroup = await prisma.modifierGroup.create({
        data: {
          storeId,
          menuItemId: created.id,
          name: group.name,
          selectionType: group.selectionType,
          required: group.required,
          sortOrder: groupOrder,
        },
      })

      let optionOrder = 0
      for (const option of group.options) {
        optionOrder += 1
        await prisma.modifierOption.create({
          data: {
            modifierGroupId: createdGroup.id,
            name: option.name,
            priceDelta: option.priceDelta,
            sortOrder: optionOrder,
          },
        })
      }
    }
  }

  const [tables, menuItems, featured] = await Promise.all([
    prisma.table.count({ where: { storeId } }),
    prisma.menuItem.count({ where: { storeId } }),
    prisma.menuItem.count({ where: { storeId, isFeatured: true } }),
  ])

  console.info(
    `seed MJD Mobile Order เรียบร้อย — โต๊ะ ${tables} โต๊ะ, เมนู ${menuItems} รายการ (แนะนำ ${featured})`,
  )
}
