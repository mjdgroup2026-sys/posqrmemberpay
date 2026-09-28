import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { StaffOrderResult, TakeawaySaleResult } from "@/app/actions/staff-order"
import {
  createTestMenuItem,
  createTestProduct,
  createTestTable,
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

/// ขายสินค้าในสต็อกจากจอขายอาหาร (Phase 21b · F31)
///
/// ต้องจริงเสมอ: ขายได้เฉพาะหมวดที่เปิด "ขายที่หน้าขายอาหาร" (ตรวจที่ server) · ตัดสต็อกจริงผ่าน ledger ·
/// กันขายเกินแบบ concurrent (กติกาข้อ 4) · ยกเลิกรายการ/ยกเลิกโต๊ะ/void บิล = คืนสต็อก · สินค้าไม่เข้าครัว
describe.skipIf(!dbReady)("ขายสินค้าในสต็อกจากจอขายอาหาร (Phase 21b)", () => {
  let createStaffTableOrder: (formData: FormData) => Promise<ActionResult<StaffOrderResult>>
  let createTakeawaySale: (formData: FormData) => Promise<ActionResult<TakeawaySaleResult>>
  let cancelOrderItem: (formData: FormData) => Promise<ActionResult>
  let cancelTableSession: (formData: FormData) => Promise<ActionResult>
  let confirmMobilePayment: (formData: FormData) => Promise<ActionResult<{ saleNumber: string }>>
  let voidSale: (formData: FormData) => Promise<ActionResult>
  let setCategorySellable: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    const staff = await import("@/app/actions/staff-order")
    createStaffTableOrder = staff.createStaffTableOrder
    createTakeawaySale = staff.createTakeawaySale
    cancelOrderItem = (await import("@/app/actions/orders")).cancelOrderItem
    cancelTableSession = (await import("@/app/actions/tables")).cancelTableSession
    confirmMobilePayment = (await import("@/app/actions/payments")).confirmMobilePayment
    voidSale = (await import("@/app/actions/sales")).voidSale
    setCategorySellable = (await import("@/app/actions/categories")).setCategorySellable
    queries = await import("@/lib/queries")
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

  const qty = async (id: string) => (await testPrisma().product.findUniqueOrThrow({ where: { id } })).quantity

  /// สินค้าในหมวด "เครื่องดื่มขวด" ที่เปิดขายแล้ว · ราคา 25 บาท
  async function sellableProduct(quantity: number, name = "น้ำดื่มขวด") {
    const product = await createTestProduct({ quantity, name, category: "เครื่องดื่มขวด", price: "25.00" })
    await testPrisma().category.update({ where: { id: product.categoryId }, data: { sellableAtPos: true } })
    return product
  }

  function takeaway(products: { productId: string; quantity: number }[], items: unknown[] = []) {
    return makeFormData({
      items: JSON.stringify(items),
      products: JSON.stringify(products),
      paymentMethod: "CASH",
      amountReceived: "1000",
    })
  }

  function tableOrder(tableId: string, products: { productId: string; quantity: number }[], items: unknown[] = []) {
    return makeFormData({ tableId, items: JSON.stringify(items), products: JSON.stringify(products) })
  }

  describe("ขายกลับบ้าน (จ่ายตอนสั่ง)", () => {
    it("บิลมีแต่สินค้า: ตัดสต็อก · SaleItem = PRODUCT · ledger OUT ผูกบิล · ไม่มีออร์เดอร์ครัว", async () => {
      const water = await sellableProduct(10)

      const result = await createTakeawaySale(takeaway([{ productId: water.id, quantity: 3 }]))
      expect(result.ok).toBe(true)
      if (!result.ok || !result.data) return
      expect(result.data.orderId).toBeNull()
      expect(result.data.receipt.total).toBe(75)

      expect(await qty(water.id)).toBe(7)
      const sale = await testPrisma().sale.findUniqueOrThrow({ where: { id: result.data.receipt.id }, include: { items: true } })
      expect(sale.channel).toBe("TAKEAWAY")
      expect(sale.items).toHaveLength(1)
      expect(sale.items[0]).toMatchObject({ productId: water.id, kind: "PRODUCT", quantity: 3 })
      const ledger = await testPrisma().stockTransaction.findMany({ where: { productId: water.id } })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ type: "OUT", quantity: 3, saleId: sale.id })
      expect(await testPrisma().mobileOrder.count()).toBe(0)
    })

    it("อาหาร + สินค้าในบิลเดียว: อาหารเข้าครัว สินค้าตัดสต็อก ยอดรวมทั้งคู่", async () => {
      const water = await sellableProduct(5)
      const menu = await createTestMenuItem({ name: "ข้าวผัด", price: "60.00" })

      const result = await createTakeawaySale(
        takeaway([{ productId: water.id, quantity: 2 }], [{ menuItemId: menu.id, quantity: 1, optionIds: [] }]),
      )
      expect(result.ok).toBe(true)
      if (!result.ok || !result.data) return
      expect(result.data.receipt.total).toBe(110)
      expect(result.data.orderId).not.toBeNull()
      const orderItems = await testPrisma().mobileOrderItem.findMany({ where: { mobileOrderId: result.data.orderId! } })
      expect(orderItems.map((i) => i.menuItemId)).toEqual([menu.id])
      expect(await qty(water.id)).toBe(3)
    })

    it("void บิลกลับบ้านคืนสต็อกสินค้า", async () => {
      const water = await sellableProduct(4)
      const sold = await createTakeawaySale(takeaway([{ productId: water.id, quantity: 4 }]))
      if (!sold.ok || !sold.data) throw new Error("ขายไม่สำเร็จ")
      expect(await qty(water.id)).toBe(0)

      const voided = await voidSale(makeFormData({ id: sold.data.receipt.id, reason: "ลูกค้าเปลี่ยนใจ" }))
      expect(voided.ok).toBe(true)
      expect(await qty(water.id)).toBe(4)
    })

    it("★ กติกาข้อ 4: ขายพร้อมกัน 10 บิล บิลละ 2 จากสต็อก 8 ผ่านแค่ 4 ยอดไม่ติดลบ", async () => {
      const water = await sellableProduct(8)
      const results = await Promise.all(
        Array.from({ length: 10 }, () => createTakeawaySale(takeaway([{ productId: water.id, quantity: 2 }]))),
      )
      expect(results.filter((r) => r.ok)).toHaveLength(4)
      expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error.includes("ไม่พอ"))).toBe(true)
      expect(await qty(water.id)).toBe(0)
      expect(await testPrisma().sale.count()).toBe(4)
    })
  })

  describe("ขายได้เฉพาะหมวดที่เปิดขาย (ตรวจที่ server)", () => {
    it("หมวดที่ไม่ได้เปิด = ปฏิเสธ ไม่ตัดสต็อก ไม่ออกบิล · เปิดด้วย setCategorySellable แล้วขายได้", async () => {
      const soap = await createTestProduct({ quantity: 5, name: "สบู่", category: "ของใช้หลังร้าน" })

      const blocked = await createTakeawaySale(takeaway([{ productId: soap.id, quantity: 1 }]))
      expect(blocked.ok === false && blocked.error).toBe("สบู่ อยู่ในหมวดที่ไม่ได้เปิดขายที่หน้าขายอาหาร")
      expect(await qty(soap.id)).toBe(5)
      expect(await testPrisma().sale.count()).toBe(0)

      const opened = await setCategorySellable(makeFormData({ id: soap.categoryId, sellable: "true" }))
      expect(opened.ok).toBe(true)
      expect((await queries.listPosProducts(TEST_STORE_ID)).map((p) => p.id)).toEqual([soap.id])

      const sold = await createTakeawaySale(takeaway([{ productId: soap.id, quantity: 1 }]))
      expect(sold.ok).toBe(true)
      expect(await qty(soap.id)).toBe(4)
    })
  })

  it("กติกาข้อ 5: productId ของร้านอื่น (แม้หมวดเปิดขาย) ขายไม่ได้ทั้งกลับบ้านและเข้าโต๊ะ ยอดร้านนั้นไม่ขยับ", async () => {
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
    const foreign = await createTestProduct({ storeId: OTHER_STORE_ID, quantity: 9, category: "เครื่องดื่มร้าน B" })
    await testPrisma().category.update({ where: { id: foreign.categoryId }, data: { sellableAtPos: true } })
    const table = await createTestTable()

    const takeawayResult = await createTakeawaySale(takeaway([{ productId: foreign.id, quantity: 1 }]))
    const tableResult = await createStaffTableOrder(tableOrder(table.id, [{ productId: foreign.id, quantity: 1 }]))
    expect(takeawayResult.ok).toBe(false)
    expect(tableResult.ok).toBe(false)
    expect(await qty(foreign.id)).toBe(9)
    expect(await testPrisma().stockTransaction.count()).toBe(0)
  })

  describe("ขายเข้าโต๊ะ (ปิดบิลทีหลัง)", () => {
    it("ตัดสต็อกตอนส่ง · บรรทัดสินค้า SERVED ไม่ขึ้น KDS · ปิดบิลได้ SaleItem PRODUCT · void คืนสต็อก", async () => {
      const water = await sellableProduct(10)
      const table = await createTestTable()

      const sent = await createStaffTableOrder(tableOrder(table.id, [{ productId: water.id, quantity: 2 }]))
      expect(sent.ok).toBe(true)
      if (!sent.ok || !sent.data) return
      expect(await qty(water.id)).toBe(8)

      const line = await testPrisma().mobileOrderItem.findFirstOrThrow({ where: { productId: water.id } })
      expect(line.status).toBe("SERVED")
      expect(line.menuItemId).toBeNull()
      const ledger = await testPrisma().stockTransaction.findFirstOrThrow({ where: { orderItemId: line.id } })
      expect(ledger).toMatchObject({ type: "OUT", quantity: 2 })

      // สินค้าไม่เข้าครัว
      expect(await queries.listKitchenTickets(TEST_STORE_ID)).toHaveLength(0)
      // หน้าโต๊ะเห็นเป็นบรรทัดสินค้า
      const detail = await queries.getTableDetail(TEST_STORE_ID, table.id)
      expect(detail?.orders[0].items[0]).toMatchObject({ itemType: "PRODUCT", menuItemName: "น้ำดื่มขวด", subtotal: 50 })

      const closed = await confirmMobilePayment(makeFormData({ sessionId: sent.data.sessionId, paymentMethod: "CASH", amountReceived: "50" }))
      expect(closed.ok).toBe(true)
      const sale = await testPrisma().sale.findFirstOrThrow({ where: { tableSessionId: sent.data.sessionId }, include: { items: true } })
      expect(sale.items[0]).toMatchObject({ productId: water.id, kind: "PRODUCT", quantity: 2 })
      // ปิดบิลไม่ตัดซ้ำ
      expect(await qty(water.id)).toBe(8)

      const voided = await voidSale(makeFormData({ id: sale.id, reason: "ปิดบิลผิดโต๊ะ" }))
      expect(voided.ok).toBe(true)
      expect(await qty(water.id)).toBe(10)
    })

    it("ยกเลิกรายการสินค้าบนโต๊ะคืนสต็อก · ยกเลิกซ้ำไม่คืนซ้ำ", async () => {
      const water = await sellableProduct(6)
      const table = await createTestTable()
      await createStaffTableOrder(tableOrder(table.id, [{ productId: water.id, quantity: 3 }]))
      const line = await testPrisma().mobileOrderItem.findFirstOrThrow({ where: { productId: water.id } })

      const first = await cancelOrderItem(makeFormData({ id: line.id, reason: "ลูกค้าไม่เอา" }))
      expect(first.ok).toBe(true)
      expect(await qty(water.id)).toBe(6)

      const again = await cancelOrderItem(makeFormData({ id: line.id, reason: "กดซ้ำ" }))
      expect(again.ok).toBe(false)
      expect(await qty(water.id)).toBe(6)
    })

    it("ยกเลิกโต๊ะทั้งโต๊ะคืนสต็อกสินค้าทุกบรรทัด", async () => {
      const water = await sellableProduct(5)
      const snack = await sellableProduct(5, "ขนมถุง")
      const table = await createTestTable()
      const sent = await createStaffTableOrder(
        tableOrder(table.id, [
          { productId: water.id, quantity: 2 },
          { productId: snack.id, quantity: 1 },
        ]),
      )
      if (!sent.ok || !sent.data) throw new Error("ส่งไม่สำเร็จ")
      expect(await qty(water.id)).toBe(3)

      const cancelled = await cancelTableSession(makeFormData({ sessionId: sent.data.sessionId, reason: "เปิดโต๊ะผิด" }))
      expect(cancelled.ok).toBe(true)
      expect(await qty(water.id)).toBe(5)
      expect(await qty(snack.id)).toBe(5)
    })

    it("สต็อกไม่พอ = ไม่เปิดโต๊ะ/ไม่สร้างออร์เดอร์ (rollback ทั้งรายการ)", async () => {
      const water = await sellableProduct(1)
      const table = await createTestTable()
      const result = await createStaffTableOrder(tableOrder(table.id, [{ productId: water.id, quantity: 2 }]))
      expect(result.ok === false && result.error).toContain("ไม่พอ")
      expect(await qty(water.id)).toBe(1)
      expect(await testPrisma().mobileOrder.count()).toBe(0)
      expect(await testPrisma().tableSession.count()).toBe(0)
    })
  })
})
