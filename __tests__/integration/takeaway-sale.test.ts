import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { TakeawaySaleResult } from "@/app/actions/staff-order"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
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

/// ขายอาหารกลับบ้าน (Phase 17c) — รับเงินตอนสั่ง ออกบิล และเข้าครัวในทรานแซคชันเดียว
///
/// สิ่งที่ต้องจริงเสมอ: บิลกับออร์เดอร์ครัวเกิดพร้อมกันหรือไม่เกิดเลย · เลขบิลไม่ชนกันตอนขายพร้อมกัน ·
/// ไม่แตะสต็อกสินค้าคลัง · ไม่คิดค่าบริการ · เงินสดไม่พอไม่ผ่าน · void แล้วครัวหยุดทำ
describe.skipIf(!dbReady)("ขายอาหารกลับบ้าน (Phase 17c)", () => {
  let createTakeawaySale: (formData: FormData) => Promise<ActionResult<TakeawaySaleResult>>
  let voidSale: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    createTakeawaySale = (await import("@/app/actions/staff-order")).createTakeawaySale
    voidSale = (await import("@/app/actions/sales")).voidSale
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    // ค่าบริการ 10% — บิลกลับบ้านต้องไม่ถูกคิดค่าบริการแม้ร้านจะตั้งไว้
    await setStoreSettings({ hasKDS: true, serviceChargePercent: "10.00" })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function seedMenu() {
    return testPrisma().menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "ผัดไทยกลับบ้าน", price: "80.00" },
    })
  }

  function saleForm(menuItemId: string, input: Partial<{ quantity: number; paymentMethod: string; amountReceived: string; customerLabel: string }> = {}) {
    const fd = new FormData()
    fd.set("items", JSON.stringify([{ menuItemId, quantity: input.quantity ?? 1, optionIds: [] }]))
    fd.set("paymentMethod", input.paymentMethod ?? "CASH")
    fd.set("amountReceived", input.amountReceived ?? "100")
    if (input.customerLabel !== undefined) fd.set("customerLabel", input.customerLabel)
    return fd
  }

  it("รับเงินแล้วได้บิล + ออร์เดอร์ครัว ในทรานแซคชันเดียว และคิดเงินทอนถูกต้อง", async () => {
    const db = testPrisma()
    const menuItem = await seedMenu()

    const result = await createTakeawaySale(
      saleForm(menuItem.id, { quantity: 2, amountReceived: "200", customerLabel: "คุณเอ" }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const sale = await db.sale.findUniqueOrThrow({ where: { id: result.data!.receipt.id }, include: { items: true } })
    expect(sale.channel).toBe("TAKEAWAY")
    expect(sale.tableSessionId).toBeNull()
    // 80 × 2 = 160 — ไม่มีค่าบริการแม้ร้านตั้ง 10% ไว้
    expect(Number(sale.total)).toBe(160)
    expect(Number(sale.changeDue)).toBe(40)
    expect(sale.items).toHaveLength(1)
    expect(sale.items[0].menuItemId).toBe(menuItem.id)
    expect(sale.items[0].productId).toBeNull()

    const order = await db.mobileOrder.findUniqueOrThrow({
      where: { id: result.data!.orderId },
      include: { items: true },
    })
    expect(order.orderType).toBe("TAKEAWAY")
    expect(order.tableSessionId).toBeNull()
    expect(order.saleId).toBe(sale.id)
    expect(order.customerLabel).toBe("คุณเอ")
    expect(order.items[0].status).toBe("AWAITING_KITCHEN")
  })

  it("ออร์เดอร์กลับบ้านขึ้น KDS พร้อมป้าย \"กลับบ้าน #n\" (ไม่ต้องมีโต๊ะ)", async () => {
    const menuItem = await seedMenu()
    await createTakeawaySale(saleForm(menuItem.id, { customerLabel: "คุณบี" }))

    const tickets = await queries.listKitchenTickets(TEST_STORE_ID)

    expect(tickets).toHaveLength(1)
    expect(tickets[0].orderType).toBe("TAKEAWAY")
    expect(tickets[0].tableCode).toBe("กลับบ้าน #1 · คุณบี")

    const doc = await queries.getKitchenTicket(TEST_STORE_ID, tickets[0].orderId)
    expect(doc?.tableCode).toBe("กลับบ้าน #1 · คุณบี")
    expect(doc?.mergedTableCodes).toEqual([])
  })

  it("เลขคิวกลับบ้านเดินต่อภายในวันเดียวกัน", async () => {
    const menuItem = await seedMenu()

    const first = await createTakeawaySale(saleForm(menuItem.id))
    const second = await createTakeawaySale(saleForm(menuItem.id))

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.data?.orderNumber).toBe(1)
    expect(second.data?.orderNumber).toBe(2)
  })

  it("ขายพร้อมกัน 8 บิล ต้องได้เลขบิลครบ 8 ใบไม่ซ้ำกัน (กติกาเลขบิลใต้ advisory lock)", async () => {
    const db = testPrisma()
    const menuItem = await seedMenu()

    const results = await Promise.all(
      Array.from({ length: 8 }, () => createTakeawaySale(saleForm(menuItem.id))),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(8)
    const sales = await db.sale.findMany({ where: { channel: "TAKEAWAY" }, select: { saleNumber: true } })
    const numbers = sales.map((s) => s.saleNumber)
    expect(new Set(numbers).size).toBe(8)
    expect(await db.mobileOrder.count({ where: { orderType: "TAKEAWAY" } })).toBe(8)
  })

  it("ไม่แตะสต็อกสินค้าคลังเลย (เมนูอาหารไม่มีสต็อกในระบบ)", async () => {
    const db = testPrisma()
    const product = await createTestProduct({ quantity: 10 })
    const menuItem = await seedMenu()

    await createTakeawaySale(saleForm(menuItem.id, { quantity: 3 }))

    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(10)
    expect(await db.stockTransaction.count()).toBe(0)
  })

  it("เงินสดไม่พอ → ไม่ผ่าน และไม่มีบิล/ออร์เดอร์ค้างไว้", async () => {
    const db = testPrisma()
    const menuItem = await seedMenu()

    const result = await createTakeawaySale(saleForm(menuItem.id, { quantity: 2, amountReceived: "100" }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("เงินที่รับไม่พอ")
    expect(await db.sale.count()).toBe(0)
    expect(await db.mobileOrder.count()).toBe(0)
  })

  it("โอน/QR บังคับยอดตรงเสมอ ไม่เชื่อเงินที่รับจาก client", async () => {
    const db = testPrisma()
    const menuItem = await seedMenu()

    const result = await createTakeawaySale(
      saleForm(menuItem.id, { paymentMethod: "TRANSFER", amountReceived: "999" }),
    )

    expect(result.ok).toBe(true)
    const sale = await db.sale.findFirstOrThrow({ where: { channel: "TAKEAWAY" } })
    expect(Number(sale.amountReceived)).toBe(80)
    expect(Number(sale.changeDue)).toBe(0)
  })

  it("บิลกลับบ้านโผล่ในประวัติการขาย ปิดยอด และรายงาน เหมือนบิลอื่น", async () => {
    const menuItem = await seedMenu()
    await createTakeawaySale(saleForm(menuItem.id, { quantity: 2, amountReceived: "200" }))

    const [history, closing, report] = await Promise.all([
      queries.listSales(TEST_STORE_ID),
      queries.getTodaySalesSummary(TEST_STORE_ID, "owner"),
      queries.getSalesReport(TEST_STORE_ID),
    ])

    expect(history).toHaveLength(1)
    expect(history[0].channel).toBe("TAKEAWAY")
    expect(closing.totalSales).toBe(160)
    expect(closing.totalCash).toBe(160)
    expect(closing.billCount).toBe(1)
    expect(report.reduce((sum, row) => sum + row.total, 0)).toBe(160)
  })

  it("ยกเลิกบิลกลับบ้าน → รายการในครัวถูกยกเลิกตามไปด้วย และหลุดจาก KDS", async () => {
    const db = testPrisma()
    const menuItem = await seedMenu()
    const sold = await createTakeawaySale(saleForm(menuItem.id))
    expect(sold.ok).toBe(true)
    if (!sold.ok) return

    const voided = await voidSale(makeFormData({ id: sold.data!.receipt.id, reason: "ลูกค้าไม่มารับ" }))

    expect(voided.ok).toBe(true)
    const items = await db.mobileOrderItem.findMany({ where: { mobileOrderId: sold.data!.orderId } })
    expect(items.every((i) => i.status === "CANCELLED")).toBe(true)
    expect(items[0].cancelReason).toContain("ยกเลิกบิล")
    expect(await queries.listKitchenTickets(TEST_STORE_ID)).toHaveLength(0)
  })

  it("เมนูของร้านอื่นขายไม่ได้ (แยกข้อมูลตามร้าน)", async () => {
    const db = testPrisma()
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
    const otherMenu = await db.menuItem.create({
      data: { storeId: OTHER_STORE_ID, name: "เมนูร้านอื่น", price: "50.00" },
    })

    const result = await createTakeawaySale(saleForm(otherMenu.id))

    expect(result.ok).toBe(false)
    expect(await db.sale.count()).toBe(0)
  })

  it("แพ็กเกจหมดอายุ → ขายกลับบ้านไม่ได้", async () => {
    const menuItem = await seedMenu()
    await ensureTestStore({
      id: TEST_STORE_ID,
      plan: { tier: "S", tableLimit: 12, expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    })

    const result = await createTakeawaySale(saleForm(menuItem.id))

    expect(result.ok).toBe(false)
    expect(await testPrisma().sale.count()).toBe(0)
  })
})
