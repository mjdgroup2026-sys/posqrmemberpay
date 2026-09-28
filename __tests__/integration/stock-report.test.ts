import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { TakeawaySaleResult } from "@/app/actions/staff-order"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"
import { businessDayKey } from "@/lib/day"
import { buildStockSalesCsv } from "@/lib/sales-csv"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// รายงานสต็อก (Phase 21c · F32–F33) — ตัวเลขต้องมาจาก ledger ตามที่มาจริง (ขาย/รับ/เบิก/ปรับ) และหักคืนจาก void แล้ว
describe.skipIf(!dbReady)("รายงานขายตัดสต็อก + สินค้าต้องสั่งซื้อ (Phase 21c)", () => {
  let docs: typeof import("@/app/actions/stock-docs")
  let createTakeawaySale: (formData: FormData) => Promise<ActionResult<TakeawaySaleResult>>
  let voidSale: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    docs = await import("@/app/actions/stock-docs")
    createTakeawaySale = (await import("@/app/actions/staff-order")).createTakeawaySale
    voidSale = (await import("@/app/actions/sales")).voidSale
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const today = () => businessDayKey()

  async function sellable(quantity: number, reorderPoint = 0, name = "น้ำอัดลม") {
    const product = await createTestProduct({ quantity, reorderPoint, name, category: "เครื่องดื่ม", price: "20.00" })
    await testPrisma().category.update({ where: { id: product.categoryId }, data: { sellableAtPos: true } })
    return product
  }

  function sell(productId: string, quantity: number) {
    return createTakeawaySale(
      makeFormData({ items: "[]", products: JSON.stringify([{ productId, quantity }]), paymentMethod: "CASH", amountReceived: "5000" }),
    )
  }

  it("แยกที่มา ขาย/รับ/เบิก/ปรับ ถูกต้อง · ขายสุทธิหักบิลที่ void · ยอดเงินเฉพาะบิลที่ยังไม่ยกเลิก", async () => {
    const soda = await sellable(0)

    await docs.createStockReceipt(makeFormData({ docDate: today(), lines: JSON.stringify([{ productId: soda.id, quantity: 20, unitCost: "12" }]) }))
    await docs.createStockIssue(makeFormData({ docDate: today(), requesterName: "ครัว", lines: JSON.stringify([{ productId: soda.id, quantity: 2 }]) }))
    const first = await sell(soda.id, 5)
    const second = await sell(soda.id, 3)
    expect(first.ok && second.ok).toBe(true)
    if (!second.ok || !second.data) return
    await voidSale(makeFormData({ id: second.data.receipt.id, reason: "ยกเลิก" }))
    // ในระบบเหลือ 20 − 2 − 5 = 13 · นับได้ 12 → ปรับ −1
    await docs.createStockAdjustment(makeFormData({ docDate: today(), reason: "นับ", lines: JSON.stringify([{ productId: soda.id, countedQty: 12 }]) }))

    const report = await queries.getStockSalesReport(TEST_STORE_ID, { from: today(), to: today() })
    expect(report.totals).toHaveLength(1)
    expect(report.totals[0]).toMatchObject({
      productId: soda.id,
      soldQty: 5,
      soldAmount: 100,
      receivedQty: 20,
      issuedQty: 2,
      adjustedQty: -1,
      otherQty: 0,
      onHand: 12,
    })
    expect(report.days.map((d) => d.day)).toEqual([today()])
    expect(report.soldQty).toBe(5)
    expect(report.soldAmount).toBe(100)

    const csv = buildStockSalesCsv(report)
    expect(csv.startsWith("﻿")).toBe(true)
    expect(csv).toContain(`${today()},${soda.sku},น้ำอัดลม,ขวด,5,100.00,20,2,-1,0`)
  })

  it("สินค้าต้องสั่งซื้อ: เฉพาะที่ถึงจุดสั่งซื้อ · ขายเฉลี่ย 30 วัน · จำนวนแนะนำ · ผู้ขาย/ทุนจากใบรับล่าสุดที่ไม่ถูกยกเลิก", async () => {
    const soda = await sellable(0, 10)
    const fine = await sellable(100, 5, "ของยังเยอะ")

    await docs.createStockReceipt(
      makeFormData({ docDate: today(), supplierName: "ร้านส่งเก่า", lines: JSON.stringify([{ productId: soda.id, quantity: 40, unitCost: "10" }]) }),
    )
    const latest = await docs.createStockReceipt(
      makeFormData({ docDate: today(), supplierName: "ร้านส่งใหม่", lines: JSON.stringify([{ productId: soda.id, quantity: 20, unitCost: "11" }]) }),
    )
    const voided = await docs.createStockReceipt(
      makeFormData({ docDate: today(), supplierName: "ใบที่ยกเลิก", lines: JSON.stringify([{ productId: soda.id, quantity: 1, unitCost: "99" }]) }),
    )
    if (!voided.ok || !voided.data || !latest.ok) throw new Error("สร้างใบรับไม่สำเร็จ")
    await docs.voidStockDoc(makeFormData({ id: voided.data.id, reason: "ผิด" }))
    // ขาย 51 จาก 60 → เหลือ 9 ≤ จุดสั่งซื้อ 10 · เฉลี่ย 51/30 = 1.7/วัน
    const sold = await sell(soda.id, 51)
    expect(sold.ok ? "ok" : sold.error).toBe("ok")

    const { rows, lookbackDays } = await queries.getReorderReport(TEST_STORE_ID)
    expect(lookbackDays).toBe(30)
    expect(rows.map((r) => r.productId)).toEqual([soda.id])
    expect(rows.some((r) => r.productId === fine.id)).toBe(false)
    const row = rows[0]
    expect(row.quantity).toBe(9)
    expect(row.avgDailySold).toBe(1.7)
    expect(row.daysLeft).toBe(5)
    // เป้า = 10 + ceil(1.7 × 14 = 23.8) = 34 → สั่ง 34 − 9 = 25
    expect(row.suggestedQty).toBe(25)
    expect(row.lastSupplier).toBe("ร้านส่งใหม่")
    expect(row.lastUnitCost).toBe(11)
    expect(row.estimatedCost).toBe(275)
  })
})
