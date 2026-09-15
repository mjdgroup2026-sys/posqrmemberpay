import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"
import { mockDeep, mockReset } from "vitest-mock-extended"
import type { PrismaClient } from "@/generated/prisma/client"
import type { ActionResult } from "@/lib/types"
import { makeFormData } from "../helpers/form"

const prismaMock = mockDeep<PrismaClient>()

/// ด่านสิทธิ์ (§4) — unit test นี้ mock Prisma ทั้งก้อน จึงอ่านบทบาทจากฐานจริงไม่ได้
/// mock ที่ตัว guardAction แทน แล้วสลับผลลัพธ์เอาเองในแต่ละเคส
const guardActionMock = vi.fn()

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
/// forStore() ของจริงเป็น Prisma extension ที่ยัด storeId เข้า where — ต่อกับ mockDeep ไม่ได้
/// unit test นี้จึงข้ามชั้นนั้น (พิสูจน์แยกใน integration/tenant-isolation.test.ts) แล้วส่ง prismaMock ตรง ๆ
vi.mock("@/lib/db", () => ({ forStore: () => prismaMock }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/permissions", () => ({ guardAction: guardActionMock }))

/// ช่วงอักขระไทยใน Unicode — ใช้ยืนยันว่าข้อความที่ผู้ใช้เห็นเป็นภาษาไทยจริง (กติกาข้อ 6)
const THAI = /[฀-๿]/

const PRODUCT_ID = "prod_test_1"

let stockOut: (formData: FormData) => Promise<ActionResult>

/// $transaction แบบ interactive — ส่ง prismaMock ตัวเดิมเข้าไปเป็น tx
function wireInteractiveTransaction() {
  const transaction = prismaMock.$transaction as unknown as Mock
  transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(prismaMock)
    return arg
  })
}

beforeEach(async () => {
  mockReset(prismaMock)
  guardActionMock.mockReset()
  guardActionMock.mockResolvedValue({
    ok: true,
    user: {
      id: "test-user",
      name: "ผู้ทดสอบ",
      email: "test@example.com",
      storeId: "store_test",
      storeRole: "OWNER",
      roleId: "role_test",
      roleName: "เต็มสิทธิ์",
      granted: {},
    },
  })
  wireInteractiveTransaction()

  const actions = await import("@/app/actions/stock")
  stockOut = actions.stockOut
})

