import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { StaffOrderResult } from "@/app/actions/staff-order"
import { addDays, businessDayKey } from "@/lib/day"
import {
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  setStoreSettings,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// รายงานต่อพนักงานนวด (Phase 20c)
///
/// สิ่งที่ต้องพิสูจน์: ตัวเลขมาจาก `SaleItem.therapistId` ของบิลที่ปิดแล้วเท่านั้น · บิล void หายจากรายงาน ·
/// บรรทัดอาหารในบิลเดียวกันไม่ถูกนับ · นาทีรวมคูณกับ `MenuItem.durationMinutes` · ช่วงวันตัดตามเวลาไทย
describe.skipIf(!dbReady)("ร้านนวด — รายงานต่อพนักงานนวด (Phase 20c)", () => {
  let createStaffTableOrder: (formData: FormData) => Promise<ActionResult<StaffOrderResult>>
  let voidSale: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment

  const today = businessDayKey()
  const range = { from: addDays(today, -29), to: today }

  beforeAll(async () => {
    createStaffTableOrder = (await import("@/app/actions/staff-order")).createStaffTableOrder
    voidSale = (await import("@/app/actions/sales")).voidSale
    queries = await import("@/lib/queries")
    closeSessionWithPayment = (await import("@/lib/close-session")).closeSessionWithPayment
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: false })
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true } })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// โปรแกรมนวดไทย 60 นาที 300 บาท · นวดเท้า 30 นาที 200 บาท · น้ำขิง 40 บาท (อาหาร ไม่ควรถูกนับ)
  async function seedSpa() {
    const db = testPrisma()
    const thai = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดไทย" } })
    const thai60 = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60, stationId: thai.id },
    })
    const foot30 = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดเท้า 30", price: "200.00", itemType: "SERVICE", durationMinutes: 30 },
    })
    const drink = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "น้ำขิง", price: "40.00", itemType: "FOOD" } })
    const t1 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด", skills: { connect: [{ id: thai.id }] } } })
    const t2 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "002", name: "หน่อย", skills: { connect: [{ id: thai.id }] } } })
    const room = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/1", kind: "ROOM" } })
    const room2 = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/2", kind: "ROOM" } })
    return { thai, thai60, foot30, drink, t1, t2, room, room2 }
  }

  /// สั่ง → ปิดบิล ในห้องที่ระบุ แล้วคืน saleId
  async function sellAndClose(tableId: string, lines: { menuItemId: string; therapistId?: string; quantity?: number }[]) {
    const order = await createStaffTableOrder(
      makeFormData({
        tableId,
        items: JSON.stringify(
          lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity ?? 1, optionIds: [], therapistId: l.therapistId })),
        ),
      }),
    )
    expect(order.ok).toBe(true)
    const sessionId = order.ok ? order.data?.sessionId ?? "" : ""
    const closed = await closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId, paymentMethod: "CASH", cashierId: "owner" })
    expect(closed.ok).toBe(true)
    return closed.ok ? closed.saleId : ""
  }

  it("รวมยอด/ครั้ง/นาที ต่อคนถูกต้อง · อาหารในบิลเดียวกันไม่ถูกนับ · คนที่ไม่มีงานยังมีแถวยอด 0", async () => {
    const { thai60, foot30, drink, t1, t2, room, room2 } = await seedSpa()

    // 001: นวดไทย 60 (300) + น้ำขิงในบิลเดียวกัน · อีกบิลนวดเท้า 30 (200)
    await sellAndClose(room.id, [{ menuItemId: thai60.id, therapistId: t1.id }, { menuItemId: drink.id }])
    await sellAndClose(room.id, [{ menuItemId: foot30.id, therapistId: t1.id }])
    // 002: นวดไทย 60 คนละห้อง
    await sellAndClose(room2.id, [{ menuItemId: thai60.id, therapistId: t2.id }])

    const report = await queries.getTherapistSalesReport(TEST_STORE_ID, range)
    const first = report.find((r) => r.code === "001")
    const second = report.find((r) => r.code === "002")

    expect(first?.revenue).toBe(500)
    expect(first?.services).toBe(2)
    expect(first?.bills).toBe(2)
    expect(first?.minutes).toBe(90)
    expect(second?.revenue).toBe(300)
    expect(second?.minutes).toBe(60)

    // เรียงตามยอดมากไปน้อย · ยอดรวมของรายงานต้องไม่รวมน้ำขิง (40 บาท)
    expect(report.map((r) => r.code)).toEqual(["001", "002"])
    expect(report.reduce((sum, r) => sum + r.revenue, 0)).toBe(800)
  })

  it("พนักงานที่ยังไม่มีงานในช่วงนั้นมีแถวยอด 0 (ต้องเห็นว่าใครว่างงาน)", async () => {
    const { thai60, t1, room } = await seedSpa()
    await sellAndClose(room.id, [{ menuItemId: thai60.id, therapistId: t1.id }])

    const report = await queries.getTherapistSalesReport(TEST_STORE_ID, range)
    expect(report).toHaveLength(2)
    const idle = report.find((r) => r.code === "002")
    expect(idle?.revenue).toBe(0)
    expect(idle?.services).toBe(0)
    expect(idle?.bills).toBe(0)
    expect(idle?.minutes).toBe(0)
  })

  it("บิลที่ถูกยกเลิก (void) หายจากรายงานทันที", async () => {
    const { thai60, t1, room } = await seedSpa()
    const saleId = await sellAndClose(room.id, [{ menuItemId: thai60.id, therapistId: t1.id }])

    expect((await queries.getTherapistSalesReport(TEST_STORE_ID, range)).find((r) => r.code === "001")?.revenue).toBe(300)

    const voided = await voidSale(makeFormData({ id: saleId, reason: "ลูกค้าขอยกเลิก" }))
    expect(voided.ok).toBe(true)

    const after = await queries.getTherapistSalesReport(TEST_STORE_ID, range)
    expect(after.find((r) => r.code === "001")?.revenue).toBe(0)
    expect(after.find((r) => r.code === "001")?.services).toBe(0)
    expect(await queries.getTherapistHistory(TEST_STORE_ID, (await firstTherapistId()), range)).toHaveLength(0)
  })

  it("ช่วงวันตัดถูกต้อง — เลือกช่วงที่ไม่มีบิลต้องได้ 0", async () => {
    const { thai60, t1, room } = await seedSpa()
    await sellAndClose(room.id, [{ menuItemId: thai60.id, therapistId: t1.id }])

    const past = { from: addDays(today, -10), to: addDays(today, -5) }
    const report = await queries.getTherapistSalesReport(TEST_STORE_ID, past)
    expect(report.find((r) => r.code === "001")?.revenue).toBe(0)

    // ช่วงที่ครอบวันนี้ (from = to = วันนี้) ต้องเห็นบิล — ปลายช่วงต้องนับทั้งวัน ไม่ใช่ตัดที่เที่ยงคืนต้นวัน
    const onlyToday = await queries.getTherapistSalesReport(TEST_STORE_ID, { from: today, to: today })
    expect(onlyToday.find((r) => r.code === "001")?.revenue).toBe(300)
  })

  it("ประวัติรายคนแสดงรายการของคนนั้นเท่านั้น พร้อมเลขบิล ห้อง และนาที", async () => {
    const { thai60, foot30, drink, t1, t2, room, room2 } = await seedSpa()
    await sellAndClose(room.id, [{ menuItemId: thai60.id, therapistId: t1.id }, { menuItemId: drink.id }])
    await sellAndClose(room2.id, [{ menuItemId: foot30.id, therapistId: t2.id }])

    const history = await queries.getTherapistHistory(TEST_STORE_ID, t1.id, range)
    expect(history).toHaveLength(1)
    expect(history[0].menuItemName).toBe("นวดไทย 60")
    expect(history[0].minutes).toBe(60)
    expect(history[0].subtotal).toBe(300)
    expect(history[0].tableCode).toBe("3/1")
    expect(history[0].saleNumber).toMatch(/^INV-\d{6}$/)

    // ของอีกคนต้องไม่ปนกัน
    const otherHistory = await queries.getTherapistHistory(TEST_STORE_ID, t2.id, range)
    expect(otherHistory.map((h) => h.menuItemName)).toEqual(["นวดเท้า 30"])
  })

  it("getTherapistById อ่านได้เฉพาะพนักงานของร้านนี้", async () => {
    const { t1 } = await seedSpa()
    expect((await queries.getTherapistById(TEST_STORE_ID, t1.id))?.code).toBe("001")
    expect(await queries.getTherapistById(TEST_STORE_ID, "no-such-id")).toBeNull()
  })

  async function firstTherapistId(): Promise<string> {
    const row = await testPrisma().therapist.findFirstOrThrow({ where: { storeId: TEST_STORE_ID, code: "001" } })
    return row.id
  }
})
