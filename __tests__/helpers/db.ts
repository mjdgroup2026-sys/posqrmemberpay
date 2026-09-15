import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/generated/prisma/client"
import { provisionStore } from "@/lib/store-provision"

/// ค่า DATABASE_URL ถูกโหลดจาก .env.test ใน __tests__/setup.ts (override: true)
function databaseUrl(): string {
  return process.env.DATABASE_URL ?? ""
}

/// กันพลาดยิงลงฐาน dev — ชื่อฐานของเทสต้องลงท้ายด้วย _test เท่านั้น
export function assertTestDatabase(): void {
  const url = databaseUrl()
  if (!url) {
    throw new Error("ไม่พบ DATABASE_URL สำหรับเทส — สร้างไฟล์ .env.test ก่อน (ดู README ของเทส)")
  }
  const name = new URL(url).pathname.replace(/^\//, "")
  if (!name.endsWith("_test")) {
    throw new Error(`ฐานข้อมูลของเทสต้องลงท้ายด้วย _test แต่ได้ "${name}" — ห้ามยิงลงฐาน dev`)
  }
}

let client: PrismaClient | undefined

export function testPrisma(): PrismaClient {
  assertTestDatabase()
  if (!client) {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })
  }
  return client
}

/// เช็คว่าต่อฐานเทสได้จริงไหม (Docker ปิดอยู่ / ยังไม่ได้สร้างฐาน → false)
export async function isTestDbReachable(): Promise<boolean> {
  try {
    const db = testPrisma()
    await db.$queryRaw`SELECT 1`
    await db.$queryRaw`SELECT 1 FROM "store" LIMIT 1`
    return true
  } catch {
    return false
  }
}

export async function disconnectTestDb(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = undefined
  }
}

// ───────────────────── ร้านทดสอบ (Phase 13) ─────────────────────

/// ร้านเริ่มต้นของทุกเทส — helper ทุกตัวสร้างข้อมูลลงร้านนี้ถ้าไม่ระบุ storeId
/// id คงที่ให้เทสอ้างได้โดยไม่ต้อง await (เช่นตอนประกาศ describe)
export const TEST_STORE_ID = "store_test_a"
export const TEST_STORE_SLUG = "test-a"

/// ร้านที่สอง — ไว้ให้เทสแยกร้าน (tenant-isolation) และเทส "ร้านอื่นมองไม่เห็น"
export const OTHER_STORE_ID = "store_test_b"
export const OTHER_STORE_SLUG = "test-b"

/// สร้างร้านให้ครบชุด (Store + StoreSettings + บทบาทระบบ) ผ่าน provisionStore() ตัวเดียวกับ production
/// idempotent — เรียกซ้ำได้ในเทสเดียวกัน
/// ค่าเริ่มต้นให้ร้านทดสอบ "มีแพ็กเกจใช้งานอยู่" (XL ถึง 2099 — เหมือน backfill ร้านเดิม) เพื่อให้เทสเดิมทั้งหมด
/// ยังวัดตรรกะธุรกิจ ไม่ไปติดด่าน requireSellingStore (Phase 14b) · เทส billing ระบุ plan เองเพื่อจำลองร้านใหม่/หมดอายุ
export type TestStorePlan = "active" | "none" | { tier: "S" | "M" | "L" | "XL"; tableLimit: number; expiresAt: Date | null }

export async function ensureTestStore(
  input: { id?: string; slug?: string; name?: string; status?: "ACTIVE" | "SUSPENDED"; plan?: TestStorePlan } = {},
) {
  const db = testPrisma()
  const id = input.id ?? TEST_STORE_ID
  const slug = input.slug ?? (id === OTHER_STORE_ID ? OTHER_STORE_SLUG : TEST_STORE_SLUG)
  // ร้านที่มีอยู่แล้วและไม่ได้ระบุ plan → ไม่ทับ (ensureTestUser เรียกซ้ำผ่านทางนี้ ไม่ควรล้าง plan "none" ที่เทสตั้งไว้)
  const existed = Boolean(await db.store.findUnique({ where: { id }, select: { id: true } }))
  const { storeId } = await provisionStore(db, { id, slug, name: input.name ?? `ร้านทดสอบ ${slug}` })
  if (existed && !input.plan) {
    if (input.status) await db.store.update({ where: { id: storeId }, data: { status: input.status } })
    return storeId
  }
  const plan = input.plan ?? "active"
  const planData =
    plan === "active"
      ? { planTier: "XL" as const, tableLimit: 120, planExpiresAt: new Date("2099-12-31T00:00:00.000Z") }
      : plan === "none"
        ? { planTier: null, tableLimit: 12, planExpiresAt: null }
        : { planTier: plan.tier, tableLimit: plan.tableLimit, planExpiresAt: plan.expiresAt }
  await db.store.update({ where: { id: storeId }, data: { ...planData, ...(input.status ? { status: input.status } : {}) } })
  return storeId
}

