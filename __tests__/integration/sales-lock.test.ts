import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import { businessDayKey } from "@/lib/day"
import { disconnectTestDb, ensureTestUser, isTestDbReachable, resetDb, setStoreSettings, testPrisma, TEST_STORE_ID } from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// ปิดยอดแล้วรับเงินไม่ได้จนกว่าจะ "เปิดรอบขายใหม่" (2026-10-08 เจ้าของสั่ง)
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

  it("ยังไม่ได้ปิดยอดวันนี้ → เปิดรอบขายใหม่ไม่มีอะไรให้เปิด", async () => {
    const result = await resumeSales()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("ยังไม่ได้ปิดยอด")
  })
})
