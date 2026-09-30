import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { StoreModule } from "@/generated/prisma/client"
import {
  createTestMenuItem,
  createTestOrder,
  createTestOrderItem,
  createTestProduct,
  createTestQrCode,
  createTestTable,
  disconnectTestDb,
  ensureTestUser,
  giveFullPermissions,
  isTestDbReachable,
  resetDb,
  setStoreSettings,
  TEST_STORE_ID,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// โมดูลต่อร้าน (2026-09-30) — ผู้ดูแลแพลตฟอร์มปิดโมดูลรายร้าน · ด่านที่ permissionsFromContext() + getStoreSettings()
describe.skipIf(!dbReady)("โมดูลต่อร้าน", () => {
  let createCategory: (formData: FormData) => Promise<ActionResult>
  let createTakeawaySale: (formData: FormData) => Promise<ActionResult<unknown>>
  let closeCashierDay: (formData: FormData) => Promise<ActionResult>
  let updateStoreSettings: (formData: FormData) => Promise<ActionResult>
  let updateRole: (formData: FormData) => Promise<ActionResult>
  let registerMember: (formData: FormData) => Promise<ActionResult<unknown>>
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let confirmMobilePayment: (formData: FormData) => Promise<ActionResult<unknown>>
  let setStoreModules: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    createCategory = (await import("@/app/actions/categories")).createCategory
    createTakeawaySale = (await import("@/app/actions/staff-order")).createTakeawaySale
    closeCashierDay = (await import("@/app/actions/closing")).closeCashierDay
    updateStoreSettings = (await import("@/app/actions/settings")).updateStoreSettings
    updateRole = (await import("@/app/actions/roles")).updateRole
    registerMember = (await import("@/app/actions/members")).registerMember
    openTableSession = (await import("@/app/actions/tables")).openTableSession
    confirmMobilePayment = (await import("@/app/actions/payments")).confirmMobilePayment
    setStoreModules = (await import("@/app/actions/admin")).setStoreModules
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    await ensureTestUser("platform-admin", "ผู้ดูแลแพลตฟอร์ม", { storeId: null, isPlatformAdmin: true })
    setTestUser("test-user")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "0.00" })
  })

  afterAll(async () => {
    setTestUser("test-user")
    await disconnectTestDb()
  })

  /// ตั้งโมดูลผ่าน action จริงของผู้ดูแลแพลตฟอร์ม แล้วกลับมาเป็นเจ้าของร้าน
  async function disable(...modules: StoreModule[]) {
    setTestUser("platform-admin")
    try {
      const result = await setStoreModules(makeFormData({ storeId: TEST_STORE_ID, disabled: JSON.stringify(modules) }))
      expect(result.ok, JSON.stringify(result)).toBe(true)
    } finally {
      setTestUser("test-user")
    }
  }

  const settingsForm = (overrides: Record<string, string> = {}) =>
    makeFormData({ storeName: "ร้านทดสอบ", themeColor: "#E8571F", logoUrl: "", coverImageUrl: "", serviceChargePercent: "0", ...overrides })

  it("ปิดโมดูลคลัง → เจ้าของร้านก็จัดการหมวด/ขายสินค้าจากจอขายไม่ได้ · ขายอาหาร/ปิดยอดยังได้ · เปิดกลับแล้วทำได้", async () => {
    const product = await createTestProduct({ quantity: 10, category: "เครื่องดื่มขวด", price: "25.00" })
    await testPrisma().category.update({ where: { id: product.categoryId }, data: { sellableAtPos: true } })
    const sale = () =>
      createTakeawaySale(
        makeFormData({ items: "[]", products: JSON.stringify([{ productId: product.id, quantity: 1 }]), paymentMethod: "CASH", amountReceived: "100" }),
      )

    await disable("INVENTORY")
    const category = await createCategory(makeFormData({ name: "หมวดใหม่" }))
    expect(category.ok === false && category.error).toContain("ไม่มีสิทธิ์")
    const blocked = await sale()
    expect(blocked.ok === false && blocked.error).toContain("โมดูลคลังสินค้า")
    expect((await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(10)
    // แกนหลักไม่โดน
    expect((await closeCashierDay(makeFormData({ countedCash: "0" }))).ok).toBe(true)

    await disable()
    expect((await createCategory(makeFormData({ name: "หมวดใหม่" }))).ok).toBe(true)
    expect((await sale()).ok).toBe(true)
  })

  it("สิทธิ์ของเจ้าของร้านถูกตัดเฉพาะ resource ของโมดูลที่ปิด", async () => {
    await disable("INVENTORY", "REPORTS", "SPA")
    const { getCurrentPermissions } = await import("@/lib/permissions")
    const granted = (await getCurrentPermissions())?.granted ?? {}
    for (const gone of ["PRODUCTS", "CATEGORIES", "STOCK_IN", "STOCK_OUT", "STOCK_ADJUST", "POS", "REPORTS", "SPA_THERAPISTS", "SPA_BOOKINGS"]) {
      expect(granted[gone as keyof typeof granted], gone).toBeUndefined()
    }
    for (const kept of ["DASHBOARD", "MO_TABLES", "MO_POS", "POS_CLOSING", "POS_HISTORY", "USERS"]) {
      expect(granted[kept as keyof typeof granted], kept).toBeDefined()
    }
  })

  it("ปิดโมดูลสปา/สมาชิก → สวิตช์มีผลเป็นปิด แต่บันทึกตั้งค่าแล้วค่าที่ร้านตั้งไว้ไม่หาย · เปิดโมดูลกลับได้ค่าเดิม", async () => {
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true, crmEnabled: true } })
    await disable("SPA", "CRM")

    const effective = await queries.getStoreSettings(TEST_STORE_ID)
    expect(effective).toMatchObject({ spaEnabled: false, crmEnabled: false, modules: { spa: false, crm: false, inventory: true, reports: true } })

    // ฟอร์มซ่อนสวิตช์แล้วส่งค่า "ปิด" มา — ต้องไม่ทับค่าที่เก็บไว้
    expect((await updateStoreSettings(settingsForm({ storeName: "ชื่อใหม่", spaEnabled: "false", crmEnabled: "false" }))).ok).toBe(true)
    const stored = await testPrisma().storeSettings.findUniqueOrThrow({ where: { storeId: TEST_STORE_ID } })
    expect(stored).toMatchObject({ storeName: "ชื่อใหม่", spaEnabled: true, crmEnabled: true })

    await disable()
    expect(await queries.getStoreSettings(TEST_STORE_ID)).toMatchObject({ spaEnabled: true, crmEnabled: true })
  })

  it("ปิดโมดูลสมาชิก → ลูกค้าสมัครสมาชิกไม่ได้แม้ร้านเปิดสวิตช์ไว้", async () => {
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { crmEnabled: true } })
    const table = await createTestTable()
    const qr = await createTestQrCode(table.id, { type: "DYNAMIC" })
    const opened = await openTableSession(makeFormData({ qrToken: qr.token }))
    const sessionId = opened.ok ? (opened.data?.sessionId ?? "") : ""
    const menu = await createTestMenuItem({ name: "ข้าวผัด", price: "100.00" })
    const order = await createTestOrder(sessionId)
    await createTestOrderItem(order.id, menu.id, { quantity: 1, unitPrice: "100.00" })
    expect((await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))).ok).toBe(true)

    await disable("CRM")
    const refused = await registerMember(makeFormData({ qrToken: qr.token, phone: "0812345678" }))
    expect(refused.ok).toBe(false)
    expect(await testPrisma().member.count()).toBe(0)
  })

  it("บันทึกบทบาทตอนโมดูลปิด → สิทธิ์เดิมของโมดูลนั้นยังอยู่ (ไม่ถูกลบเพราะแถวถูกซ่อน)", async () => {
    await ensureTestUser("staff-m", "พนักงาน", { role: "STAFF" })
    const roleId = await giveFullPermissions("staff-m")
    await disable("INVENTORY")

    const role = await testPrisma().role.findUniqueOrThrow({ where: { id: roleId } })
    // หน้าจอส่งมาเฉพาะแถวที่มองเห็น (ไม่มี PRODUCTS) และลองแอบส่ง PRODUCTS มาด้วย — ต้องถูกทิ้ง
    const result = await updateRole(
      makeFormData({
        id: roleId,
        name: role.name,
        permissions: JSON.stringify([
          { resource: "USERS", actions: ["VIEW"] },
          { resource: "PRODUCTS", actions: [] },
        ]),
      }),
    )
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const rows = await testPrisma().rolePermission.findMany({ where: { roleId } })
    const byResource = Object.fromEntries(rows.map((r) => [r.resource, r.actions]))
    expect(byResource.PRODUCTS).toEqual(["VIEW", "ADD", "EDIT", "DELETE"])
    expect(byResource.STOCK_IN).toEqual(["VIEW", "ADD", "DELETE"])
    expect(byResource.USERS).toEqual(["VIEW"])
    expect(byResource.MO_TABLES).toBeUndefined()
  })

  it("ตั้งโมดูลได้เฉพาะผู้ดูแลแพลตฟอร์ม · ชื่อโมดูลผิดถูกปฏิเสธ", async () => {
    const byOwner = await setStoreModules(makeFormData({ storeId: TEST_STORE_ID, disabled: JSON.stringify(["INVENTORY"]) }))
    expect(byOwner.ok).toBe(false)

    setTestUser("platform-admin")
    try {
      expect((await setStoreModules(makeFormData({ storeId: TEST_STORE_ID, disabled: JSON.stringify(["POS"]) }))).ok).toBe(false)
      expect((await setStoreModules(makeFormData({ storeId: TEST_STORE_ID, disabled: "not-json" }))).ok).toBe(false)
    } finally {
      setTestUser("test-user")
    }
    expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).disabledModules).toEqual([])
  })
})