describe("stockOut — ด่านสิทธิ์และการตรวจข้อมูลนำเข้า", () => {
  it("ไม่ได้เข้าสู่ระบบต้องล้มเหลวและห้ามแตะฐานข้อมูลเลย", async () => {
    // arrange
    guardActionMock.mockResolvedValue({ ok: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" })

    // act
    const result = await stockOut(makeFormData({ productId: PRODUCT_ID, quantity: 2, note: "" }))

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("กรุณาเข้าสู่ระบบก่อนทำรายการ")
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled()
  })

  it("เบิกจำนวน 0 ต้องถูกปฏิเสธพร้อมข้อความภาษาไทยและไม่แตะสต็อก", async () => {
    // arrange
    const formData = makeFormData({ productId: PRODUCT_ID, quantity: 0, note: "" })

    // act
    const result = await stockOut(formData)

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("จำนวน ต้องมากกว่า 0")
    expect(result.ok === false && result.fieldErrors?.quantity).toBe("จำนวน ต้องมากกว่า 0")
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled()
  })

  it("เบิกจำนวนติดลบต้องถูกปฏิเสธและไม่แตะสต็อก", async () => {
    // arrange
    const formData = makeFormData({ productId: PRODUCT_ID, quantity: -5, note: "" })

    // act
    const result = await stockOut(formData)

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("จำนวน ต้องมากกว่า 0")
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled()
  })

  it("เบิกจำนวนที่ไม่ใช่จำนวนเต็มต้องถูกปฏิเสธ", async () => {
    // arrange
    const formData = makeFormData({ productId: PRODUCT_ID, quantity: 2.5, note: "" })

    // act
    const result = await stockOut(formData)

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("จำนวน ต้องเป็นจำนวนเต็ม")
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled()
  })

  it("ไม่ได้เลือกสินค้าต้องถูกปฏิเสธด้วยข้อความให้เลือกสินค้า", async () => {
    // arrange
    const formData = makeFormData({ productId: "", quantity: 2, note: "" })

    // act
    const result = await stockOut(formData)

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("กรุณาเลือกสินค้า")
    expect(result.ok === false && result.fieldErrors?.productId).toBe("กรุณาเลือกสินค้า")
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled()
  })
})

describe("stockOut — กันเบิกเกินสต็อก (กติกาข้อ 4)", () => {
  it("เบิกน้อยกว่ายอดคงเหลือต้องสำเร็จและบันทึก ledger OUT หนึ่งแถวในทรานแซกชันเดียวกัน", async () => {
    // arrange — สต็อก 10 เบิก 2 เหลือ 8
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.product.findUniqueOrThrow.mockResolvedValue({
      name: "น้ำปลาทดสอบ",
      unit: "ขวด",
      quantity: 8,
    } as never)

    // act
    const result = await stockOut(
      makeFormData({ productId: PRODUCT_ID, quantity: 2, note: "เบิกเข้าครัว" }),
    )

    // assert
    expect(result.ok).toBe(true)
    expect(result.ok === true && result.message).toBe("เบิก น้ำปลาทดสอบ จำนวน 2 ขวด — คงเหลือ 8")
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.stockTransaction.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.stockTransaction.create).toHaveBeenCalledWith({
      data: { storeId: "store_test", productId: PRODUCT_ID, type: "OUT", quantity: 2, note: "เบิกเข้าครัว" },
    })
  })

  it("ต้องหักสต็อกด้วย updateMany + where quantity gte ไม่ใช่การอ่านก่อนเขียน", async () => {
    // arrange
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.product.findUniqueOrThrow.mockResolvedValue({
      name: "น้ำปลาทดสอบ",
      unit: "ขวด",
      quantity: 5,
    } as never)

    // act
    await stockOut(makeFormData({ productId: PRODUCT_ID, quantity: 3, note: "" }))

    // assert — ด่านเดียวที่กัน race condition ได้จริง
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, quantity: { gte: 3 } },
      data: { quantity: { decrement: 3 } },
    })
  })

  it("เบิกเกินยอดคงเหลือต้องล้มเหลว ไม่บันทึก ledger และบอกยอดที่เบิกได้", async () => {
    // arrange — updateMany ไม่โดนแถวไหนเลยเพราะสต็อกไม่พอ
    prismaMock.product.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.product.findUnique.mockResolvedValue({
      name: "น้ำปลาทดสอบ",
      unit: "ขวด",
      quantity: 3,
    } as never)

    // act
    const result = await stockOut(makeFormData({ productId: PRODUCT_ID, quantity: 5, note: "" }))

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe(
      "สต็อก น้ำปลาทดสอบ ไม่พอเบิก — ขอ 5 ขวด แต่มีอยู่ 3 ขวด",
    )
    expect(result.ok === false && result.fieldErrors?.quantity).toBe("เบิกได้ไม่เกิน 3 ขวด")
    expect(prismaMock.stockTransaction.create).not.toHaveBeenCalled()
  })

  it("เบิกจากสินค้าที่ไม่มีอยู่จริงต้องคืนข้อความไม่พบสินค้า ไม่ throw ออกไปให้ผู้ใช้เห็น", async () => {
    // arrange
    prismaMock.product.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.product.findUnique.mockResolvedValue(null as never)

    // act
    const result = await stockOut(makeFormData({ productId: "ไม่มีจริง", quantity: 1, note: "" }))

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("ไม่พบสินค้าที่เลือก")
    expect(prismaMock.stockTransaction.create).not.toHaveBeenCalled()
  })

  it("ฐานข้อมูลล้มเหลวต้องคืน ActionResult ภาษาไทย ไม่โยน exception ออกไป", async () => {
    // arrange
    const transaction = prismaMock.$transaction as unknown as Mock
    transaction.mockRejectedValue(new Error("connection lost"))

    // act
    const result = await stockOut(makeFormData({ productId: PRODUCT_ID, quantity: 1, note: "" }))

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("บันทึกเบิกจ่ายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
  })
})

describe("stockOut — ledger เป็น append-only (กติกาข้อ 3)", () => {
  it("เบิกสำเร็จแล้วต้องไม่มีการแก้หรือลบ StockTransaction เลย", async () => {
    // arrange
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.product.findUniqueOrThrow.mockResolvedValue({
      name: "น้ำปลาทดสอบ",
      unit: "ขวด",
      quantity: 1,
    } as never)

    // act
    await stockOut(makeFormData({ productId: PRODUCT_ID, quantity: 1, note: "" }))

    // assert
    expect(prismaMock.stockTransaction.update).not.toHaveBeenCalled()
    expect(prismaMock.stockTransaction.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.stockTransaction.delete).not.toHaveBeenCalled()
    expect(prismaMock.stockTransaction.deleteMany).not.toHaveBeenCalled()
  })
})

describe("stockOut — ข้อความที่ผู้ใช้เห็นต้องเป็นภาษาไทย (กติกาข้อ 6)", () => {
  it("เรียก Server Action โดยไม่ส่งฟิลด์ note มาด้วยต้องได้ข้อความผิดพลาดเป็นภาษาไทย", async () => {
    // arrange — Server Action ถูกเรียกตรงได้ ไม่จำเป็นต้องมาจากฟอร์มที่มีช่อง note เสมอ
    const formData = makeFormData({ productId: PRODUCT_ID, quantity: 2 })

    // act
    const result = await stockOut(formData)

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(THAI)
  })
})
