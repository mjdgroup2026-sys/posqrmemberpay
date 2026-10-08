import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult, ReceiptData } from "@/lib/types"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestUser,
  giveFullPermissions,
  isTestDbReachable,
  resetDb,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setTestUser } from "../helpers/session-mock"
import { businessDayKey, parseBusinessDayKey } from "@/lib/day"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("ปิดยอดประจำวัน — ยิงลง PostgreSQL จริง", () => {
  let createSale: (formData: FormData) => Promise<ActionResult<ReceiptData>>
  let voidSale: (formData: FormData) => Promise<ActionResult>
  let closeCashierDay: (formData: FormData) => Promise<ActionResult>
  let reopenCashierClosing: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const sales = await import("@/app/actions/sales")
    const closing = await import("@/app/actions/closing")
    createSale = sales.createSale
    voidSale = sales.voidSale
    closeCashierDay = closing.closeCashierDay
    reopenCashierClosing = closing.reopenCashierClosing
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

  it("ปิดรอบถัดไปโดยไม่มีบิลใหม่ต้องถูกปฏิเสธ และมีบันทึกเดียวเท่านั้น", async () => {
    // arrange
    const product = await createTestProduct({ quantity: 100, price: "50.00" })
    await sell(product.id, 1, "CASH")
    await closeCashierDay(makeFormData({ countedCash: 50, note: "" }))

    // act
    const second = await closeCashierDay(makeFormData({ countedCash: 50, note: "" }))

    // assert
    expect(second.ok).toBe(false)
    expect(second.ok === false && second.error).toContain("ไม่มีบิลใหม่")
    expect(await testPrisma().cashierClosing.count()).toBe(1)
  })

  // ───────────── ปิดหลายรอบต่อวัน (เจ้าของสั่ง 2026-09-29) ─────────────

  it("ขายเพิ่มหลังปิดรอบ 1 → รอบ 2 นับเฉพาะบิลใหม่ · บิลทุกใบถูกผูกกับรอบของตัวเอง", async () => {
    const product = await createTestProduct({ quantity: 100, price: "50.00" })
    const a = await sell(product.id, 2, "CASH") // 100
    const first = await closeCashierDay(makeFormData({ countedCash: 100, note: "" }))
    expect(first.ok).toBe(true)
    expect(first.ok && first.message).toContain("รอบที่ 1")

    const b = await sell(product.id, 1, "CASH") // 50
    const c = await sell(product.id, 3, "TRANSFER") // 150
    const queries = await import("@/lib/queries")
    const storeId = (await testPrisma().storeMember.findFirstOrThrow({ where: { userId: "test-user" } })).storeId
    const open = await queries.getOpenSalesSummary(storeId, "test-user")
    expect(open).toMatchObject({ totalSales: 200, totalCash: 50, totalTransfer: 150, billCount: 2 })

    const second = await closeCashierDay(makeFormData({ countedCash: 40, note: "" }))
    expect(second.ok).toBe(true)
    expect(second.ok && second.message).toContain("รอบที่ 2")

    const rounds = await queries.getDayClosings(storeId, "test-user")
    expect(rounds.map((r) => [r.roundNo, r.totalSales, r.billCount, r.difference])).toEqual([
      [1, 100, 1, 0],
      [2, 200, 2, -10],
    ])
    const closingOf = async (id: string) => (await testPrisma().sale.findUniqueOrThrow({ where: { id } })).closingId
    if (!a.ok || !b.ok || !c.ok) throw new Error("ขายไม่สำเร็จ")
    expect(await closingOf(a.data!.id)).toBe(rounds[0].id)
    expect(await closingOf(b.data!.id)).toBe(rounds[1].id)
    expect(await closingOf(c.data!.id)).toBe(rounds[1].id)
    expect((await queries.getOpenSalesSummary(storeId, "test-user")).billCount).toBe(0)
  })

  it("void: บิลในรอบที่ปิดแล้วยกเลิกไม่ได้ · บิลที่ขายหลังปิดยังยกเลิกได้และถูกนับเป็นบิลยกเลิกของรอบถัดไป", async () => {
    const product = await createTestProduct({ quantity: 100, price: "50.00" })
    const inRound = await sell(product.id, 1, "CASH")
    await closeCashierDay(makeFormData({ countedCash: 50, note: "" }))
    const after = await sell(product.id, 1, "CASH")
    if (!inRound.ok || !after.ok) throw new Error("ขายไม่สำเร็จ")

    const locked = await voidSale(makeFormData({ id: inRound.data!.id, reason: "ทดสอบ" }))
    expect(locked.ok).toBe(false)
    expect(locked.ok === false && locked.error).toContain("รอบปิดยอด")

    const allowed = await voidSale(makeFormData({ id: after.data!.id, reason: "ลูกค้าเปลี่ยนใจ" }))
    expect(allowed.ok).toBe(true)

    const second = await closeCashierDay(makeFormData({ countedCash: 0, note: "" }))
    expect(second.ok).toBe(true)
    const round2 = await testPrisma().cashierClosing.findFirstOrThrow({ where: { roundNo: 2 } })
    expect(round2.billCount).toBe(0)
    expect(round2.voidedCount).toBe(1)
    expect(Number(round2.totalSales)).toBe(0)
  })

  it("★ ปิดรอบพร้อมกับ void บิลเดียวกัน → ตัวเลขสอดคล้องเสมอ (void ชนะ = รอบนับเป็นบิลยกเลิก · ปิดรอบชนะ = void ล้ม)", async () => {
    const product = await createTestProduct({ quantity: 100, price: "50.00" })
    for (let i = 0; i < 5; i++) {
      await resetDb()
      await ensureTestUser()
      const fresh = await createTestProduct({ quantity: 100, price: "50.00" })
      const sale = await sell(fresh.id, 1, "CASH")
      if (!sale.ok) throw new Error("ขายไม่สำเร็จ")

      const [voided, closed] = await Promise.all([
        voidSale(makeFormData({ id: sale.data!.id, reason: "ชนกัน" })),
        closeCashierDay(makeFormData({ countedCash: 0, note: "" })),
      ])
      expect(closed.ok).toBe(true)
      const round = await testPrisma().cashierClosing.findFirstOrThrow()
      const row = await testPrisma().sale.findUniqueOrThrow({ where: { id: sale.data!.id } })
      expect(row.closingId).toBe(round.id)
      if (voided.ok) {
        expect(row.status).toBe("VOIDED")
        expect([round.billCount, round.voidedCount, Number(round.totalSales)]).toEqual([0, 1, 0])
      } else {
        expect(row.status).toBe("COMPLETED")
        expect([round.billCount, round.voidedCount, Number(round.totalSales)]).toEqual([1, 0, 50])
      }
    }
    void product
  })

  it("ปิดยอดพร้อมกันหลายคำขอต้องสำเร็จแค่ครั้งเดียว (unique ร้าน+คน+วัน+รอบ)", async () => {
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

    // ประวัติบนหน้าปิดยอดขึ้นตามวันที่ที่เลือก (2026-10-08) — ไม่ปนรอบของวันอื่น
    const { listClosings } = await import("@/lib/queries")
    const store = await testPrisma().cashierClosing.findFirstOrThrow({ select: { storeId: true } })
    const onYesterday = await listClosings(store.storeId, { date: parseBusinessDayKey(yesterdayKey()) ?? undefined })
    const onToday = await listClosings(store.storeId, { date: new Date() })
    expect(onYesterday.map((c) => c.closingDate.toISOString().slice(0, 10))).toEqual([yesterdayKey()])
    expect(onToday.map((c) => c.closingDate.toISOString().slice(0, 10))).toEqual([businessDayKey()])
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

  it("ปิดรอบแล้ว void บิลที่อยู่ในรอบต้องถูกปฏิเสธ (F9 — ล็อกรายบิล)", async () => {
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
    const summary = await queries.getOpenSalesSummary(storeId, "test-user")
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

    const [view] = await queries.getDayClosings(storeId, "test-user")
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
    expect(byId["system"]).toMatchObject({ isSystem: true, rounds: null, openBills: 0, totalSales: 300 })
    expect(byId["test-user"]).toMatchObject({ rounds: 1, openBills: 0, totalSales: 100 })
    expect(byId["cashier-2"]).toMatchObject({ rounds: 0, openBills: 1, totalSales: 50 })

    // ขายเพิ่มหลังปิด → ขึ้นว่าค้าง
    await bill("CASH", "20.00")
    const later = await queries.getStoreDaySummary(storeId)
    expect(later.byCashier.find((r) => r.cashierId === "test-user")).toMatchObject({ rounds: 1, openBills: 1 })
    // ระบบอยู่ท้ายเสมอ
    expect(day.byCashier.at(-1)?.cashierId).toBe("system")
  })
  // ───── เปิดรอบที่ปิดแล้วใหม่ (2026-09-30) ─────

  const REASON = "นับเงินผิด ต้องนับใหม่"

  async function storeIdOf(userId = "test-user") {
    return (await testPrisma().storeMember.findFirstOrThrow({ where: { userId } })).storeId
  }

  it("เปิดรอบใหม่ → บิลกลับเป็นยังไม่ปิดรอบ · ปิดอีกครั้งได้รอบถัดไปที่รวมบิลเดิม + บิลใหม่ · รอบเดิมเก็บคนเปิด/เหตุผล", async () => {
    await bill("CASH", "100.00")
    await bill("CASH", "50.00")
    expect((await closeCashierDay(makeFormData({ countedCash: "140" }))).ok).toBe(true)
    const first = await testPrisma().cashierClosing.findFirstOrThrow()

    const reopened = await reopenCashierClosing(makeFormData({ id: first.id, reason: REASON }))
    expect(reopened.ok).toBe(true)
    expect(await testPrisma().sale.count({ where: { closingId: null } })).toBe(2)

    await bill("CASH", "20.00")
    const again = await closeCashierDay(makeFormData({ countedCash: "170" }))
    expect(again.ok).toBe(true)
    expect(again.ok && again.message).toContain("รอบที่ 2")

    const rows = await testPrisma().cashierClosing.findMany({ orderBy: { roundNo: "asc" } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ roundNo: 1, reopenedById: "test-user", reopenReason: REASON, billCount: 2 })
    expect(rows[0]!.reopenedAt).not.toBeNull()
    expect(rows[1]).toMatchObject({ roundNo: 2, reopenedAt: null, billCount: 3 })
    expect(Number(rows[1]!.totalSales)).toBe(170)
    expect(Number(rows[1]!.difference)).toBe(0)
    expect(await testPrisma().sale.count({ where: { closingId: rows[1]!.id } })).toBe(3)

    // หน้าจอ: รอบเดิมมีข้อมูลคนเปิด · สรุปทั้งร้านนับแค่รอบที่ใช้อยู่
    const queries = await import("@/lib/queries")
    const storeId = await storeIdOf()
    const views = await queries.getDayClosings(storeId, "test-user")
    expect(views[0]!.reopened).toMatchObject({ reason: REASON, byName: "ผู้ทดสอบ" })
    expect(views[1]!.reopened).toBeNull()
    const day = await queries.getStoreDaySummary(storeId)
    expect(day.byCashier.find((r) => r.cashierId === "test-user")).toMatchObject({ rounds: 1, openBills: 0 })
  })

  it("เปิดรอบใหม่แล้ว บิลที่เคยล็อกกลับมายกเลิก (void) ได้ · ปิดใหม่ได้แม้ไม่มีบิลใหม่", async () => {
    const product = await createTestProduct({ quantity: 10, price: "100.00" })
    const sold = await sell(product.id, 1, "CASH")
    if (!sold.ok || !sold.data) throw new Error("ขายไม่สำเร็จ")
    await closeCashierDay(makeFormData({ countedCash: "100" }))
    expect((await voidSale(makeFormData({ id: sold.data.id, reason: "คีย์ผิด" }))).ok).toBe(false)

    const round = await testPrisma().cashierClosing.findFirstOrThrow()
    expect((await reopenCashierClosing(makeFormData({ id: round.id, reason: "ต้องยกเลิกบิลที่คีย์ผิด" }))).ok).toBe(true)
    expect((await voidSale(makeFormData({ id: sold.data.id, reason: "คีย์ผิด" }))).ok).toBe(true)

    const again = await closeCashierDay(makeFormData({ countedCash: "0" }))
    expect(again.ok).toBe(true)
    const latest = await testPrisma().cashierClosing.findFirstOrThrow({ where: { reopenedAt: null } })
    expect(latest).toMatchObject({ roundNo: 2, billCount: 0, voidedCount: 1 })
  })

  it("เปิดรอบใหม่: ไม่มีเหตุผล/สั้นเกิน · เปิดซ้ำ · ไม่ใช่รอบล่าสุด ต้องถูกปฏิเสธเป็นภาษาไทย", async () => {
    await bill("CASH", "100.00")
    await closeCashierDay(makeFormData({ countedCash: "100" }))
    await bill("CASH", "30.00")
    await closeCashierDay(makeFormData({ countedCash: "30" }))
    const [r1, r2] = await testPrisma().cashierClosing.findMany({ orderBy: { roundNo: "asc" } })

    const empty = await reopenCashierClosing(makeFormData({ id: r2!.id, reason: "" }))
    expect(empty.ok === false && empty.error).toContain("อย่างน้อย 5 ตัวอักษร")
    const short = await reopenCashierClosing(makeFormData({ id: r2!.id, reason: "ผิด" }))
    expect(short.ok).toBe(false)

    const notLatest = await reopenCashierClosing(makeFormData({ id: r1!.id, reason: REASON }))
    expect(notLatest.ok === false && notLatest.error).toContain("เฉพาะรอบล่าสุด")

    expect((await reopenCashierClosing(makeFormData({ id: r2!.id, reason: REASON }))).ok).toBe(true)
    const twice = await reopenCashierClosing(makeFormData({ id: r2!.id, reason: REASON }))
    expect(twice.ok === false && twice.error).toContain("ถูกเปิดใหม่ไปแล้ว")

    // รอบ 2 ถูกเปิดแล้ว → รอบ 1 กลายเป็นรอบล่าสุดที่ใช้อยู่ เปิดต่อได้
    expect((await reopenCashierClosing(makeFormData({ id: r1!.id, reason: REASON }))).ok).toBe(true)
    expect(await testPrisma().sale.count({ where: { closingId: { not: null } } })).toBe(0)
  })

  it("เปิดรอบใหม่ต้องมีสิทธิ์ POS_CLOSING:EDIT — พนักงานที่ปิดยอดได้แต่ไม่มีสิทธิ์นี้ถูกปฏิเสธ", async () => {
    await bill("CASH", "100.00")
    await closeCashierDay(makeFormData({ countedCash: "100" }))
    const round = await testPrisma().cashierClosing.findFirstOrThrow()

    await ensureTestUser("staff-closer", "พนักงานปิดยอด", { role: "STAFF" })
    const roleId = await giveFullPermissions("staff-closer", await storeIdOf())
    await testPrisma().rolePermission.updateMany({
      where: { roleId, resource: "POS_CLOSING" },
      data: { actions: ["VIEW", "ADD"] },
    })

    setTestUser("staff-closer")
    try {
      const denied = await reopenCashierClosing(makeFormData({ id: round.id, reason: REASON }))
      expect(denied.ok).toBe(false)
    } finally {
      setTestUser("test-user")
    }
    expect((await testPrisma().cashierClosing.findUniqueOrThrow({ where: { id: round.id } })).reopenedAt).toBeNull()
    expect(await testPrisma().sale.count({ where: { closingId: round.id } })).toBe(1)
  })

  it("★ กดเปิดรอบใหม่พร้อมกัน 5 คำขอ → สำเร็จครั้งเดียว บิลไม่หายและไม่ถูกผูกซ้ำ", async () => {
    await bill("CASH", "100.00")
    await bill("CARD", "40.00")
    await closeCashierDay(makeFormData({ countedCash: "100" }))
    const round = await testPrisma().cashierClosing.findFirstOrThrow()

    const results = await Promise.all(
      Array.from({ length: 5 }, () => reopenCashierClosing(makeFormData({ id: round.id, reason: REASON }))),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await testPrisma().sale.count({ where: { closingId: null } })).toBe(2)

    await closeCashierDay(makeFormData({ countedCash: "100" }))
    expect(await testPrisma().cashierClosing.count({ where: { reopenedAt: null } })).toBe(1)
    expect(await testPrisma().sale.count({ where: { closingId: null } })).toBe(0)
  })
})
