import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  TEST_STORE_ID,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setTestUser } from "../helpers/session-mock"
import { addDays, businessDayKey } from "@/lib/day"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

type Action<T = unknown> = (formData: FormData) => Promise<ActionResult<T>>

/// ใบรับแบบร่าง + รับหลายรอบ (Phase 21d)
/// ครอบ: ร่างไม่แตะสต็อก · แก้ใบ · รับเป็นรอบจนครบ · กันรับเกิน (รวม concurrent) · ยกเลิก/คืนยอดค้าง · ปิดใบ · ยกเลิกรอบ/ทั้งใบ
describe.skipIf(!dbReady)("ใบรับสินค้าแบบร่าง + รับหลายรอบ — ยิงลง PostgreSQL จริง", () => {
  let createStockReceipt: Action<{ id: string; docNumber: string }>
  let updateStockReceipt: Action<{ id: string; docNumber: string }>
  let receiveStockRound: Action
  let voidStockReceiptRound: Action
  let cancelReceiptRemaining: Action
  let restoreReceiptRemaining: Action
  let closeStockReceipt: Action
  let voidStockDoc: Action
  let createStockIssue: Action

  beforeAll(async () => {
    const actions = await import("@/app/actions/stock-docs")
    createStockReceipt = actions.createStockReceipt
    updateStockReceipt = actions.updateStockReceipt
    receiveStockRound = actions.receiveStockRound
    voidStockReceiptRound = actions.voidStockReceiptRound
    cancelReceiptRemaining = actions.cancelReceiptRemaining
    restoreReceiptRemaining = actions.restoreReceiptRemaining
    closeStockReceipt = actions.closeStockReceipt
    voidStockDoc = actions.voidStockDoc
    createStockIssue = actions.createStockIssue
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    setTestUser("test-user")
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const today = () => businessDayKey()
  const qty = async (id: string) => (await testPrisma().product.findUniqueOrThrow({ where: { id } })).quantity
  const docOf = (id: string) =>
    testPrisma().stockDocument.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, rounds: true } })

  /// สร้างใบรับเป็นร่าง คืน id ใบ + id บรรทัดตามลำดับ
  async function draft(lines: { productId: string; quantity: number; unitCost?: string }[]) {
    const result = await createStockReceipt(
      makeFormData({ mode: "draft", docDate: today(), supplierName: "แม็คโคร", lines: JSON.stringify(lines) }),
    )
    if (!result.ok || !result.data) throw new Error(`สร้างร่างไม่สำเร็จ: ${result.ok ? "" : result.error}`)
    const doc = await docOf(result.data.id)
    return { id: doc.id, docNumber: doc.docNumber, lineIds: doc.lines.map((line) => line.id) }
  }

  function receive(documentId: string, lines: { lineId: string; quantity: number }[], extra: Record<string, string> = {}) {
    return receiveStockRound(
      makeFormData({ documentId, receivedDate: today(), referenceNo: "INV-1", lines: JSON.stringify(lines), ...extra }),
    )
  }

  describe("ร่าง + แก้ไข", () => {
    it("บันทึกร่าง: สถานะ DRAFT · ไม่แตะสต็อก · ไม่มี ledger · ไม่มีรอบรับ", async () => {
      const a = await createTestProduct({ quantity: 3 })
      const doc = await draft([{ productId: a.id, quantity: 20, unitCost: "10" }])

      const saved = await docOf(doc.id)
      expect(saved.status).toBe("DRAFT")
      expect(saved.totalCost?.toString()).toBe("200")
      expect(saved.rounds).toHaveLength(0)
      expect(await qty(a.id)).toBe(3)
      expect(await testPrisma().stockTransaction.count()).toBe(0)
    })

    it("แก้ร่าง: เปลี่ยนจำนวน/เพิ่ม/ลบบรรทัด/หัวใบ ได้ครบ และยังไม่แตะสต็อก", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const b = await createTestProduct({ quantity: 0 })
      const c = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 5 }, { productId: b.id, quantity: 2 }])

      const edited = await updateStockReceipt(
        makeFormData({
          id: doc.id,
          docDate: today(),
          supplierName: "ร้านใหม่",
          lines: JSON.stringify([
            { lineId: doc.lineIds[0], productId: a.id, quantity: 8 },
            { productId: c.id, quantity: 4, unitCost: "2.5" },
          ]),
        }),
      )
      expect(edited.ok).toBe(true)

      const saved = await docOf(doc.id)
      expect(saved.supplierName).toBe("ร้านใหม่")
      expect(saved.status).toBe("DRAFT")
      expect(saved.lines.map((line) => [line.productId, line.quantity])).toEqual([[a.id, 8], [c.id, 4]])
      expect(saved.totalCost?.toString()).toBe("10")
      expect(await qty(a.id)).toBe(0)
      expect(await testPrisma().stockTransaction.count()).toBe(0)
    })

    it("หลังรับบางส่วน: ลดจำนวนสั่งต่ำกว่าที่รับไม่ได้ · ลบ/เปลี่ยนสินค้าบรรทัดที่รับแล้วไม่ได้ · เพิ่มจำนวนได้", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const b = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 20 }])
      expect((await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 15 }])).ok).toBe(true)

      const edit = (lines: unknown[]) => updateStockReceipt(makeFormData({ id: doc.id, docDate: today(), lines: JSON.stringify(lines) }))

      const tooLow = await edit([{ lineId: doc.lineIds[0], productId: a.id, quantity: 10 }])
      expect(tooLow.ok === false && tooLow.error).toContain("ต้องไม่น้อยกว่า 15")

      const removed = await edit([{ productId: b.id, quantity: 1 }])
      expect(removed.ok === false && removed.error).toContain("ลบออกจากใบไม่ได้")

      const swapped = await edit([{ lineId: doc.lineIds[0], productId: b.id, quantity: 20 }])
      expect(swapped.ok === false && swapped.error).toContain("เปลี่ยนสินค้าไม่ได้")

      const raised = await edit([{ lineId: doc.lineIds[0], productId: a.id, quantity: 25 }])
      expect(raised.ok).toBe(true)
      const saved = await docOf(doc.id)
      expect(saved.lines[0].quantity).toBe(25)
      expect(saved.status).toBe("PARTIAL")
      expect(await qty(a.id)).toBe(15)
    })
  })

  describe("รับเป็นรอบ", () => {
    it("สั่ง 20 รับรอบแรก 15 → รับบางส่วน · รอบสอง 5 → รับครบ · ledger ผูกรอบ · รับต่อไม่ได้", async () => {
      const a = await createTestProduct({ quantity: 1 })
      const doc = await draft([{ productId: a.id, quantity: 20 }])

      const first = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 15 }])
      expect(first.ok).toBe(true)
      expect(await qty(a.id)).toBe(16)
      let saved = await docOf(doc.id)
      expect(saved.status).toBe("PARTIAL")
      expect(saved.lines[0].receivedQty).toBe(15)

      const second = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 5 }], { referenceNo: "INV-2" })
      expect(second.ok).toBe(true)
      expect(await qty(a.id)).toBe(21)
      saved = await docOf(doc.id)
      expect(saved.status).toBe("RECEIVED")
      expect(saved.rounds.map((round) => [round.roundNo, round.referenceNo]).sort()).toEqual([[1, "INV-1"], [2, "INV-2"]])

      const ledger = await testPrisma().stockTransaction.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: "asc" } })
      expect(ledger.map((t) => `${t.type}:${t.quantity}`)).toEqual(["IN:15", "IN:5"])
      expect(ledger.every((t) => t.receiptRoundId !== null)).toBe(true)

      const third = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 1 }])
      expect(third.ok === false && third.error).toContain("รับครบแล้ว")
      expect(await qty(a.id)).toBe(21)
    })

    it("รับเกินยอดค้าง / วันที่อนาคต / ไม่กรอกจำนวนเลย ถูกปฏิเสธ และไม่แตะอะไร", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 10 }])

      const over = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 11 }])
      expect(over.ok === false && over.error).toContain("รับได้อีกไม่เกิน 10")

      const future = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 1 }], { receivedDate: addDays(today(), 1) })
      expect(future.ok === false && future.error).toContain("อนาคต")

      const zero = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 0 }])
      expect(zero.ok === false && zero.error).toContain("อย่างน้อย 1 รายการ")

      expect(await qty(a.id)).toBe(0)
      expect((await docOf(doc.id)).status).toBe("DRAFT")
      expect(await testPrisma().stockReceiptRound.count()).toBe(0)
    })

    it("กดรับพร้อมกัน 5 คำขอ (ครั้งละ 4) จากใบที่สั่ง 10 → ผ่านแค่ 2 · รับรวม 8 ไม่เกินจำนวนสั่ง · เลขรอบไม่ชน", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 10 }])

      const results = await Promise.all(Array.from({ length: 5 }, () => receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 4 }])))
      expect(results.filter((r) => r.ok)).toHaveLength(2)
      expect(await qty(a.id)).toBe(8)

      const saved = await docOf(doc.id)
      expect(saved.lines[0].receivedQty).toBe(8)
      expect(saved.status).toBe("PARTIAL")
      expect(saved.rounds.map((round) => round.roundNo).sort()).toEqual([1, 2])
    })
  })

  describe("ฟอร์มตารางเดียว — บันทึก + รับสินค้า (mode=receive)", () => {
    it("สร้างใบ สั่ง 20 รับครั้งนี้ 15 → รับบางส่วน · สต็อก +15 · เลขใบส่งของอยู่ที่รอบ · ยังค้าง 5 รับเพิ่มได้ภายหลัง", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const created = await createStockReceipt(
        makeFormData({
          mode: "receive",
          docDate: today(),
          receivedDate: today(),
          roundReferenceNo: "DO-77",
          lines: JSON.stringify([{ productId: a.id, quantity: 20, receiveQty: 15 }]),
        }),
      )
      expect(created.ok).toBe(true)
      if (!created.ok || !created.data) return
      const saved = await docOf(created.data.id)
      expect(saved.status).toBe("PARTIAL")
      expect(saved.lines[0]).toMatchObject({ quantity: 20, receivedQty: 15 })
      expect(saved.rounds.map((round) => round.referenceNo)).toEqual(["DO-77"])
      expect(await qty(a.id)).toBe(15)

      // กลับมารับเพิ่มผ่านฟอร์มเดิม (แก้ใบ + รับ) — เพิ่มสินค้าใหม่พร้อมรับในรอบเดียวกัน
      const b = await createTestProduct({ quantity: 0 })
      const more = await updateStockReceipt(
        makeFormData({
          mode: "receive",
          id: saved.id,
          docDate: today(),
          lines: JSON.stringify([
            { lineId: saved.lines[0].id, productId: a.id, quantity: 20, receiveQty: 5 },
            { productId: b.id, quantity: 3, receiveQty: 3 },
          ]),
        }),
      )
      expect(more.ok).toBe(true)
      const after = await docOf(saved.id)
      expect(after.status).toBe("RECEIVED")
      expect(after.rounds).toHaveLength(2)
      expect(await qty(a.id)).toBe(20)
      expect(await qty(b.id)).toBe(3)
    })

    it("บันทึก + รับ ที่รับเกินยอดค้าง = ไม่บันทึกอะไรเลย (ทั้งการแก้ใบและการรับ)", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 10 }])
      const result = await updateStockReceipt(
        makeFormData({
          mode: "receive",
          id: doc.id,
          docDate: today(),
          supplierName: "เปลี่ยนชื่อ",
          lines: JSON.stringify([{ lineId: doc.lineIds[0], productId: a.id, quantity: 10, receiveQty: 11 }]),
        }),
      )
      expect(result.ok === false && result.error).toContain("รับได้อีกไม่เกิน 10")
      const saved = await docOf(doc.id)
      expect(saved.supplierName).toBe("แม็คโคร")
      expect(saved.status).toBe("DRAFT")
      expect(await qty(a.id)).toBe(0)
    })

    it("บันทึก + รับ โดยไม่กรอกรับครั้งนี้เลย = ปฏิเสธ และไม่สร้างใบ", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const result = await createStockReceipt(
        makeFormData({ mode: "receive", docDate: today(), lines: JSON.stringify([{ productId: a.id, quantity: 5, receiveQty: 0 }]) }),
      )
      expect(result.ok === false && result.error).toContain("รับครั้งนี้")
      expect(await testPrisma().stockDocument.count()).toBe(0)
    })
  })

  describe("ยกเลิกยอดค้าง / ปิดใบ", () => {
    it("สั่ง 20 รับ 15 แล้วยกเลิก 5 → ปิดแล้ว (รับไม่ครบ) · สต็อกไม่เปลี่ยน · คืนยอดค้างแล้วรับต่อได้จนรับครบ", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 20 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 15 }])

      const tooMany = await cancelReceiptRemaining(makeFormData({ lineId: doc.lineIds[0], quantity: "6", reason: "ผู้ขายของหมด" }))
      expect(tooMany.ok === false && tooMany.error).toContain("ไม่เกินยอดค้าง 5")

      const cancelled = await cancelReceiptRemaining(makeFormData({ lineId: doc.lineIds[0], quantity: "5", reason: "ผู้ขายของหมด" }))
      expect(cancelled.ok).toBe(true)
      let saved = await docOf(doc.id)
      expect(saved.status).toBe("CLOSED")
      expect(saved.lines[0]).toMatchObject({ receivedQty: 15, cancelledQty: 5, cancelReason: "ผู้ขายของหมด" })
      expect(await qty(a.id)).toBe(15)

      const blocked = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 1 }])
      expect(blocked.ok === false && blocked.error).toContain("ปิดแล้ว")

      const restored = await restoreReceiptRemaining(makeFormData({ lineId: doc.lineIds[0] }))
      expect(restored.ok).toBe(true)
      saved = await docOf(doc.id)
      expect(saved.status).toBe("PARTIAL")
      expect(saved.lines[0]).toMatchObject({ cancelledQty: 0, cancelReason: null })

      expect((await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 5 }])).ok).toBe(true)
      expect((await docOf(doc.id)).status).toBe("RECEIVED")
      expect(await qty(a.id)).toBe(20)
    })

    it("ยกเลิกยอดค้างบางส่วน: สั่ง 20 รับ 15 ยกเลิก 2 → ยังค้าง 3 (รับบางส่วน)", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 20 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 15 }])
      expect((await cancelReceiptRemaining(makeFormData({ lineId: doc.lineIds[0], quantity: "2", reason: "ขาด" }))).ok).toBe(true)

      const over = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 4 }])
      expect(over.ok === false && over.error).toContain("รับได้อีกไม่เกิน 3")
      expect((await docOf(doc.id)).status).toBe("PARTIAL")
    })

    it("ปิดใบ: ยกเลิกยอดค้างทุกบรรทัด → ปิดแล้ว · แก้ไข/ปิดซ้ำไม่ได้", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const b = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 10 }, { productId: b.id, quantity: 4 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 6 }])

      const closed = await closeStockReceipt(makeFormData({ id: doc.id, reason: "ยกเลิกการสั่ง" }))
      expect(closed.ok).toBe(true)
      const saved = await docOf(doc.id)
      expect(saved.status).toBe("CLOSED")
      expect(saved.lines.map((line) => [line.receivedQty, line.cancelledQty])).toEqual([[6, 4], [0, 4]])
      expect(await qty(a.id)).toBe(6)

      const again = await closeStockReceipt(makeFormData({ id: doc.id, reason: "ซ้ำ" }))
      expect(again.ok === false && again.error).toContain("ปิดแล้ว")
      const edit = await updateStockReceipt(
        makeFormData({ id: doc.id, docDate: today(), lines: JSON.stringify([{ lineId: saved.lines[0].id, productId: a.id, quantity: 10 }, { lineId: saved.lines[1].id, productId: b.id, quantity: 4 }]) }),
      )
      expect(edit.ok === false && edit.error).toContain("แก้ไขไม่ได้")
    })
  })

  describe("ยกเลิกรอบ / ยกเลิกทั้งใบ", () => {
    it("ยกเลิกรอบ: ตัดของรอบนั้นออกด้วยรายการชดเชย · ใบกลับไปค้างรับ · ยกเลิกซ้ำไม่ได้", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 20 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 15 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 5 }])
      const round2 = await testPrisma().stockReceiptRound.findFirstOrThrow({ where: { documentId: doc.id, roundNo: 2 } })

      const voided = await voidStockReceiptRound(makeFormData({ id: round2.id, reason: "คีย์ผิด" }))
      expect(voided.ok).toBe(true)
      expect(await qty(a.id)).toBe(15)
      const saved = await docOf(doc.id)
      expect(saved.status).toBe("PARTIAL")
      expect(saved.lines[0].receivedQty).toBe(15)
      const ledger = await testPrisma().stockTransaction.findMany({ where: { receiptRoundId: round2.id }, orderBy: { createdAt: "asc" } })
      expect(ledger.map((t) => `${t.type}:${t.quantity}`)).toEqual(["IN:5", "OUT:5"])
      expect(ledger.every((t) => t.documentId === doc.id)).toBe(true)

      const again = await voidStockReceiptRound(makeFormData({ id: round2.id, reason: "ซ้ำ" }))
      expect(again.ok === false && again.error).toContain("ถูกยกเลิกไปแล้ว")
      expect(await qty(a.id)).toBe(15)
    })

    it("ยกเลิกรอบที่ของถูกเบิกไปแล้วจนไม่พอ = ปฏิเสธ และไม่แตะอะไร", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 5 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 5 }])
      await createStockIssue(makeFormData({ docDate: today(), requesterName: "ครัว", lines: JSON.stringify([{ productId: a.id, quantity: 3 }]) }))
      const round = await testPrisma().stockReceiptRound.findFirstOrThrow({ where: { documentId: doc.id } })

      const voided = await voidStockReceiptRound(makeFormData({ id: round.id, reason: "ของผิดรุ่น" }))
      expect(voided.ok === false && voided.error).toContain("ยกเลิกรอบนี้ไม่ได้")
      expect(await qty(a.id)).toBe(2)
      expect((await testPrisma().stockReceiptRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe("POSTED")
      expect((await docOf(doc.id)).status).toBe("RECEIVED")
    })

    it("ยกเลิกทั้งใบที่รับมา 2 รอบ: ทุกรอบถูกยกเลิก · สต็อกกลับเท่าเดิม · สถานะ VOIDED · รับต่อไม่ได้", async () => {
      const a = await createTestProduct({ quantity: 2 })
      const b = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 10 }, { productId: b.id, quantity: 3 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 4 }, { lineId: doc.lineIds[1], quantity: 3 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 2 }])

      const voided = await voidStockDoc(makeFormData({ id: doc.id, reason: "ยกเลิกทั้งใบ" }))
      expect(voided.ok).toBe(true)
      expect(await qty(a.id)).toBe(2)
      expect(await qty(b.id)).toBe(0)
      const saved = await docOf(doc.id)
      expect(saved.status).toBe("VOIDED")
      expect(saved.rounds.every((round) => round.status === "VOIDED")).toBe(true)
      expect(saved.lines.every((line) => line.receivedQty === 0)).toBe(true)

      const after = await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 1 }])
      expect(after.ok === false && after.error).toContain("ถูกยกเลิกแล้ว")
    })

    it("ยกเลิกใบร่างที่ยังไม่เคยรับ: สถานะ VOIDED โดยไม่มี ledger", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 3 }])
      expect((await voidStockDoc(makeFormData({ id: doc.id, reason: "สั่งผิด" }))).ok).toBe(true)
      expect((await docOf(doc.id)).status).toBe("VOIDED")
      expect(await testPrisma().stockTransaction.count()).toBe(0)
    })
  })

  describe("สิทธิ์", () => {
    it("พนักงานที่ไม่มีสิทธิ์ใบรับ แก้/รับ/ปิด/ยกเลิกยอดค้าง/ยกเลิกรอบ ไม่ได้", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const doc = await draft([{ productId: a.id, quantity: 10 }])
      await receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 2 }])
      const round = await testPrisma().stockReceiptRound.findFirstOrThrow({ where: { documentId: doc.id } })

      await ensureTestUser("staff", "พนักงาน", { storeId: TEST_STORE_ID, role: "STAFF" })
      setTestUser("staff")
      const results = await Promise.all([
        updateStockReceipt(makeFormData({ id: doc.id, docDate: today(), lines: JSON.stringify([{ lineId: doc.lineIds[0], productId: a.id, quantity: 50 }]) })),
        receive(doc.id, [{ lineId: doc.lineIds[0], quantity: 1 }]),
        closeStockReceipt(makeFormData({ id: doc.id, reason: "x" })),
        cancelReceiptRemaining(makeFormData({ lineId: doc.lineIds[0], quantity: "1", reason: "x" })),
        voidStockReceiptRound(makeFormData({ id: round.id, reason: "x" })),
      ])
      expect(results.every((r) => r.ok === false)).toBe(true)

      const saved = await docOf(doc.id)
      expect(saved.lines[0]).toMatchObject({ quantity: 10, receivedQty: 2, cancelledQty: 0 })
      expect(saved.status).toBe("PARTIAL")
      expect(await qty(a.id)).toBe(2)
    })
  })
})
