import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult, ReceiptData } from "@/lib/types"
import { businessDateOnly } from "@/lib/day"
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("Void บิลขาย — ยิงลง PostgreSQL จริง", () => {
  let createSale: (formData: FormData) => Promise<ActionResult<ReceiptData>>
  let voidSale: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const actions = await import("@/app/actions/sales")
    createSale = actions.createSale
    voidSale = actions.voidSale
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function sellOne(quantity = 3, stock = 10) {
    const product = await createTestProduct({ quantity: stock, price: "20.00" })
    const formData = new FormData()
    formData.set("items", JSON.stringify([{ productId: product.id, quantity }]))
    formData.set("discount", "0")
    formData.set("paymentMethod", "CASH")
    formData.set("amountReceived", "1000")
    const result = await createSale(formData)
    if (!result.ok || !result.data) throw new Error("เตรียมบิลสำหรับเทสไม่สำเร็จ")
    return { product, sale: result.data }
  }

  describe("Void บิลของวันเดียวกัน", () => {
    it("void สำเร็จต้องคืนสต็อกครบและสร้าง ledger IN ชดเชยโดยไม่แตะ OUT เดิม", async () => {
      // arrange
      const { product, sale } = await sellOne(3, 10)

      // act
      const result = await voidSale(makeFormData({ id: sale.id, reason: "ลูกค้าเปลี่ยนใจ" }))

      // assert
      expect(result.ok).toBe(true)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(10)

      const ledger = await testPrisma().stockTransaction.findMany({
        where: { saleId: sale.id },
        orderBy: { createdAt: "asc" },
      })
      expect(ledger).toHaveLength(2)
      expect(ledger.filter((t) => t.type === "OUT")).toHaveLength(1)
      expect(ledger.filter((t) => t.type === "IN")).toHaveLength(1)
      expect(ledger.find((t) => t.type === "IN")?.note).toBe(`ยกเลิกบิล ${sale.saleNumber}`)

      const voided = await testPrisma().sale.findUniqueOrThrow({ where: { id: sale.id } })
      expect(voided.status).toBe("VOIDED")
      expect(voided.voidReason).toBe("ลูกค้าเปลี่ยนใจ")
      expect(voided.voidedById).toBe("test-user")
      expect(voided.voidedAt).not.toBeNull()
    })

    it("void ซ้ำบิลเดิมต้องถูกปฏิเสธและสต็อกต้องไม่ถูกคืนสองรอบ", async () => {
      // arrange
      const { product, sale } = await sellOne(3, 10)
      await voidSale(makeFormData({ id: sale.id, reason: "รอบแรก" }))

      // act
      const second = await voidSale(makeFormData({ id: sale.id, reason: "รอบสอง" }))

      // assert
      expect(second.ok).toBe(false)
      expect(second.ok === false && second.error).toContain("ถูกยกเลิกไปแล้ว")

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(10)
    })

    it("กด void พร้อมกัน 5 ครั้งต้องสำเร็จแค่ครั้งเดียว (conditional update)", async () => {
      // arrange
      const { product, sale } = await sellOne(4, 10)

      // act
      const results = await Promise.all(
        Array.from({ length: 5 }, () => voidSale(makeFormData({ id: sale.id, reason: "ยิงพร้อมกัน" }))),
      )

      // assert
      expect(results.filter((r) => r.ok)).toHaveLength(1)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(10)

      const compensations = await testPrisma().stockTransaction.count({
        where: { saleId: sale.id, type: "IN" },
      })
      expect(compensations).toBe(1)
    })

    it("ไม่ระบุเหตุผลต้องถูกปฏิเสธด้วยข้อความภาษาไทย", async () => {
      // arrange
      const { sale } = await sellOne()

      // act
      const result = await voidSale(makeFormData({ id: sale.id, reason: "" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("กรุณาระบุเหตุผลที่ยกเลิกบิล")
    })

    it("บิลที่ไม่มีอยู่จริงต้องคืนข้อความไม่พบบิล ไม่ throw", async () => {
      // act
      const result = await voidSale(makeFormData({ id: "ไม่มีบิลนี้", reason: "ทดสอบ" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("ไม่พบบิลที่ต้องการยกเลิก")
    })
  })

  describe("ห้าม void ข้ามวัน (F6)", () => {
    it("บิลของเมื่อวานต้อง void ไม่ได้และสต็อกต้องไม่ถูกคืน", async () => {
      // arrange — ดันเวลาขายให้เป็นเมื่อวาน
      const { product, sale } = await sellOne(3, 10)
      await testPrisma().sale.update({
        where: { id: sale.id },
        data: { createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) },
      })

      // act
      const result = await voidSale(makeFormData({ id: sale.id, reason: "ข้ามวันแล้ว" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("วันเดียวกัน")

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(7)

      const still = await testPrisma().sale.findUniqueOrThrow({ where: { id: sale.id } })
      expect(still.status).toBe("COMPLETED")
    })
  })

  describe("ห้าม void หลังปิดยอดประจำวัน (F9)", () => {
    it("ปิดยอดของวันนี้แล้วต้อง void บิลของวันนี้ไม่ได้", async () => {
      // arrange
      const { product, sale } = await sellOne(3, 10)
      await testPrisma().cashierClosing.create({
        data: {
          storeId: TEST_STORE_ID,
          cashierId: "test-user",
          closingDate: businessDateOnly(),
          totalSales: "60.00",
          totalCash: "60.00",
          totalTransfer: "0.00",
          totalQR: "0.00",
          billCount: 1,
          voidedCount: 0,
          countedCash: "60.00",
          difference: "0.00",
        },
      })

      // act
      const result = await voidSale(makeFormData({ id: sale.id, reason: "ลืมยกเลิก" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ปิดยอดของวันนี้ไปแล้ว")

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(7)
    })
  })
})
