import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult, ReceiptData } from "@/lib/types"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("ปิดยอดประจำวัน — ยิงลง PostgreSQL จริง", () => {
  let createSale: (formData: FormData) => Promise<ActionResult<ReceiptData>>
  let voidSale: (formData: FormData) => Promise<ActionResult>
  let closeCashierDay: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const sales = await import("@/app/actions/sales")
    const closing = await import("@/app/actions/closing")
    createSale = sales.createSale
    voidSale = sales.voidSale
    closeCashierDay = closing.closeCashierDay
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function sell(productId: string, quantity: number, paymentMethod: string) {
    const formData = new FormData()
    formData.set("items", JSON.stringify([{ productId, quantity }]))
    formData.set("discount", "0")
    formData.set("paymentMethod", paymentMethod)
    formData.set("amountReceived", "100000")
    return createSale(formData)
  }

  it("ยอดสรุปต้องแยกตามวิธีชำระเงินถูกต้องและนับเฉพาะบิล COMPLETED", async () => {
    // arrange — ขาย 3 บิลคละวิธีชำระ แล้วยกเลิก 1 บิล
    const product = await createTestProduct({ quantity: 100, price: "100.00" })
    await sell(product.id, 2, "CASH") // 200 เงินสด
    await sell(product.id, 1, "TRANSFER") // 100 โอน
    await sell(product.id, 3, "QR") // 300 QR
    const toVoid = await sell(product.id, 5, "CASH") // 500 เงินสด แล้วยกเลิก
    if (toVoid.ok && toVoid.data) {
      await voidSale(makeFormData({ id: toVoid.data.id, reason: "ทดสอบ" }))
    }

    // act
    const result = await closeCashierDay(makeFormData({ countedCash: 200, note: "" }))

    // assert
    expect(result.ok).toBe(true)

    const closing = await testPrisma().cashierClosing.findFirstOrThrow()
    expect(Number(closing.totalSales)).toBe(600)
    expect(Number(closing.totalCash)).toBe(200)
    expect(Number(closing.totalTransfer)).toBe(100)
    expect(Number(closing.totalQR)).toBe(300)
    expect(closing.billCount).toBe(3)
    expect(closing.voidedCount).toBe(1)
    expect(Number(closing.difference)).toBe(0)
  })

  it("เงินสดที่นับได้ขาด/เกินต้องคำนวณส่วนต่างถูกต้อง", async () => {
    // arrange
    const product = await createTestProduct({ quantity: 100, price: "100.00" })
    await sell(product.id, 1, "CASH")

    // act — นับได้ 90 จากยอดจริง 100
    const result = await closeCashierDay(makeFormData({ countedCash: 90, note: "เงินขาด" }))

    // assert
    expect(result.ok).toBe(true)
    expect(result.ok === true && result.message).toContain("เงินขาด")

    const closing = await testPrisma().cashierClosing.findFirstOrThrow()
    expect(Number(closing.difference)).toBe(-10)
    expect(closing.note).toBe("เงินขาด")
  })

  it("ปิดยอดซ้ำวันเดิมต้องถูกปฏิเสธและมีบันทึกเดียวเท่านั้น", async () => {
    // arrange
    const product = await createTestProduct({ quantity: 100, price: "50.00" })
    await sell(product.id, 1, "CASH")
    await closeCashierDay(makeFormData({ countedCash: 50, note: "" }))

    // act
    const second = await closeCashierDay(makeFormData({ countedCash: 50, note: "" }))

    // assert
    expect(second.ok).toBe(false)
    expect(second.ok === false && second.error).toContain("ปิดยอดของวันนี้ไปแล้ว")
    expect(await testPrisma().cashierClosing.count()).toBe(1)
  })

  it("ปิดยอดพร้อมกันหลายคำขอต้องสำเร็จแค่ครั้งเดียว (unique cashierId+closingDate)", async () => {
    // arrange
    const product = await createTestProduct({ quantity: 100, price: "50.00" })
    await sell(product.id, 1, "CASH")

    // act
    const results = await Promise.all(
      Array.from({ length: 4 }, () => closeCashierDay(makeFormData({ countedCash: 50, note: "" }))),
    )

    // assert
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await testPrisma().cashierClosing.count()).toBe(1)
  })

  it("ยังไม่มีบิลเลยก็ปิดยอดได้ ยอดทุกช่องเป็น 0", async () => {
    // act
    const result = await closeCashierDay(makeFormData({ countedCash: 0, note: "" }))

    // assert
    expect(result.ok).toBe(true)

    const closing = await testPrisma().cashierClosing.findFirstOrThrow()
    expect(Number(closing.totalSales)).toBe(0)
    expect(closing.billCount).toBe(0)
  })
})
