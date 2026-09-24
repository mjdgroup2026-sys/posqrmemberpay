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
import { businessDayKey, parseBusinessDayKey } from "@/lib/day"

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
    expect(second.ok === false && second.error).toContain("ปิดซ้ำวันเดิมไม่ได้")
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

  // ───────────────────── Phase 19 — เลือกวันปิดรอบ (ย้อนหลัง) ─────────────────────

  /// ย้ายบิลที่เพิ่งขายไป "เมื่อวาน" — เทสไม่ควรพึ่ง clock ของเครื่อง จึงเขียน createdAt ตรง ๆ
  async function backdateSale(saleId: string, day: Date) {
    await testPrisma().sale.update({ where: { id: saleId }, data: { createdAt: day } })
  }

  function yesterdayKey(): string {
    return businessDayKey(new Date(Date.now() - 24 * 60 * 60_000))
  }

  it("ปิดรอบย้อนหลัง: นับเฉพาะบิลของวันที่เลือก ไม่ปนกับวันนี้ และบันทึก closingDate ตามที่เลือก", async () => {
    // arrange — 1 บิลเมื่อวาน (200) + 1 บิลวันนี้ (100)
    const product = await createTestProduct({ quantity: 100, price: "100.00" })
    const old = await sell(product.id, 2, "CASH")
    if (!old.ok || !old.data) throw new Error("ขายไม่สำเร็จ")
    const yesterday = parseBusinessDayKey(yesterdayKey())
    if (!yesterday) throw new Error("parse วันไม่ได้")
    await backdateSale(old.data.id, yesterday)
    await sell(product.id, 1, "CASH")

    // act
    const result = await closeCashierDay(makeFormData({ closingDate: yesterdayKey(), countedCash: 200, note: "" }))

    // assert
    expect(result.ok).toBe(true)
    const closing = await testPrisma().cashierClosing.findFirstOrThrow()
    expect(closing.closingDate.toISOString().slice(0, 10)).toBe(yesterdayKey())
    expect(Number(closing.totalSales)).toBe(200)
    expect(closing.billCount).toBe(1)
    expect(Number(closing.difference)).toBe(0)
  })

  it("ปิดรอบย้อนหลังแล้ว ยังปิดรอบของวันนี้ได้ (คนละวัน) แต่ปิดวันเดิมซ้ำไม่ได้", async () => {
    const first = await closeCashierDay(makeFormData({ closingDate: yesterdayKey(), countedCash: 0, note: "" }))
    expect(first.ok).toBe(true)
    const today = await closeCashierDay(makeFormData({ countedCash: 0, note: "" }))
    expect(today.ok).toBe(true)
    const again = await closeCashierDay(makeFormData({ closingDate: yesterdayKey(), countedCash: 0, note: "" }))
    expect(again.ok).toBe(false)
    expect(await testPrisma().cashierClosing.count()).toBe(2)
  })

  it("เลือกวันอนาคต / รูปแบบผิด ต้องถูกปฏิเสธเป็นภาษาไทย ไม่มีแถวถูกสร้าง", async () => {
    const tomorrow = businessDayKey(new Date(Date.now() + 24 * 60 * 60_000))
    const future = await closeCashierDay(makeFormData({ closingDate: tomorrow, countedCash: 0, note: "" }))
    expect(future.ok).toBe(false)
    expect(future.ok === false && future.error).toContain("ย้อนหลัง")

    const garbage = await closeCashierDay(makeFormData({ closingDate: "22/09/2026", countedCash: 0, note: "" }))
    expect(garbage.ok).toBe(false)
    expect(garbage.ok === false && garbage.fieldErrors?.closingDate).toBeTruthy()

    const impossible = await closeCashierDay(makeFormData({ closingDate: "2026-02-30", countedCash: 0, note: "" }))
    expect(impossible.ok).toBe(false)

    expect(await testPrisma().cashierClosing.count()).toBe(0)
  })

  it("ปิดรอบย้อนหลังแล้ว void บิลของวันนั้นต้องถูกปฏิเสธ (กติกา F9 ตามวันของบิล)", async () => {
    // บิลเมื่อวาน — กติกา F6 เดิม (void ได้เฉพาะวันเดียวกัน) จะปฏิเสธก่อนอยู่แล้ว จึงต้องเทสด้วยบิล "วันนี้"
    // ที่ปิดรอบวันนี้ผ่านฟิลด์ closingDate ชัด ๆ (ไม่ใช่ค่า default) ให้แน่ใจว่าเส้นทางเลือกวันล็อก void จริง
    const product = await createTestProduct({ quantity: 100, price: "100.00" })
    const sale = await sell(product.id, 1, "CASH")
    if (!sale.ok || !sale.data) throw new Error("ขายไม่สำเร็จ")

    const closed = await closeCashierDay(makeFormData({ closingDate: businessDayKey(), countedCash: 100, note: "" }))
    expect(closed.ok).toBe(true)

    const voided = await voidSale(makeFormData({ id: sale.data.id, reason: "หลังปิดรอบ" }))
    expect(voided.ok).toBe(false)
    expect((await testPrisma().sale.findUniqueOrThrow({ where: { id: sale.data.id } })).status).toBe("COMPLETED")
  })

  // ───────────── 20g — ปิดยอดแยกตามช่องทาง (เจ้าของสั่ง 2026-09-24) ─────────────

  /// บิลสำเร็จรูปของวันนี้ด้วยวิธีชำระใดก็ได้ (พร้อมเพย์/บัตรออกจากหน้าปิดบิลโต๊ะ ไม่ใช่ POS จึงสร้างตรง)
  let billSeq = 0
  async function bill(paymentMethod: "CASH" | "TRANSFER" | "QR" | "PROMPTPAY" | "CARD", total: string, cashierId = "test-user") {
    billSeq += 1
    const storeId = (await testPrisma().storeMember.findFirstOrThrow({ where: { userId: "test-user" } })).storeId
    return testPrisma().sale.create({
      data: {
        storeId,
        saleNumber: `INV-G${String(billSeq).padStart(5, "0")}`,
        channel: "MOBILE_ORDER",
        subtotal: total,
        total,
        paymentMethod,
        amountReceived: total,
        cashierId,
        items: { create: [{ kind: "FOOD", name: "ทดสอบ", quantity: 1, unitPrice: total, subtotal: total }] },
      },
    })
  }

  it("20g: พร้อมเพย์แยกจากบัตร · ยอดจริงที่กรอกเก็บครบ · ไม่กรอก = null (ไม่ใช่ 0)", async () => {
    await bill("CASH", "100.00")
    await bill("PROMPTPAY", "250.00")
    await bill("CARD", "80.00")
    await bill("TRANSFER", "40.00")

    const queries = await import("@/lib/queries")
    const storeId = (await testPrisma().storeMember.findFirstOrThrow({ where: { userId: "test-user" } })).storeId
    const summary = await queries.getTodaySalesSummary(storeId, "test-user")
    expect(summary).toMatchObject({ totalCash: 100, totalPromptPay: 250, totalCard: 80, totalTransfer: 40, totalQR: 0, totalSales: 470 })

    // พร้อมเพย์เข้าบัญชีจริง 240 (ขาด 10) · บัตรตรง · โอน/QR ไม่ได้ตรวจ
    const result = await closeCashierDay(
      makeFormData({ countedCash: "100", countedPromptPay: "240", countedCard: "80", countedTransfer: "", note: "" }),
    )
    expect(result.ok).toBe(true)

    const row = await testPrisma().cashierClosing.findFirstOrThrow()
    expect(Number(row.totalPromptPay)).toBe(250)
    expect(Number(row.totalCard)).toBe(80)
    expect(Number(row.countedPromptPay)).toBe(240)
    expect(Number(row.countedCard)).toBe(80)
    expect(row.countedTransfer).toBeNull()
    expect(row.countedQR).toBeNull()

    const view = await queries.getTodayClosing(storeId, "test-user")
    const diff = Object.fromEntries(view!.channels.map((c) => [c.channel, c.difference]))
    expect(diff).toEqual({ CASH: 0, TRANSFER: null, QR: null, PROMPTPAY: -10, CARD: 0 })
  })

  it("20g: ยอดจริงติดลบ/ไม่ใช่ตัวเลข ถูกปฏิเสธเป็นภาษาไทย ไม่มีแถวถูกสร้าง", async () => {
    const negative = await closeCashierDay(makeFormData({ countedCash: "0", countedCard: "-5" }))
    expect(negative.ok).toBe(false)
    expect(negative.ok === false && negative.error).toContain("ไม่ติดลบ")
    const garbage = await closeCashierDay(makeFormData({ countedCash: "0", countedPromptPay: "abc" }))
    expect(garbage.ok).toBe(false)
    expect(await testPrisma().cashierClosing.count()).toBe(0)
  })

  it("20g: สรุปทั้งร้านรวมบิลที่ธนาคารปิดเอง (ไม่มีรอบ) และบอกว่าแคชเชียร์ไหนปิดรอบแล้ว", async () => {
    await ensureTestUser("system", "ระบบ", { storeId: null })
    await ensureTestUser("cashier-2", "แคชเชียร์สอง")
    await bill("CASH", "100.00")
    await bill("PROMPTPAY", "300.00", "system")
    await bill("CARD", "50.00", "cashier-2")
    await closeCashierDay(makeFormData({ countedCash: "100" }))

    const queries = await import("@/lib/queries")
    const storeId = (await testPrisma().storeMember.findFirstOrThrow({ where: { userId: "test-user" } })).storeId
    const day = await queries.getStoreDaySummary(storeId)
    expect(day.totalSales).toBe(450)
    expect(day.totals).toEqual({ CASH: 100, TRANSFER: 0, QR: 0, PROMPTPAY: 300, CARD: 50 })
    const byId = Object.fromEntries(day.byCashier.map((r) => [r.cashierId, r]))
    expect(byId["system"]).toMatchObject({ isSystem: true, closed: null, totalSales: 300 })
    expect(byId["test-user"]).toMatchObject({ closed: true, totalSales: 100 })
    expect(byId["cashier-2"]).toMatchObject({ closed: false, totalSales: 50 })
    // ระบบอยู่ท้ายเสมอ
    expect(day.byCashier.at(-1)?.cashierId).toBe("system")
  })
})