/// ล้างข้อมูลก่อนทุกเทส — ledger เป็น append-only ในโค้ด production
/// การ TRUNCATE ที่นี่ทำได้เฉพาะกับฐาน _test เท่านั้น (assertTestDatabase กันไว้)
export async function resetDb(): Promise<void> {
  const db = testPrisma()
  // ลบตามลำดับ FK — sale_item/stock_transaction อ้าง sale กับ product, cashier_closing อ้าง user
  // ตารางฝั่ง MJD Mobile Order ต้องล้างด้วย ไม่งั้นโต๊ะ/เมนูจากเทสก่อนหน้าค้างข้ามไฟล์
  await db.$executeRawUnsafe(
    [
      "TRUNCATE TABLE",
      '"sale_item", "stock_transaction", "cashier_closing", "member_point_transaction", "sale",',
      '"mobile_order_item", "mobile_order", "notification", "line_notification_log",',
      '"payment_intent", "table_session",',
      '"qr_code", "restaurant_table", "modifier_option", "modifier_group", "menu_item",',
      '"member", "store_settings", "product", "category",',
      // ตารางสิทธิ์ (§4) — ต้องล้างด้วย ไม่งั้นบทบาทจากเทสก่อนหน้าค้างแล้วชนกับ unique ของชื่อบทบาท
      '"role_permission", "role",',
      // คำเชิญเข้าร้าน (Phase 14a) อ้าง store + user · ค่าใช้งาน (Phase 14b) — trial_claim ไม่มี FK แต่ต้องล้างด้วย
      '"store_invite", "store_subscription", "trial_claim",',
      // ร้านและสมาชิก (Phase 13) — ล้างท้ายสุดเพราะทุกตารางข้างบนอ้างมาที่นี่
      '"store_member", "store"',
      "RESTART IDENTITY CASCADE",
    ].join(" "),
  )
}

let skuCounter = 1000

type TestProductInput = {
  storeId?: string
  sku?: string
  name?: string
  category?: string
  unit?: string
  quantity?: number
  reorderPoint?: number
  price?: string
}

export async function createTestProduct(input: TestProductInput = {}) {
  skuCounter += 1
  const db = testPrisma()
  const storeId = input.storeId ?? (await ensureTestStore())
  const categoryName = input.category ?? "เครื่องปรุง"
  return db.product.create({
    data: {
      // ใช้ relation แบบ checked ทั้งคู่ — Prisma ไม่ให้ผสม storeId ดิบกับ category.connectOrCreate
      store: { connect: { id: storeId } },
      sku: input.sku ?? `SKU-${skuCounter}`,
      name: input.name ?? "น้ำปลาทดสอบ",
      category: {
        connectOrCreate: {
          where: { storeId_name: { storeId, name: categoryName } },
          create: { storeId, name: categoryName },
        },
      },
      unit: input.unit ?? "ขวด",
      quantity: input.quantity ?? 0,
      reorderPoint: input.reorderPoint ?? 0,
      price: input.price ?? "120.00",
    },
  })
}

/// ทุก resource พร้อม action ที่ resource นั้นรองรับจริง (ตรงกับ RESOURCE_ACTIONS ใน §4)
const FULL_PERMISSIONS = [
  { resource: "DASHBOARD", actions: ["VIEW"] },
  { resource: "PRODUCTS", actions: ["VIEW", "ADD", "EDIT", "DELETE"] },
  { resource: "CATEGORIES", actions: ["VIEW", "ADD", "EDIT", "DELETE"] },
  { resource: "STOCK_IN", actions: ["VIEW", "ADD"] },
  { resource: "STOCK_OUT", actions: ["VIEW", "ADD"] },
  { resource: "POS", actions: ["VIEW", "ADD"] },
  { resource: "POS_HISTORY", actions: ["VIEW", "DELETE"] },
  { resource: "POS_CLOSING", actions: ["VIEW", "ADD"] },
  { resource: "REPORTS", actions: ["VIEW"] },
  { resource: "USERS", actions: ["VIEW", "ADD", "EDIT", "DELETE"] },
] as const

