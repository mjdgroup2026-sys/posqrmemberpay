import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { StaffOrderResult } from "@/app/actions/staff-order"
import {
  createTestTable,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  setStoreSettings,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// พนักงานกดขายอาหารเข้าโต๊ะจากจอขาย (Phase 17b)
///
/// สิ่งที่ต้องจริงเสมอ: โต๊ะว่างถูกเปิดให้เอง · สั่งซ้ำเข้าบิลเดิมไม่สร้าง session ใหม่ ·
/// โต๊ะที่ขอเช็กบิลแล้วสั่งเพิ่มไม่ได้ · ไม่มีสิทธิ์/แพ็กเกจหมดอายุทำไม่ได้ · ราคาคิดจากฐานไม่เชื่อ client
describe.skipIf(!dbReady)("พนักงานสั่งอาหารเข้าโต๊ะ (Phase 17b)", () => {
  let createStaffTableOrder: (formData: FormData) => Promise<ActionResult<StaffOrderResult>>
  let requestBill: (formData: FormData) => Promise<ActionResult<{ total: number }>>

  beforeAll(async () => {
    createStaffTableOrder = (await import("@/app/actions/staff-order")).createStaffTableOrder
    requestBill = (await import("@/app/actions/customer-order")).requestBill
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: true })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// เมนู 100 บาท + กลุ่มบังคับเลือก (0 บาท) + ท็อปปิ้งไม่บังคับ (+15)
  async function seedMenu() {
    const menuItem = await testPrisma().menuItem.create({
      data: {
        storeId: TEST_STORE_ID,
        name: "ข้าวกะเพราทดสอบ",
        price: "100.00",
        modifierGroups: {
          create: [
            {
              storeId: TEST_STORE_ID,
              name: "ระดับความเผ็ด",
              selectionType: "SINGLE",
              required: true,
              sortOrder: 1,
              options: { create: [{ name: "เผ็ดน้อย", priceDelta: "0.00", sortOrder: 1 }] },
            },
            {
              storeId: TEST_STORE_ID,
              name: "ท็อปปิ้งเพิ่ม",
              selectionType: "MULTIPLE",
              required: false,
              sortOrder: 2,
              options: { create: [{ name: "ไข่ดาว", priceDelta: "15.00", sortOrder: 1 }] },
            },
          ],
        },
      },
      include: { modifierGroups: { include: { options: true } } },
    })
    const spicy = menuItem.modifierGroups.find((g) => g.required)!
    const topping = menuItem.modifierGroups.find((g) => !g.required)!
    return { menuItem, spicyOptionId: spicy.options[0].id, toppingOptionId: topping.options[0].id }
  }

  function orderForm(tableId: string, items: unknown): FormData {
    const formData = new FormData()
    formData.set("tableId", tableId)
    formData.set("items", JSON.stringify(items))
    return formData
  }

  it("โต๊ะว่าง → เปิดโต๊ะให้อัตโนมัติ ออร์เดอร์เข้าครัว และราคาเป็น snapshot รวม modifier", async () => {
    const db = testPrisma()
    const table = await createTestTable("P1")
    const { menuItem, spicyOptionId, toppingOptionId } = await seedMenu()

    const result = await createStaffTableOrder(
      orderForm(table.id, [
        { menuItemId: menuItem.id, quantity: 2, optionIds: [spicyOptionId, toppingOptionId], note: "ไม่ใส่ผักชี" },
      ]),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.openedNewTable).toBe(true)
    expect(result.data?.orderNumber).toBe(1)
    // 100 + 15 = 115 ต่อจาน × 2
    expect(result.data?.total).toBe(230)

    const items = await db.mobileOrderItem.findMany({ where: { order: { tableSessionId: result.data!.sessionId } } })
    expect(items).toHaveLength(1)
    expect(Number(items[0].unitPrice)).toBe(115)
    expect(items[0].status).toBe("AWAITING_KITCHEN")
    expect(items[0].note).toBe("ไม่ใส่ผักชี")

    const after = await db.table.findUniqueOrThrow({ where: { id: table.id } })
    expect(after.status).toBe("ORDERED")
  })

  it("สั่งซ้ำที่โต๊ะเดิม → เข้าบิลเดิม ไม่เปิด session ใหม่ และเลขรอบเดินต่อ", async () => {
    const db = testPrisma()
    const table = await createTestTable("P2")
    const { menuItem, spicyOptionId } = await seedMenu()
    const line = [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]

    const first = await createStaffTableOrder(orderForm(table.id, line))
    const second = await createStaffTableOrder(orderForm(table.id, line))

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.data?.sessionId).toBe(first.data?.sessionId)
    expect(second.data?.openedNewTable).toBe(false)
    expect(second.data?.orderNumber).toBe(2)
    expect(await db.tableSession.count({ where: { tableId: table.id } })).toBe(1)
  })

  it("โต๊ะที่ลูกค้าขอเช็กบิลแล้ว สั่งเพิ่มไม่ได้ และไม่มีออร์เดอร์ใหม่เกิดขึ้น", async () => {
    const db = testPrisma()
    const table = await createTestTable("P3")
    const qr = await db.qRCode.create({
      data: { storeId: TEST_STORE_ID, tableId: table.id, token: `qr-${table.id}`, type: "STATIC", status: "ACTIVE" },
    })
    const { menuItem, spicyOptionId } = await seedMenu()
    const line = [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]

    const opened = await createStaffTableOrder(orderForm(table.id, line))
    expect(opened.ok).toBe(true)

    const billForm = new FormData()
    billForm.set("qrToken", qr.token)
    expect((await requestBill(billForm)).ok).toBe(true)

    const blocked = await createStaffTableOrder(orderForm(table.id, line))

    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error).toContain("เช็กบิล")
    expect(await db.mobileOrder.count({ where: { tableSessionId: opened.ok ? opened.data!.sessionId : "" } })).toBe(1)
  })

  it("เมนูที่ปิดขายอยู่ สั่งไม่ได้ และไม่เปิดโต๊ะค้างไว้เปล่า ๆ", async () => {
    const db = testPrisma()
    const table = await createTestTable("P4")
    const { menuItem, spicyOptionId } = await seedMenu()
    await db.menuItem.update({ where: { id: menuItem.id }, data: { isActive: false } })

    const result = await createStaffTableOrder(
      orderForm(table.id, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
    )

    expect(result.ok).toBe(false)
    // ทรานแซคชันเดียวกัน — เปิดโต๊ะไปแล้วต้องถูก rollback ไปด้วย
    expect(await db.tableSession.count()).toBe(0)
    expect((await db.table.findUniqueOrThrow({ where: { id: table.id } })).status).toBe("EMPTY")
  })

  it("กลุ่มตัวเลือกที่บังคับเลือกแต่ไม่ได้เลือก → ถูกปฏิเสธที่ server แม้ UI จะปล่อยผ่าน", async () => {
    const table = await createTestTable("P5")
    const { menuItem } = await seedMenu()

    const result = await createStaffTableOrder(
      orderForm(table.id, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [] }]),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ระดับความเผ็ด")
  })

  it("ยังไม่ล็อกอิน → สั่งไม่ได้", async () => {
    const table = await createTestTable("P6")
    const { menuItem, spicyOptionId } = await seedMenu()
    setTestUser(null)

    const result = await createStaffTableOrder(
      orderForm(table.id, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
    )

    expect(result.ok).toBe(false)
    expect(await testPrisma().mobileOrder.count()).toBe(0)
  })

  it("พนักงานที่ไม่มีสิทธิ์ MO_POS:ADD → ถูกปฏิเสธ", async () => {
    const db = testPrisma()
    const table = await createTestTable("P7")
    const { menuItem, spicyOptionId } = await seedMenu()

    // บทบาทที่ดูจอขายได้อย่างเดียว
    const role = await db.role.create({
      data: {
        storeId: TEST_STORE_ID,
        name: "ดูอย่างเดียว (เทส)",
        permissions: { create: [{ resource: "MO_POS", actions: ["VIEW"] }] },
      },
      select: { id: true },
    })
    await ensureTestUser("waiter", "พนักงาน", { storeId: TEST_STORE_ID, role: "STAFF" })
    await db.storeMember.update({
      where: { userId_storeId: { userId: "waiter", storeId: TEST_STORE_ID } },
      data: { roleId: role.id },
    })
    setTestUser("waiter")

    const result = await createStaffTableOrder(
      orderForm(table.id, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("สิทธิ์")
    expect(await db.mobileOrder.count()).toBe(0)
  })

  it("แพ็กเกจหมดอายุ → ขายใหม่ไม่ได้ (Phase 14b)", async () => {
    const table = await createTestTable("P8")
    const { menuItem, spicyOptionId } = await seedMenu()
    await ensureTestStore({
      id: TEST_STORE_ID,
      plan: { tier: "S", tableLimit: 12, expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    })

    const result = await createStaffTableOrder(
      orderForm(table.id, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("แพ็กเกจ")
    expect(await testPrisma().mobileOrder.count()).toBe(0)
  })

  it("โต๊ะที่ถูกรวมเข้าโต๊ะอื่น → ออร์เดอร์วิ่งเข้าบิลของโต๊ะหลัก", async () => {
    const db = testPrisma()
    const primary = await createTestTable("P9")
    const secondary = await createTestTable("P10")
    const { menuItem, spicyOptionId } = await seedMenu()
    const line = [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]

    const opened = await createStaffTableOrder(orderForm(primary.id, line))
    expect(opened.ok).toBe(true)
    await db.table.update({
      where: { id: secondary.id },
      data: { primaryTableId: primary.id, status: "OCCUPIED_MERGED" },
    })

    const merged = await createStaffTableOrder(orderForm(secondary.id, line))

    expect(merged.ok).toBe(true)
    if (!merged.ok || !opened.ok) return
    expect(merged.data?.sessionId).toBe(opened.data?.sessionId)
    expect(merged.data?.tableCode).toBe("P9")
  })
})
