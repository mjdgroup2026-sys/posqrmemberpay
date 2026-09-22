import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestMenuItem,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// ประเภทครัว (Phase 19) — master data หลังครัว: unique ต่อร้าน · ผูกกับเมนู · ลบแล้วเมนูไม่หาย · คัดลอกข้ามสาขาติดไปด้วย
describe.skipIf(!dbReady)("ประเภทครัว (KitchenStation — Phase 19)", () => {
  let saveKitchenStation: (formData: FormData) => Promise<ActionResult>
  let deleteKitchenStation: (formData: FormData) => Promise<ActionResult>
  let saveMenuItem: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    const menu = await import("@/app/actions/menu")
    saveKitchenStation = menu.saveKitchenStation
    deleteKitchenStation = menu.deleteKitchenStation
    saveMenuItem = menu.saveMenuItem
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  it("เพิ่ม/แก้ชื่อ/ลำดับได้ และชื่อซ้ำในร้านเดียวกันถูกปฏิเสธเป็นภาษาไทย", async () => {
    expect((await saveKitchenStation(makeFormData({ name: "ของทอด", sortOrder: "1" }))).ok).toBe(true)
    expect((await saveKitchenStation(makeFormData({ name: "บาร์น้ำ", sortOrder: "0" }))).ok).toBe(true)

    const duplicate = await saveKitchenStation(makeFormData({ name: "ของทอด", sortOrder: "5" }))
    expect(duplicate.ok).toBe(false)
    expect(duplicate.ok === false && duplicate.error).toContain("อยู่แล้ว")

    const rows = await queries.listKitchenStations(TEST_STORE_ID)
    expect(rows.map((r) => r.name)).toEqual(["บาร์น้ำ", "ของทอด"]) // เรียงตาม sortOrder

    const renamed = await saveKitchenStation(makeFormData({ id: rows[1].id, name: "ของทอด/ย่าง", sortOrder: "0" }))
    expect(renamed.ok).toBe(true)
    expect((await testPrisma().kitchenStation.findUniqueOrThrow({ where: { id: rows[1].id } })).name).toBe("ของทอด/ย่าง")

    const empty = await saveKitchenStation(makeFormData({ name: "   ", sortOrder: "0" }))
    expect(empty.ok).toBe(false)
    expect(empty.ok === false && empty.error).toContain("กรุณากรอกชื่อประเภทครัว")
  })

  it("ชื่อเดียวกันคนละร้านอยู่ร่วมกันได้ (unique ต่อร้าน)", async () => {
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
    await testPrisma().kitchenStation.create({ data: { storeId: OTHER_STORE_ID, name: "ของทอด" } })
    expect((await saveKitchenStation(makeFormData({ name: "ของทอด", sortOrder: "0" }))).ok).toBe(true)
    expect(await testPrisma().kitchenStation.count({ where: { name: "ของทอด" } })).toBe(2)
  })

  it("ผูกเมนูกับประเภทครัวผ่าน saveMenuItem และอ่านกลับได้ทั้งหน้าจัดการ/จอขาย/นับเมนูต่อ station", async () => {
    await saveKitchenStation(makeFormData({ name: "ของผัด", sortOrder: "0" }))
    const [station] = await queries.listKitchenStations(TEST_STORE_ID)

    const created = await saveMenuItem(
      makeFormData({ name: "ผัดกะเพรา", price: "60", imageUrl: "", isActive: "true", modifierGroups: "[]", stationId: station.id }),
    )
    expect(created.ok).toBe(true)

    const managed = await queries.listMenuForManage(TEST_STORE_ID)
    expect(managed[0].stationId).toBe(station.id)
    expect(managed[0].stationName).toBe("ของผัด")

    const menu = await queries.listMenu(TEST_STORE_ID)
    expect(menu.all[0].stationName).toBe("ของผัด")

    expect((await queries.listKitchenStations(TEST_STORE_ID))[0].menuCount).toBe(1)

    // ถอดออกเป็น "ไม่ระบุ" ด้วยการส่งค่าว่าง
    const cleared = await saveMenuItem(
      makeFormData({ id: managed[0].id, name: "ผัดกะเพรา", price: "60", imageUrl: "", isActive: "true", modifierGroups: "[]", stationId: "" }),
    )
    expect(cleared.ok).toBe(true)
    expect((await testPrisma().menuItem.findUniqueOrThrow({ where: { id: managed[0].id } })).stationId).toBeNull()
  })

  it("stationId ที่ไม่มีอยู่จริงถูกปฏิเสธ (FK จากฟอร์ม) ไม่สร้างเมนู", async () => {
    const result = await saveMenuItem(
      makeFormData({ name: "เมนู", price: "10", imageUrl: "", isActive: "true", modifierGroups: "[]", stationId: "no-such-station" }),
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.fieldErrors?.stationId).toBeTruthy()
    expect(await testPrisma().menuItem.count()).toBe(0)
  })

  it("ลบประเภทครัวแล้ว เมนูที่ผูกอยู่กลับเป็น null ไม่หาย และ id ที่ไม่มี = ไม่พบ", async () => {
    await saveKitchenStation(makeFormData({ name: "ของหวาน", sortOrder: "0" }))
    const [station] = await queries.listKitchenStations(TEST_STORE_ID)
    const item = await createTestMenuItem({ name: "บัวลอย" })
    await testPrisma().menuItem.update({ where: { id: item.id }, data: { stationId: station.id } })

    expect((await deleteKitchenStation(makeFormData({ id: station.id }))).ok).toBe(true)
    const after = await testPrisma().menuItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.stationId).toBeNull()
    expect(after.name).toBe("บัวลอย")

    const missing = await deleteKitchenStation(makeFormData({ id: station.id }))
    expect(missing.ok).toBe(false)
  })

  it("ทิกเก็ตครัว/KDS พกประเภทครัวของแต่ละบรรทัดและลำดับ station ของร้าน", async () => {
    const db = testPrisma()
    const fried = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "ของทอด", sortOrder: 2 } })
    const drink = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "บาร์น้ำ", sortOrder: 1 } })
    const a = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ไก่ทอด", price: "70.00", stationId: fried.id } })
    const b = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ชาเย็น", price: "35.00", stationId: drink.id } })
    const c = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ข้าวเปล่า", price: "10.00" } })
    const table = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "K1", status: "ORDERED" } })
    const session = await db.tableSession.create({ data: { storeId: TEST_STORE_ID, tableId: table.id } })
    const order = await db.mobileOrder.create({ data: { storeId: TEST_STORE_ID, tableSessionId: session.id, orderNumber: 1 } })
    for (const m of [a, b, c]) {
      await db.mobileOrderItem.create({ data: { mobileOrderId: order.id, menuItemId: m.id, quantity: 1, unitPrice: m.price } })
    }

    const doc = await queries.getKitchenTicket(TEST_STORE_ID, order.id)
    expect(doc?.items.map((i) => i.stationName)).toEqual(["ของทอด", "บาร์น้ำ", null])
    expect(doc?.stationOrder.map((s) => s.id)).toEqual([drink.id, fried.id])

    const [ticket] = await queries.listKitchenTickets(TEST_STORE_ID)
    expect(ticket.items.map((i) => i.stationId)).toEqual([fried.id, drink.id, null])
  })

  it("KDS พกรายการที่ถูกยกเลิกของออร์เดอร์ที่ยังมีของค้าง แต่ไม่พก SERVED และไม่พกออร์เดอร์ที่จบแล้วทั้งใบ", async () => {
    const db = testPrisma()
    const m = await createTestMenuItem()
    const table = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "K2", status: "ORDERED" } })
    const session = await db.tableSession.create({ data: { storeId: TEST_STORE_ID, tableId: table.id } })
    const live = await db.mobileOrder.create({ data: { storeId: TEST_STORE_ID, tableSessionId: session.id, orderNumber: 1 } })
    await db.mobileOrderItem.create({ data: { mobileOrderId: live.id, menuItemId: m.id, quantity: 1, unitPrice: "80.00", status: "AWAITING_KITCHEN" } })
    await db.mobileOrderItem.create({ data: { mobileOrderId: live.id, menuItemId: m.id, quantity: 1, unitPrice: "80.00", status: "CANCELLED", cancelReason: "หมด" } })
    await db.mobileOrderItem.create({ data: { mobileOrderId: live.id, menuItemId: m.id, quantity: 1, unitPrice: "80.00", status: "SERVED" } })
    const done = await db.mobileOrder.create({ data: { storeId: TEST_STORE_ID, tableSessionId: session.id, orderNumber: 2 } })
    await db.mobileOrderItem.create({ data: { mobileOrderId: done.id, menuItemId: m.id, quantity: 1, unitPrice: "80.00", status: "CANCELLED" } })

    const tickets = await queries.listKitchenTickets(TEST_STORE_ID)
    expect(tickets.map((t) => t.orderId)).toEqual([live.id])
    expect(tickets[0].items.map((i) => i.status).sort()).toEqual(["AWAITING_KITCHEN", "CANCELLED"])
  })

  it("คัดลอกเมนูข้ามสาขาพาประเภทครัวไปด้วย และไม่สร้าง station ซ้ำเมื่อปลายทางมีชื่อเดียวกัน", async () => {
    const { copyMenu } = await import("@/lib/menu-copy")
    const db = testPrisma()
    await ensureTestStore({ id: OTHER_STORE_ID, name: "สาขา B" })
    const fried = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "ของทอด", sortOrder: 3 } })
    const drink = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "บาร์น้ำ", sortOrder: 1 } })
    const existingB = await db.kitchenStation.create({ data: { storeId: OTHER_STORE_ID, name: "บาร์น้ำ", sortOrder: 9 } })
    await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ไก่ทอด", price: "70.00", stationId: fried.id } })
    await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ชาเย็น", price: "35.00", stationId: drink.id } })
    await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ข้าวเปล่า", price: "10.00" } })

    const result = await db.$transaction((tx) => copyMenu(tx, TEST_STORE_ID, OTHER_STORE_ID))
    expect(result).toEqual({ copied: 3, skipped: 0 })

    const stationsB = await db.kitchenStation.findMany({ where: { storeId: OTHER_STORE_ID }, orderBy: { name: "asc" } })
    expect(stationsB.map((s) => s.name).sort()).toEqual(["ของทอด", "บาร์น้ำ"])
    // "บาร์น้ำ" ใช้แถวเดิมของ B (ไม่สร้างซ้ำ · ลำดับของ B คงเดิม)
    expect(stationsB.find((s) => s.name === "บาร์น้ำ")?.id).toBe(existingB.id)
    expect(stationsB.find((s) => s.name === "บาร์น้ำ")?.sortOrder).toBe(9)

    const menuB = await db.menuItem.findMany({ where: { storeId: OTHER_STORE_ID }, include: { station: true } })
    expect(menuB.find((m) => m.name === "ชาเย็น")?.station?.id).toBe(existingB.id)
    expect(menuB.find((m) => m.name === "ไก่ทอด")?.station?.name).toBe("ของทอด")
    expect(menuB.find((m) => m.name === "ข้าวเปล่า")?.stationId).toBeNull()
    // station ของ A ไม่ถูกแตะ / ไม่ถูกใช้ข้ามร้าน
    for (const m of menuB) expect([fried.id, drink.id]).not.toContain(m.stationId)
  })
})