/// บทบาท (matrix สิทธิ์ §4) เต็มสิทธิ์ของร้าน — ผูกให้สมาชิก STAFF ที่ต้องทำได้ทุกอย่างในเทส
/// OWNER ไม่ต้องใช้ (ได้เต็มเสมอ) · เทสที่ทดสอบระบบสิทธิ์เองให้ผูกบทบาทเอง
export async function giveFullPermissions(userId: string, storeId = TEST_STORE_ID) {
  const db = testPrisma()
  const role = await db.role.upsert({
    where: { storeId_name: { storeId, name: "เต็มสิทธิ์ (เทส)" } },
    update: {},
    create: {
      storeId,
      name: "เต็มสิทธิ์ (เทส)",
      permissions: {
        create: FULL_PERMISSIONS.map((row) => ({
          resource: row.resource as never,
          actions: [...row.actions] as never,
        })),
      },
    },
    select: { id: true },
  })
  await db.storeMember.update({
    where: { userId_storeId: { userId, storeId } },
    data: { roleId: role.id },
  })
  return role.id
}

type TestUserOptions = {
  /// ร้านที่ผู้ใช้เป็นสมาชิก — ค่าเริ่มต้นคือร้านทดสอบหลัก · null = ไม่อยู่ในร้านใดเลย (เทส NO_STORE)
  storeId?: string | null
  /// OWNER (ค่าเริ่มต้น) ได้สิทธิ์เต็มทุก resource อัตโนมัติ · STAFF ต้องผูกบทบาท §4 เอง
  role?: "OWNER" | "STAFF"
  isPlatformAdmin?: boolean
}

/// Sale.cashierId เป็น FK ไปตาราง user — ต้องมีผู้ใช้ทดสอบอยู่จริงก่อนสร้างบิล
/// ค่าเริ่มต้น: เป็น OWNER ของร้านทดสอบหลัก จึงผ่านทั้ง requireStore()/requireOwner() และด่านสิทธิ์ §4
/// — เทสเดิมจึงยังวัดสิ่งที่ตั้งใจวัด (ตรรกะธุรกิจ) ไม่ใช่ไปติดด่านสิทธิ์แทน
export async function ensureTestUser(id = "test-user", name = "ผู้ทดสอบ", options: TestUserOptions = {}) {
  const db = testPrisma()
  const user = await db.user.upsert({
    where: { id },
    update: { ...(options.isPlatformAdmin === undefined ? {} : { isPlatformAdmin: options.isPlatformAdmin }) },
    create: {
      id,
      name,
      email: `${id}@example.com`,
      emailVerified: true,
      isPlatformAdmin: options.isPlatformAdmin ?? false,
    },
  })
  if (options.storeId !== null) {
    // ร้านที่ระบุมาต้องมีอยู่จริง — provision ให้เลย (idempotent) จะได้ไม่ต้องเรียก ensureTestStore() แยกก่อน
    const storeId = await ensureTestStore(options.storeId ? { id: options.storeId } : {})
    await addTestMember(id, storeId, options.role ?? "OWNER")
  }
  return user
}

/// เพิ่มผู้ใช้เข้าร้าน (idempotent) — ใช้กับเทสที่ผู้ใช้อยู่หลายร้าน
export async function addTestMember(userId: string, storeId: string, role: "OWNER" | "STAFF" = "STAFF") {
  const db = testPrisma()
  return db.storeMember.upsert({
    where: { userId_storeId: { userId, storeId } },
    update: { role },
    create: { userId, storeId, role },
  })
}

export async function createTestCategory(name = "หมวดทดสอบ", storeId?: string) {
  const db = testPrisma()
  const sid = storeId ?? (await ensureTestStore())
  return db.category.upsert({
    where: { storeId_name: { storeId: sid, name } },
    update: {},
    create: { storeId: sid, name },
  })
}

let tableCounter = 0

export async function createTestTable(code?: string, storeId?: string) {
  tableCounter += 1
  const db = testPrisma()
  const sid = storeId ?? (await ensureTestStore())
  return db.table.create({
    data: { storeId: sid, code: code ?? `T${String(tableCounter).padStart(2, "0")}` },
  })
}

