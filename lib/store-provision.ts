import type { PermissionAction, Prisma, ResourceKey } from "@/generated/prisma/client"

/// สร้างร้านใหม่ให้ครบชุด (Phase 13) — Store + StoreSettings + บทบาทระบบ 4 บทบาท ในทรานแซคชันเดียว
///
/// ใช้ร่วมกันโดย seed, สคริปต์, เทส และ onboarding ใน Phase 14 — เพื่อให้ "ร้านที่ไม่มี settings"
/// หรือ "ร้านที่ไม่มีบทบาทระบบ" ไม่มีทางเกิดขึ้นได้ไม่ว่าจะสร้างจากทางไหน
///
/// ไม่ import prisma เอง — รับ client/tx จากผู้เรียก จะได้อยู่ในทรานแซคชันเดียวกับงานอื่นได้
/// (เช่น onboarding ที่สร้างร้าน + ผูก OWNER + คัดลอกเมนู พร้อมกัน)

type RolePreset = {
  name: string
  description: string
  isSystem: boolean
  permissions: Partial<Record<ResourceKey, PermissionAction[]>>
}

/// ชุดเดียวกับที่ migration add_rbac seed ให้ร้านแรก — แก้ที่นี่ที่เดียว
export const SYSTEM_ROLE_PRESETS: RolePreset[] = [
  {
    name: "ผู้ดูแลระบบ",
    description: "เข้าถึงและจัดการได้ทุกอย่างรวมถึงสิทธิ์ผู้ใช้",
    isSystem: true,
    permissions: {
      DASHBOARD: ["VIEW"],
      PRODUCTS: ["VIEW", "ADD", "EDIT", "DELETE"],
      CATEGORIES: ["VIEW", "ADD", "EDIT", "DELETE"],
      STOCK_IN: ["VIEW", "ADD"],
      STOCK_OUT: ["VIEW", "ADD"],
      POS: ["VIEW", "ADD"],
      POS_HISTORY: ["VIEW", "DELETE"],
      POS_CLOSING: ["VIEW", "ADD"],
      REPORTS: ["VIEW"],
      USERS: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_TABLES: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_KITCHEN: ["VIEW", "EDIT"],
      MO_NOTIFICATIONS: ["VIEW", "EDIT"],
      MO_MENU: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_SETUP: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_POS: ["VIEW", "ADD"],
    },
  },
  {
    name: "ผู้จัดการร้าน",
    description: "จัดการสินค้า สต็อก การขาย และรายงานได้ทั้งหมด",
    isSystem: false,
    permissions: {
      DASHBOARD: ["VIEW"],
      PRODUCTS: ["VIEW", "ADD", "EDIT", "DELETE"],
      CATEGORIES: ["VIEW", "ADD", "EDIT", "DELETE"],
      STOCK_IN: ["VIEW", "ADD"],
      STOCK_OUT: ["VIEW", "ADD"],
      POS: ["VIEW", "ADD"],
      POS_HISTORY: ["VIEW", "DELETE"],
      POS_CLOSING: ["VIEW", "ADD"],
      REPORTS: ["VIEW"],
      USERS: ["VIEW"],
      MO_TABLES: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_KITCHEN: ["VIEW", "EDIT"],
      MO_NOTIFICATIONS: ["VIEW", "EDIT"],
      MO_MENU: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_SETUP: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_POS: ["VIEW", "ADD"],
    },
  },
  {
    name: "แคชเชียร์",
    description: "ขายหน้าร้านและปิดยอดได้ ดูข้อมูลอื่นได้อย่างเดียว",
    isSystem: false,
    permissions: {
      DASHBOARD: ["VIEW"],
      PRODUCTS: ["VIEW"],
      CATEGORIES: ["VIEW"],
      POS: ["VIEW", "ADD"],
      POS_HISTORY: ["VIEW", "DELETE"],
      POS_CLOSING: ["VIEW", "ADD"],
      REPORTS: ["VIEW"],
      MO_TABLES: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_KITCHEN: ["VIEW", "EDIT"],
      MO_NOTIFICATIONS: ["VIEW", "EDIT"],
      MO_MENU: ["VIEW"],
      MO_SETUP: ["VIEW"],
      MO_POS: ["VIEW", "ADD"],
    },
  },
  // Phase 16 — พนักงานที่ทำงานเฉพาะฝั่ง Mobile Order (ไม่เห็นคลังสินค้า/POS) · migration backfill ผูกให้ STAFF
  // ที่ยังไม่มีบทบาทตอน deploy เพราะเดิมคนกลุ่มนี้เข้าได้แค่หน้า Mobile Order อยู่แล้ว
  {
    name: "พนักงานเสิร์ฟ",
    description: "รับออเดอร์ เสิร์ฟ และปิดบิลโต๊ะได้ ไม่เห็นคลังสินค้าและ POS",
    isSystem: false,
    permissions: {
      MO_TABLES: ["VIEW", "ADD", "EDIT", "DELETE"],
      MO_KITCHEN: ["VIEW", "EDIT"],
      MO_NOTIFICATIONS: ["VIEW", "EDIT"],
      MO_MENU: ["VIEW"],
      MO_SETUP: ["VIEW"],
      MO_POS: ["VIEW", "ADD"],
    },
  },
]

/// รับได้ทั้ง PrismaClient ตรง ๆ และ tx ในทรานแซคชัน (PrismaClient assignable ไป TransactionClient)
export type ProvisionClient = Prisma.TransactionClient

export type ProvisionInput = {
  /// ตั้ง id เองได้ (seed/เทสอยากได้ค่าคงที่) — ปล่อยว่างให้ Prisma สุ่ม cuid
  id?: string
  slug: string
  name: string
  /// สีธีมฝั่งลูกค้า — ค่าตั้งต้นคือสีแบรนด์ customer ตาม design system
  themeColor?: string
  /// ผู้ใช้ที่จะเป็น OWNER ทันที (onboarding/seed) — ไม่ระบุ = ร้านว่างไม่มีสมาชิก
  ownerUserId?: string
}

/// idempotent: เรียกซ้ำด้วย slug เดิมได้ ไม่สร้างซ้ำ ไม่ทับข้อมูลที่ร้านแก้ไปแล้ว
export async function provisionStore(db: ProvisionClient, input: ProvisionInput): Promise<{ storeId: string }> {
  const store = await db.store.upsert({
    where: { slug: input.slug },
    update: {},
    create: { ...(input.id ? { id: input.id } : {}), slug: input.slug, name: input.name },
    select: { id: true },
  })

  await db.storeSettings.upsert({
    where: { storeId: store.id },
    update: {},
    create: { storeId: store.id, storeName: input.name, themeColor: input.themeColor ?? "#E8571F" },
  })

  for (const preset of SYSTEM_ROLE_PRESETS) {
    const existing = await db.role.findFirst({ where: { storeId: store.id, name: preset.name }, select: { id: true } })
    if (existing) continue
    const role = await db.role.create({
      data: { storeId: store.id, name: preset.name, description: preset.description, isSystem: preset.isSystem },
      select: { id: true },
    })
    await db.rolePermission.createMany({
      data: Object.entries(preset.permissions).map(([resource, actions]) => ({
        roleId: role.id,
        resource: resource as ResourceKey,
        actions,
      })),
    })
  }

  if (input.ownerUserId) {
    await db.storeMember.upsert({
      where: { userId_storeId: { userId: input.ownerUserId, storeId: store.id } },
      update: {},
      create: { userId: input.ownerUserId, storeId: store.id, role: "OWNER" },
    })
  }

  return { storeId: store.id }
}
