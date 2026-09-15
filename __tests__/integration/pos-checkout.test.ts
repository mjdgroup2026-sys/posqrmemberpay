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

/// integration test ใช้ DB จริง — mock แค่ next/cache กับ session เท่านั้น
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

type CartLine = { productId: string; quantity: number }

function checkoutForm(input: {
  items: CartLine[]
  discount?: number
  paymentMethod?: string
  amountReceived?: number
  note?: string
}): FormData {
  const formData = new FormData()
  formData.set("items", JSON.stringify(input.items))
  formData.set("discount", String(input.discount ?? 0))
  formData.set("paymentMethod", input.paymentMethod ?? "CASH")
  formData.set("amountReceived", String(input.amountReceived ?? 999_999))
  if (input.note !== undefined) formData.set("note", input.note)
  return formData
}

describe.skipIf(!dbReady)("POS Checkout — ยิงลง PostgreSQL จริง", () => {
  let createSale: (formData: FormData) => Promise<ActionResult<ReceiptData>>

  beforeAll(async () => {
    const actions = await import("@/app/actions/sales")
    createSale = actions.createSale
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  describe("ขายในวงเงินสต็อกที่มี", () => {
    it("ขายสำเร็จต้องตัดสต็อก สร้าง SaleItem และ ledger OUT ที่ผูกกับบิล", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, price: "25.00", unit: "ขวด" })

      // act
      const result = await createSale(
        checkoutForm({ items: [{ productId: product.id, quantity: 3 }], amountReceived: 100 }),
      )

      // assert
      expect(result.ok).toBe(true)
      const receipt = result.ok ? result.data : undefined
      expect(receipt?.saleNumber).toBe("INV-000001")
      expect(receipt?.total).toBe(75)
      expect(receipt?.changeDue).toBe(25)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(7)

      const sale = await testPrisma().sale.findFirstOrThrow({ include: { items: true } })
      expect(sale.items).toHaveLength(1)
      expect(sale.items[0].quantity).toBe(3)
      expect(Number(sale.total)).toBe(75)

      const ledger = await testPrisma().stockTransaction.findMany({ where: { saleId: sale.id } })
      expect(ledger).toHaveLength(1)
      expect(ledger[0].type).toBe("OUT")
      expect(ledger[0].note).toBe(`ขายหน้าร้าน ${sale.saleNumber}`)
    })

    it("ราคาใน SaleItem เป็น snapshot — แก้ราคาสินค้าทีหลังแล้วบิลเก่าต้องไม่เปลี่ยน", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, price: "25.00" })
      await createSale(checkoutForm({ items: [{ productId: product.id, quantity: 2 }] }))

      // act — ขึ้นราคาหลังขายไปแล้ว
      await testPrisma().product.update({ where: { id: product.id }, data: { price: "99.00" } })

      // assert
      const item = await testPrisma().saleItem.findFirstOrThrow()
      expect(Number(item.unitPrice)).toBe(25)
      expect(Number(item.subtotal)).toBe(50)
    })

    it("ส่วนลดท้ายบิลต้องถูกหักออกจากยอดสุทธิ", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, price: "100.00" })

      // act
      const result = await createSale(
        checkoutForm({ items: [{ productId: product.id, quantity: 2 }], discount: 30, amountReceived: 200 }),
      )

      // assert
      expect(result.ok).toBe(true)
      const sale = await testPrisma().sale.findFirstOrThrow()
      expect(Number(sale.subtotal)).toBe(200)
      expect(Number(sale.discount)).toBe(30)
      expect(Number(sale.total)).toBe(170)
      expect(Number(sale.changeDue)).toBe(30)
    })

    it("ชำระแบบโอน/QR ต้องบังคับ amountReceived = total และเงินทอน 0 แม้ client ส่งค่าเกินมา", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, price: "50.00" })

      // act — ส่ง amountReceived เกินยอดมาโดยตั้งใจ
      const result = await createSale(
        checkoutForm({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "TRANSFER",
          amountReceived: 5_000,
        }),
      )

      // assert
      expect(result.ok).toBe(true)
      const sale = await testPrisma().sale.findFirstOrThrow()
      expect(Number(sale.amountReceived)).toBe(50)
      expect(Number(sale.changeDue)).toBe(0)
    })

    it("สินค้าเดียวกันหลายบรรทัดต้องถูกรวมเป็นบรรทัดเดียวและตัดสต็อกรวมครั้งเดียว", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, price: "10.00" })

      // act
      const result = await createSale(
        checkoutForm({
          items: [
            { productId: product.id, quantity: 2 },
            { productId: product.id, quantity: 3 },
          ],
        }),
      )

      // assert
      expect(result.ok).toBe(true)
      const items = await testPrisma().saleItem.findMany()
      expect(items).toHaveLength(1)
      expect(items[0].quantity).toBe(5)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(5)
    })
  })

  describe("กันขายเกินสต็อก (F5)", () => {
    it("บรรทัดใดเกินสต็อกต้องปฏิเสธทั้งบิล ไม่ตัดสต็อกบางส่วน", async () => {
      // arrange — บรรทัดแรกพอ บรรทัดที่สองไม่พอ
      const enough = await createTestProduct({ quantity: 10, name: "ของพอขาย", price: "10.00" })
      const short = await createTestProduct({ quantity: 1, name: "ของไม่พอ", unit: "ชิ้น", price: "10.00" })

      // act
      const result = await createSale(
        checkoutForm({
          items: [
            { productId: enough.id, quantity: 5 },
            { productId: short.id, quantity: 3 },
          ],
        }),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ของไม่พอ")

      const afterEnough = await testPrisma().product.findUniqueOrThrow({ where: { id: enough.id } })
      const afterShort = await testPrisma().product.findUniqueOrThrow({ where: { id: short.id } })
      expect(afterEnough.quantity).toBe(10)
      expect(afterShort.quantity).toBe(1)

      expect(await testPrisma().sale.count()).toBe(0)
      expect(await testPrisma().saleItem.count()).toBe(0)
      expect(await testPrisma().stockTransaction.count()).toBe(0)
    })

    it("ส่วนลดเกินยอดรวมต้องถูกปฏิเสธและไม่มีบิลเกิดขึ้น", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, price: "10.00" })

      // act
      const result = await createSale(
        checkoutForm({ items: [{ productId: product.id, quantity: 1 }], discount: 999 }),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.fieldErrors?.discount).toBeDefined()
      expect(await testPrisma().sale.count()).toBe(0)
    })

    it("เงินสดที่รับน้อยกว่ายอดสุทธิต้องถูกปฏิเสธ", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, price: "100.00" })

      // act
      const result = await createSale(
        checkoutForm({ items: [{ productId: product.id, quantity: 2 }], amountReceived: 150 }),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.fieldErrors?.amountReceived).toBeDefined()
      expect(await testPrisma().sale.count()).toBe(0)
    })

    it("ตะกร้าว่างต้องถูกปฏิเสธด้วยข้อความภาษาไทย", async () => {
      // act
      const result = await createSale(checkoutForm({ items: [] }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("กรุณาเพิ่มสินค้าลงตะกร้าก่อนชำระเงิน")
    })
  })

  describe("กัน race condition ตอน checkout พร้อมกัน (กติกาข้อ 4)", () => {
    it("ยิงขาย 10 บิลพร้อมกันจากสต็อก 8 ครั้งละ 2 ต้องผ่านแค่ 4 และสต็อกไม่ติดลบ", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 8, price: "10.00" })

      // act
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          createSale(checkoutForm({ items: [{ productId: product.id, quantity: 2 }] })),
        ),
      )

      // assert
      expect(results.filter((r) => r.ok)).toHaveLength(4)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(0)
      expect(after.quantity).toBeGreaterThanOrEqual(0)

      expect(await testPrisma().sale.count()).toBe(4)

      const ledger = await testPrisma().stockTransaction.aggregate({
        where: { productId: product.id, type: "OUT" },
        _sum: { quantity: true },
      })
      expect(ledger._sum.quantity).toBe(8)
    })

    it("เลขที่บิลต้องไม่ซ้ำกันเลยแม้ขายพร้อมกันหลาย session", async () => {
      // arrange — สต็อกเยอะพอให้ทุกบิลผ่าน
      const product = await createTestProduct({ quantity: 100, price: "10.00" })

      // act
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          createSale(checkoutForm({ items: [{ productId: product.id, quantity: 1 }] })),
        ),
      )

      // assert
      expect(results.filter((r) => r.ok)).toHaveLength(8)

      const sales = await testPrisma().sale.findMany({ select: { saleNumber: true } })
      const numbers = sales.map((s) => s.saleNumber)
      expect(new Set(numbers).size).toBe(numbers.length)
      expect(numbers).toHaveLength(8)
    })
  })
})
