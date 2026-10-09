import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import { businessDayKey } from "@/lib/day"
import {
  createFullDayShifts,
  createTestOrder,
  createTestOrderItem,
  createTestQrCode,
  createTestSession,
  createTestTable,
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

/// ปิดยอดแล้วรับเงินไม่ได้จนกว่าจะ "เปิดรอบขายใหม่" (2026-10-08 เจ้าของสั่ง · 2026-10-09 ขยายเป็นขายไม่ได้เลย)
///
/// ล็อกรายคน · เฉพาะวันนี้ · เปิดรอบขายใหม่ไม่แตะรอบที่ปิดแล้ว · เปิดรอบเดิมกลับ (reopen) ก็ปลดล็อก
describe.skipIf(!dbReady)("ล็อกการรับเงินหลังปิดยอด", () => {
  let createTakeawaySale: typeof import("@/app/actions/staff-order")["createTakeawaySale"]
  let closeCashierDay: (formData: FormData) => Promise<ActionResult>
  let reopenCashierClosing: (formData: FormData) => Promise<ActionResult>
  let resumeSales: () => Promise<ActionResult>
  let getSalesLock: typeof import("@/lib/queries")["getSalesLock"]

  beforeAll(async () => {
    createTakeawaySale = (await import("@/app/actions/staff-order")).createTakeawaySale
    const closing = await import("@/app/actions/closing")
    closeCashierDay = closing.closeCashierDay
    reopenCashierClosing = closing.reopenCashierClosing
    resumeSales = closing.resumeSales
    getSalesLock = (await import("@/lib/queries")).getSalesLock
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestUser("owner2", "เจ้าของคนที่สอง", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ serviceChargePercent: "0.00" })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function sell() {
    const menu =
      (await testPrisma().menuItem.findFirst({ where: { storeId: TEST_STORE_ID } })) ??
      (await testPrisma().menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ข้าวผัด", price: "50.00" } }))
    const fd = new FormData()
    fd.set("items", JSON.stringify([{ menuItemId: menu.id, quantity: 1, optionIds: [] }]))
    fd.set("paymentMethod", "CASH")
    fd.set("amountReceived", "50")
    return createTakeawaySale(fd)
  }
  const close = () => closeCashierDay(makeFormData({ countedCash: 0, note: "" }))

  it("ปิดรอบแล้วขายไม่ได้ → เปิดรอบขายใหม่แล้วขายได้ → ปิดรอบ 2 แล้วล็อกอีก", async () => {
    expect((await sell()).ok).toBe(true)
    expect((await close()).ok).toBe(true)

    const blocked = await sell()
    expect(blocked.ok).toBe(false)
    expect(blocked.ok === false && blocked.error).toContain("เปิดรอบขายใหม่")
    expect(await getSalesLock(TEST_STORE_ID, "owner")).toMatchObject({ locked: true, roundNo: 1 })

    const resumed = await resumeSales()
    expect(resumed.ok).toBe(true)
    expect((await sell()).ok).toBe(true)
    // รอบที่ปิดแล้วไม่ถูกแตะ — ยังนับ 1 บิลเดิม
    const round1 = await testPrisma().cashierClosing.findFirstOrThrow({ where: { roundNo: 1 } })
    expect(round1.billCount).toBe(1)

    // กดซ้ำไม่พัง
    expect((await resumeSales()).ok).toBe(true)

    expect((await close()).ok).toBe(true)
    expect(await getSalesLock(TEST_STORE_ID, "owner")).toMatchObject({ locked: true, roundNo: 2 })
    expect((await sell()).ok).toBe(false)
  })

  it("ล็อกรายคน — อีกคนในร้านยังรับเงินได้", async () => {
    await close()
    expect((await sell()).ok).toBe(false)
    setTestUser("owner2")
    expect((await sell()).ok).toBe(true)
    expect((await getSalesLock(TEST_STORE_ID, "owner2")).locked).toBe(false)
  })

  it("ปิดรอบย้อนหลังไม่ล็อกการขายของวันนี้", async () => {
    const yesterday = businessDayKey(new Date(Date.now() - 24 * 60 * 60_000))
    expect((await closeCashierDay(makeFormData({ closingDate: yesterday, countedCash: 0, note: "" }))).ok).toBe(true)
    expect((await getSalesLock(TEST_STORE_ID, "owner")).locked).toBe(false)
    expect((await sell()).ok).toBe(true)
  })

  it("เปิดรอบเดิมกลับ (reopen) = ปลดล็อก เพราะไม่มีรอบที่ปิดอยู่แล้ว", async () => {
    await sell()
    await close()
    expect((await sell()).ok).toBe(false)
    const round = await testPrisma().cashierClosing.findFirstOrThrow({ where: { roundNo: 1 } })
    expect((await reopenCashierClosing(makeFormData({ id: round.id, reason: "ปิดผิด นับเงินใหม่" }))).ok).toBe(true)
    expect((await getSalesLock(TEST_STORE_ID, "owner")).locked).toBe(false)
    expect((await sell()).ok).toBe(true)
  })

  it("ปิดรอบแล้วขายใหม่ไม่ได้ทุกทาง: เปิดโต๊ะ · สั่งเข้าโต๊ะ · เช็กอิน (2026-10-09)", async () => {
    const { openTableSession } = await import("@/app/actions/tables")
    const { createStaffTableOrder } = await import("@/app/actions/staff-order")
    const { checkInBooking } = await import("@/app/actions/bookings")
    const table = await createTestTable("A1")
    const menu = await testPrisma().menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ข้าวผัด", price: "50.00" } })
    await close()

    const open = await openTableSession(makeFormData({ tableId: table.id }))
    expect(open.ok === false && open.error).toContain("ไม่สามารถขายได้")

    const fd = new FormData()
    fd.set("tableId", table.id)
    fd.set("items", JSON.stringify([{ menuItemId: menu.id, quantity: 1, optionIds: [] }]))
    const order = await createStaffTableOrder(fd)
    expect(order.ok === false && order.error).toContain("ไม่สามารถขายได้")

    // ด่านอยู่ก่อนอ่านการจอง — id อะไรก็ถูกปฏิเสธด้วยข้อความล็อก
    const checkIn = await checkInBooking(makeFormData({ id: "any-booking", tableId: table.id }))
    expect(checkIn.ok === false && checkIn.error).toContain("ไม่สามารถขายได้")

    expect(await testPrisma().tableSession.count({ where: { storeId: TEST_STORE_ID } })).toBe(0)
    expect(await testPrisma().mobileOrder.count({ where: { storeId: TEST_STORE_ID } })).toBe(0)

    // เปิดรอบขายใหม่แล้วเปิดโต๊ะได้
    expect((await resumeSales()).ok).toBe(true)
    expect((await openTableSession(makeFormData({ tableId: table.id }))).ok).toBe(true)
  })

  it("ปิดรอบแล้วยังทำงานของออร์เดอร์เดิม/จองล่วงหน้าได้ · ลูกค้าสแกน QR เปิดโต๊ะเองได้", async () => {
    const { startCookingItem, markItemReady, markItemServed } = await import("@/app/actions/orders")
    const { openTableSession } = await import("@/app/actions/tables")
    const { saveBooking } = await import("@/app/actions/bookings")
    const db = testPrisma()
    const table = await createTestTable("A1")
    const menu = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ข้าวผัด", price: "50.00" } })
    await setStoreSettings({ hasKDS: true })
    const session = await createTestSession(table.id)
    const order = await createTestOrder(session.id)
    const item = await createTestOrderItem(order.id, menu.id)
    await close()

    // ครัว/เสิร์ฟของออร์เดอร์ที่สั่งไว้แล้วไม่ติดล็อก
    expect((await startCookingItem(makeFormData({ id: item.id }))).ok).toBe(true)
    expect((await markItemReady(makeFormData({ id: item.id }))).ok).toBe(true)
    expect((await markItemServed(makeFormData({ id: item.id }))).ok).toBe(true)

    // ลูกค้าสแกน QR — ไม่ใช่พนักงานคนใด จึงไม่ติดล็อกรายคน
    const other = await createTestTable("A2")
    const qr = await createTestQrCode(other.id)
    expect((await openTableSession(makeFormData({ qrToken: qr.token }))).ok).toBe(true)

    // จองคิวล่วงหน้ายังได้ (ยังไม่ใช่การขาย)
    await db.storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true } })
    const station = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดไทย" } })
    const program = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60, stationId: station.id },
    })
    const therapist = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด", skills: { connect: [{ id: station.id }] } } })
    const tomorrow = businessDayKey(new Date(Date.now() + 24 * 60 * 60_000))
    await createFullDayShifts([therapist.id], [tomorrow])
    const booked = await saveBooking(
      makeFormData({
        customerName: "คุณเอ",
        customerPhone: "0812345678",
        menuItemId: program.id,
        therapistId: therapist.id,
        tableId: "",
        bookingDate: tomorrow,
        startTime: "13:00",
        note: "",
      }),
    )
    expect(booked.ok).toBe(true)
  })

  it("ยังไม่ได้ปิดยอดวันนี้ → เปิดรอบขายใหม่ไม่มีอะไรให้เปิด", async () => {
    const result = await resumeSales()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("ยังไม่ได้ปิดยอด")
  })
})
