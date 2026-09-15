import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestProduct,
  disconnectTestDb,
  isTestDbReachable,
  ensureTestUser,
  resetDb,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

/// integration test ใช้ DB จริง — mock แค่ next/cache กับ session เท่านั้น
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

if (!dbReady) {
  console.warn(
    [
      "",
      "⚠️  ข้าม integration test ของ Stock Out เพราะต่อฐาน posmobileorderdb_test ไม่ได้",
      "   ต้องทำตามนี้ก่อนถึงจะรันได้:",
      "   1) เปิด Docker Desktop แล้วสตาร์ต container posmobileorder-postgres",
      '   2) docker exec posmobileorder-postgres psql -U posmobileorderuser -d postgres -c "CREATE DATABASE posmobileorderdb_test;"',
      "   3) สร้างไฟล์ .env.test ให้ DATABASE_URL ชี้ไป posmobileorderdb_test",
      "   4) pnpm db:test:migrate",
      "",
    ].join("\n"),
  )
}

describe.skipIf(!dbReady)("Stock Out — ยิงลง PostgreSQL จริง", () => {
  let stockOut: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const actions = await import("@/app/actions/stock")
    stockOut = actions.stockOut
  })

  beforeEach(async () => {
    await resetDb()
    // ด่านสิทธิ์ (§4) อ่านบทบาทจากแถวผู้ใช้จริง — session ที่ mock ไว้อย่างเดียวไม่พออีกต่อไป
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  describe("เบิกในวงเงินสต็อกที่มี", () => {
    it("เบิกน้อยกว่ายอดคงเหลือต้องสำเร็จ ยอดลดลงจริง และเกิด ledger OUT หนึ่งแถว", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 10, unit: "ขวด", name: "น้ำปลาทดสอบ" })

      // act
      const result = await stockOut(
        makeFormData({ productId: product.id, quantity: 3, note: "เบิกเข้าครัว" }),
      )

      // assert
      expect(result.ok).toBe(true)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(7)

      const ledger = await testPrisma().stockTransaction.findMany({
        where: { productId: product.id },
      })
      expect(ledger).toHaveLength(1)
      expect(ledger[0].type).toBe("OUT")
      expect(ledger[0].quantity).toBe(3)
      expect(ledger[0].note).toBe("เบิกเข้าครัว")
    })

    it("เบิกเท่ายอดคงเหลือพอดีต้องสำเร็จและเหลือ 0 พอดี", async () => {
      // arrange — boundary case
      const product = await createTestProduct({ quantity: 5 })

      // act
      const result = await stockOut(makeFormData({ productId: product.id, quantity: 5, note: "" }))

      // assert
      expect(result.ok).toBe(true)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(0)
    })

    it("เบิกหลายครั้งติดกันยอดสะสมต้องถูกต้องและ ledger ต้องครบทุกครั้ง", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 9 })

      // act
      await stockOut(makeFormData({ productId: product.id, quantity: 2, note: "" }))
      await stockOut(makeFormData({ productId: product.id, quantity: 3, note: "" }))
      await stockOut(makeFormData({ productId: product.id, quantity: 1, note: "" }))

      // assert
      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(3)

      const ledgerCount = await testPrisma().stockTransaction.count({
        where: { productId: product.id, type: "OUT" },
      })
      expect(ledgerCount).toBe(3)
    })
  })

  describe("ห้ามเบิกเกิน quantity", () => {
    it("เบิกเกินยอดคงเหลือต้องล้มเหลว และสต็อกต้องไม่เปลี่ยนแม้แต่นิดเดียว", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 4, unit: "ขวด", name: "น้ำปลาทดสอบ" })

      // act
      const result = await stockOut(makeFormData({ productId: product.id, quantity: 5, note: "" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe(
        "สต็อก น้ำปลาทดสอบ ไม่พอเบิก — ขอ 5 ขวด แต่มีอยู่ 4 ขวด",
      )
      expect(result.ok === false && result.fieldErrors?.quantity).toBe("เบิกได้ไม่เกิน 4 ขวด")

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(4)

      const ledgerCount = await testPrisma().stockTransaction.count({
        where: { productId: product.id },
      })
      expect(ledgerCount).toBe(0)
    })

    it("เบิกเกินแค่ 1 หน่วยก็ต้องล้มเหลว (boundary ฝั่งเกิน)", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 5 })

      // act
      const result = await stockOut(makeFormData({ productId: product.id, quantity: 6, note: "" }))

      // assert
      expect(result.ok).toBe(false)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(5)
    })

    it("เบิกจากสินค้าที่สต็อกเป็น 0 ต้องล้มเหลวและยอดต้องไม่ติดลบ", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 0 })

      // act
      const result = await stockOut(makeFormData({ productId: product.id, quantity: 1, note: "" }))

      // assert
      expect(result.ok).toBe(false)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(0)
    })

    it("เบิกสินค้าที่ไม่มีอยู่ในฐานต้องคืนข้อความไม่พบสินค้า ไม่ throw", async () => {
      // arrange
      const missingId = "ไม่มีสินค้ารหัสนี้"

      // act
      const result = await stockOut(makeFormData({ productId: missingId, quantity: 1, note: "" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("ไม่พบสินค้าที่เลือก")
    })
  })

  describe("กัน race condition ตอนเบิกพร้อมกัน (กติกาข้อ 4)", () => {
    it("ยิงเบิก 10 คำขอพร้อมกันจากสต็อก 8 ครั้งละ 2 ต้องผ่านแค่ 4 และยอดต้องไม่ติดลบ", async () => {
      // arrange — สินค้ามีสต็อก 8 ชิ้น เบิกครั้งละ 2
      const product = await createTestProduct({ quantity: 8 })

      // act — ยิงพร้อมกัน 10 คำขอ
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          stockOut(makeFormData({ productId: product.id, quantity: 2, note: "เทสยิงพร้อมกัน" })),
        ),
      )

      // assert
      const succeeded = results.filter((r) => r.ok)
      expect(succeeded).toHaveLength(4)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(0)
      expect(after.quantity).toBeGreaterThanOrEqual(0)

      const ledgerCount = await testPrisma().stockTransaction.count({
        where: { productId: product.id, type: "OUT" },
      })
      expect(ledgerCount).toBe(4)
    })

    it("ยิงเบิก 10 คำขอพร้อมกันจากสต็อก 7 ครั้งละ 3 ต้องผ่านแค่ 2 และเหลือ 1", async () => {
      // arrange — จำนวนที่หารไม่ลงตัว กันกรณีที่โค้ดเผลอปล่อยให้ยอดติดลบ
      const product = await createTestProduct({ quantity: 7 })

      // act
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          stockOut(makeFormData({ productId: product.id, quantity: 3, note: "" })),
        ),
      )

      // assert
      expect(results.filter((r) => r.ok)).toHaveLength(2)

      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.quantity).toBe(1)

      const ledgerCount = await testPrisma().stockTransaction.count({
        where: { productId: product.id, type: "OUT" },
      })
      expect(ledgerCount).toBe(2)
    })

    it("ยอดรวมที่เบิกได้จริงต้องเท่ากับผลรวมใน ledger เสมอ ไม่มีแถวค้างจากคำขอที่ล้มเหลว", async () => {
      // arrange
      const product = await createTestProduct({ quantity: 8 })

      // act
      await Promise.all(
        Array.from({ length: 10 }, () =>
          stockOut(makeFormData({ productId: product.id, quantity: 2, note: "" })),
        ),
      )

      // assert — สต็อกที่หายไปต้องเท่ากับผลรวม ledger เป๊ะ (ledger ต้องไม่มี orphan)
      const after = await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })
      const sum = await testPrisma().stockTransaction.aggregate({
        where: { productId: product.id, type: "OUT" },
        _sum: { quantity: true },
      })
      expect(sum._sum.quantity).toBe(8 - after.quantity)
    })
  })
})