export async function createTestQrCode(
  tableId: string,
  input: { token?: string; type?: "STATIC" | "DYNAMIC"; status?: "ACTIVE" | "INVALIDATED"; storeId?: string } = {},
) {
  const db = testPrisma()
  // QR ต้องอยู่ร้านเดียวกับโต๊ะเสมอ — อ่านจากโต๊ะถ้าไม่ระบุ
  const storeId =
    input.storeId ?? (await db.table.findUniqueOrThrow({ where: { id: tableId }, select: { storeId: true } })).storeId
  return db.qRCode.create({
    data: {
      storeId,
      tableId,
      token: input.token ?? `qr-${Math.random().toString(36).slice(2, 12)}`,
      type: input.type ?? "STATIC",
      status: input.status ?? "ACTIVE",
    },
  })
}

export async function createTestMenuItem(input: { name?: string; price?: string; storeId?: string } = {}) {
  const db = testPrisma()
  const storeId = input.storeId ?? (await ensureTestStore())
  return db.menuItem.create({
    data: { storeId, name: input.name ?? "ข้าวกะเพราทดสอบ", price: input.price ?? "80.00" },
  })
}

/// StoreSettings มี 1 แถวต่อร้าน (สร้างมาพร้อมร้านแล้ว) — เทสที่แตะเส้นทางครัวต้องตั้งค่า hasKDS ก่อนเสมอ
export async function setStoreSettings(
  input: { hasKDS?: boolean; serviceChargePercent?: string; crmEnabled?: boolean; storeId?: string } = {},
) {
  const db = testPrisma()
  const storeId = input.storeId ?? (await ensureTestStore())
  const patch = {
    ...(input.hasKDS === undefined ? {} : { hasKDS: input.hasKDS }),
    ...(input.serviceChargePercent === undefined ? {} : { serviceChargePercent: input.serviceChargePercent }),
    ...(input.crmEnabled === undefined ? {} : { crmEnabled: input.crmEnabled }),
  }
  return db.storeSettings.upsert({
    where: { storeId },
    update: patch,
    create: {
      storeId,
      storeName: "ร้านทดสอบ",
      themeColor: "#E8571F",
      hasKDS: input.hasKDS ?? false,
      serviceChargePercent: input.serviceChargePercent ?? "0.00",
      crmEnabled: input.crmEnabled ?? false,
    },
  })
}

/// TableSession ต้องอยู่ร้านเดียวกับโต๊ะ — helper กลางที่เทสส่วนใหญ่ใช้เปิดโต๊ะตรง ๆ
export async function createTestSession(
  tableId: string,
  input: { status?: "OPEN" | "AWAITING_BILL" | "CLOSED" | "CANCELLED"; qrCodeId?: string } = {},
) {
  const db = testPrisma()
  const table = await db.table.findUniqueOrThrow({ where: { id: tableId }, select: { storeId: true } })
  return db.tableSession.create({
    data: {
      storeId: table.storeId,
      tableId,
      status: input.status ?? "OPEN",
      ...(input.qrCodeId ? { qrCodeId: input.qrCodeId } : {}),
    },
  })
}

export async function createTestOrder(sessionId: string, orderNumber = 1) {
  const db = testPrisma()
  const session = await db.tableSession.findUniqueOrThrow({ where: { id: sessionId }, select: { storeId: true } })
  return db.mobileOrder.create({ data: { storeId: session.storeId, tableSessionId: sessionId, orderNumber } })
}

export async function createTestOrderItem(
  orderId: string,
  menuItemId: string,
  input: { quantity?: number; unitPrice?: string; status?: "AWAITING_KITCHEN" | "COOKING" | "READY" } = {},
) {
  const db = testPrisma()
  return db.mobileOrderItem.create({
    data: {
      mobileOrderId: orderId,
      menuItemId,
      quantity: input.quantity ?? 1,
      unitPrice: input.unitPrice ?? "80.00",
      status: input.status ?? "AWAITING_KITCHEN",
    },
  })
}

export async function createTestNotification(
  sessionId: string,
  input: { type?: "CALL_STAFF" | "CHECK_BILL"; reason?: string; status?: "PENDING" | "ACKNOWLEDGED" } = {},
) {
  const db = testPrisma()
  const session = await db.tableSession.findUniqueOrThrow({ where: { id: sessionId }, select: { storeId: true } })
  return db.notification.create({
    data: {
      storeId: session.storeId,
      tableSessionId: sessionId,
      type: input.type ?? "CALL_STAFF",
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.status === undefined ? {} : { status: input.status }),
    },
  })
}
