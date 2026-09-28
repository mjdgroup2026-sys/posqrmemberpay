import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { addDays, businessDayKey } from "@/lib/day"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

type DocAction = (formData: FormData) => Promise<ActionResult<{ id: string; docNumber: string }>>

/// เอกสารคลัง รับ/เบิก/ปรับ (Phase 21 · F30) — แทนเทส stockIn/stockOut เดิม
/// ครอบกติกาข้อ 2–4: ledger คู่กับยอดในทรานแซคชันเดียว · append-only (ยกเลิก = ชดเชย) · กันเบิกเกินแบบ concurrent
describe.skipIf(!dbReady)("เอกสารคลัง รับ/เบิก/ปรับ — ยิงลง PostgreSQL จริง", () => {
  let createStockReceipt: DocAction
  let createStockIssue: DocAction
  let createStockAdjustment: DocAction
  let voidStockDoc: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const actions = await import("@/app/actions/stock-docs")
    createStockReceipt = actions.createStockReceipt
    createStockIssue = actions.createStockIssue
    createStockAdjustment = actions.createStockAdjustment
    voidStockDoc = actions.voidStockDoc
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const today = () => businessDayKey()
  const qty = async (id: string) => (await testPrisma().product.findUniqueOrThrow({ where: { id } })).quantity

  function receipt(lines: unknown[], extra: Record<string, string> = {}) {
    return makeFormData({ docDate: today(), supplierName: "แม็คโคร", referenceNo: "INV-778", lines: JSON.stringify(lines), ...extra })
  }
  function issue(lines: unknown[], requesterName = "ครัว — สมชาย") {
    return makeFormData({ docDate: today(), requesterName, lines: JSON.stringify(lines) })
  }
  function adjust(lines: unknown[]) {
    return makeFormData({ docDate: today(), reason: "นับสต็อกประจำเดือน", lines: JSON.stringify(lines) })
  }

  describe("ใบรับสินค้า", () => {
    it("หลายบรรทัด: เพิ่มยอดทุกตัว · ledger IN ผูก documentId · มูลค่ารวมจากราคาทุน · เลขที่ GR-000001", async () => {
      const a = await createTestProduct({ quantity: 2 })
      const b = await createTestProduct({ quantity: 0 })

      const result = await createStockReceipt(
        receipt([
          { productId: a.id, quantity: 10, unitCost: "12.50" },
          { productId: b.id, quantity: 3, unitCost: "" },
        ]),
      )
      expect(result.ok).toBe(true)
      if (!result.ok || !result.data) return
      expect(result.data.docNumber).toBe("GR-000001")

      expect(await qty(a.id)).toBe(12)
      expect(await qty(b.id)).toBe(3)

      const doc = await testPrisma().stockDocument.findUniqueOrThrow({ where: { id: result.data.id }, include: { lines: true } })
      expect(doc.type).toBe("RECEIPT")
      expect(doc.supplierName).toBe("แม็คโคร")
      expect(doc.referenceNo).toBe("INV-778")
      expect(doc.totalCost?.toString()).toBe("125")
      expect(doc.lines).toHaveLength(2)
      expect(doc.lines.find((l) => l.productId === b.id)?.unitCost).toBeNull()

      const ledger = await testPrisma().stockTransaction.findMany({ where: { documentId: doc.id } })
      expect(ledger.map((t) => [t.type, t.quantity]).sort()).toEqual([["IN", 10], ["IN", 3]].sort())
    })

    it("สินค้าซ้ำในเอกสาร / ไม่มีบรรทัด / วันที่อนาคต ถูกปฏิเสธเป็นภาษาไทย และไม่แตะสต็อก", async () => {
      const a = await createTestProduct({ quantity: 1 })

      const dup = await createStockReceipt(receipt([{ productId: a.id, quantity: 1 }, { productId: a.id, quantity: 2 }]))
      expect(dup.ok === false && dup.error).toContain("สินค้าซ้ำ")

      const empty = await createStockReceipt(receipt([]))
      expect(empty.ok === false && empty.error).toContain("อย่างน้อย 1 รายการ")

      const future = await createStockReceipt(receipt([{ productId: a.id, quantity: 1 }], { docDate: addDays(today(), 1) }))
      expect(future.ok === false && future.error).toContain("อนาคต")

      expect(await qty(a.id)).toBe(1)
      expect(await testPrisma().stockDocument.count()).toBe(0)
    })

    it("เลขที่เอกสารไม่ชนกันเมื่อบันทึกพร้อมกัน 6 ใบ และเดินแยกจากใบเบิก", async () => {
      const a = await createTestProduct({ quantity: 100 })
      const results = await Promise.all(Array.from({ length: 6 }, () => createStockReceipt(receipt([{ productId: a.id, quantity: 1 }]))))
      expect(results.every((r) => r.ok)).toBe(true)
      const numbers = results.map((r) => (r.ok ? r.data?.docNumber : null)).sort()
      expect(numbers).toEqual(["GR-000001", "GR-000002", "GR-000003", "GR-000004", "GR-000005", "GR-000006"])

      const issued = await createStockIssue(issue([{ productId: a.id, quantity: 1 }]))
      expect(issued.ok && issued.data?.docNumber).toBe("GI-000001")
      expect(await qty(a.id)).toBe(105)
    })
  })

  describe("ใบเบิกสินค้า", () => {
    it("ต้องมีชื่อผู้เบิก · ผู้เบิกถูกบันทึกทั้งหัวเอกสารและหมายเหตุ ledger", async () => {
      const a = await createTestProduct({ quantity: 5 })

      const noName = await createStockIssue(issue([{ productId: a.id, quantity: 1 }], ""))
      expect(noName.ok === false && noName.error).toBe("กรุณากรอกชื่อผู้เบิก")

      const ok = await createStockIssue(issue([{ productId: a.id, quantity: 2 }], "บาร์น้ำ — มะลิ"))
      expect(ok.ok).toBe(true)
      expect(await qty(a.id)).toBe(3)
      const doc = await testPrisma().stockDocument.findFirstOrThrow({ where: { type: "ISSUE" } })
      expect(doc.requesterName).toBe("บาร์น้ำ — มะลิ")
      const ledger = await testPrisma().stockTransaction.findFirstOrThrow({ where: { documentId: doc.id } })
      expect(ledger.type).toBe("OUT")
      expect(ledger.note).toContain("บาร์น้ำ — มะลิ")
    })

    it("บรรทัดใดบรรทัดหนึ่งไม่พอ = ไม่บันทึกทั้งใบ (rollback) ไม่ตัดบางส่วน", async () => {
      const enough = await createTestProduct({ quantity: 10, name: "ของพอ" })
      const short = await createTestProduct({ quantity: 1, name: "ของน้อย", unit: "ถุง" })

      const result = await createStockIssue(
        issue([
          { productId: enough.id, quantity: 4 },
          { productId: short.id, quantity: 3 },
        ]),
      )
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("สต็อกของน้อย ไม่พอ — ต้องการ 3 ถุง แต่มีอยู่ 1 ถุง — ไม่ได้บันทึกเอกสารนี้")

      expect(await qty(enough.id)).toBe(10)
      expect(await qty(short.id)).toBe(1)
      expect(await testPrisma().stockDocument.count()).toBe(0)
      expect(await testPrisma().stockTransaction.count()).toBe(0)
    })

    it("★ กติกาข้อ 4: ยิงเบิก 10 ใบพร้อมกันจากสต็อก 8 ใบละ 2 ต้องผ่านแค่ 4 และยอดไม่ติดลบ", async () => {
      const product = await createTestProduct({ quantity: 8 })

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => createStockIssue(issue([{ productId: product.id, quantity: 2 }], `ผู้เบิก ${i}`))),
      )

      expect(results.filter((r) => r.ok)).toHaveLength(4)
      expect(await qty(product.id)).toBe(0)
      expect(await testPrisma().stockTransaction.count({ where: { productId: product.id, type: "OUT" } })).toBe(4)
      expect(await testPrisma().stockDocument.count({ where: { type: "ISSUE" } })).toBe(4)
    })
  })

  describe("ใบปรับยอดสต็อก", () => {
    it("คิดส่วนต่างจากยอดในระบบ: นับได้มากกว่า = IN · น้อยกว่า = OUT · ตรง = ไม่มี ledger แต่อยู่ในเอกสาร", async () => {
      const up = await createTestProduct({ quantity: 5 })
      const down = await createTestProduct({ quantity: 9 })
      const same = await createTestProduct({ quantity: 4 })

      const result = await createStockAdjustment(
        adjust([
          { productId: up.id, countedQty: 8 },
          { productId: down.id, countedQty: 2 },
          { productId: same.id, countedQty: 4 },
        ]),
      )
      expect(result.ok).toBe(true)
      expect(result.ok && result.message).toContain("ปรับยอด 2 รายการ")
      if (!result.ok || !result.data) return
      expect(result.data.docNumber).toBe("ADJ-000001")

      expect(await qty(up.id)).toBe(8)
      expect(await qty(down.id)).toBe(2)
      expect(await qty(same.id)).toBe(4)

      const lines = await testPrisma().stockDocumentLine.findMany({ where: { documentId: result.data.id } })
      const byProduct = new Map(lines.map((l) => [l.productId, l]))
      expect([byProduct.get(up.id)?.systemQty, byProduct.get(up.id)?.countedQty, byProduct.get(up.id)?.quantity]).toEqual([5, 8, 3])
      expect(byProduct.get(down.id)?.quantity).toBe(-7)
      expect(byProduct.get(same.id)?.quantity).toBe(0)

      const ledger = await testPrisma().stockTransaction.findMany({ where: { documentId: result.data.id } })
      expect(ledger.map((t) => `${t.type}:${t.quantity}`).sort()).toEqual(["IN:3", "OUT:7"])
    })
  })

  describe("ยกเลิกเอกสาร = รายการชดเชย (กติกาข้อ 3)", () => {
    it("ยกเลิกใบเบิก: คืนของ · ledger เดิมยังอยู่ · สถานะ VOIDED · ยกเลิกซ้ำไม่ได้", async () => {
      const a = await createTestProduct({ quantity: 6 })
      const created = await createStockIssue(issue([{ productId: a.id, quantity: 4 }]))
      if (!created.ok || !created.data) throw new Error("สร้างใบเบิกไม่สำเร็จ")

      const voided = await voidStockDoc(makeFormData({ id: created.data.id, reason: "คีย์ผิด" }))
      expect(voided.ok).toBe(true)
      expect(await qty(a.id)).toBe(6)

      const doc = await testPrisma().stockDocument.findUniqueOrThrow({ where: { id: created.data.id } })
      expect(doc.status).toBe("VOIDED")
      expect(doc.voidReason).toBe("คีย์ผิด")
      const ledger = await testPrisma().stockTransaction.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: "asc" } })
      expect(ledger.map((t) => `${t.type}:${t.quantity}`)).toEqual(["OUT:4", "IN:4"])

      const again = await voidStockDoc(makeFormData({ id: created.data.id, reason: "ซ้ำ" }))
      expect(again.ok === false && again.error).toContain("ถูกยกเลิกไปแล้ว")
      expect(await qty(a.id)).toBe(6)
    })

    it("ยกเลิกใบรับที่ของถูกเบิกไปแล้วจนไม่พอ = ปฏิเสธ และไม่แตะอะไร", async () => {
      const a = await createTestProduct({ quantity: 0 })
      const received = await createStockReceipt(receipt([{ productId: a.id, quantity: 5 }]))
      if (!received.ok || !received.data) throw new Error("สร้างใบรับไม่สำเร็จ")
      await createStockIssue(issue([{ productId: a.id, quantity: 3 }]))

      const voided = await voidStockDoc(makeFormData({ id: received.data.id, reason: "ของผิดรุ่น" }))
      expect(voided.ok).toBe(false)
      expect(voided.ok === false && voided.error).toContain("ยกเลิกไม่ได้")
      expect(await qty(a.id)).toBe(2)
      expect((await testPrisma().stockDocument.findUniqueOrThrow({ where: { id: received.data.id } })).status).toBe("POSTED")
    })

    it("ยกเลิกใบปรับ: กลับทิศส่วนต่างทุกบรรทัด", async () => {
      const up = await createTestProduct({ quantity: 1 })
      const down = await createTestProduct({ quantity: 10 })
      const created = await createStockAdjustment(adjust([{ productId: up.id, countedQty: 4 }, { productId: down.id, countedQty: 7 }]))
      if (!created.ok || !created.data) throw new Error("สร้างใบปรับไม่สำเร็จ")

      const voided = await voidStockDoc(makeFormData({ id: created.data.id, reason: "นับผิดชั้น" }))
      expect(voided.ok).toBe(true)
      expect(await qty(up.id)).toBe(1)
      expect(await qty(down.id)).toBe(10)
    })

    it("กดยกเลิกพร้อมกัน 5 ครั้ง ชดเชยได้ครั้งเดียว", async () => {
      const a = await createTestProduct({ quantity: 10 })
      const created = await createStockIssue(issue([{ productId: a.id, quantity: 4 }]))
      if (!created.ok || !created.data) throw new Error("สร้างใบเบิกไม่สำเร็จ")
      const id = created.data.id

      const results = await Promise.all(Array.from({ length: 5 }, () => voidStockDoc(makeFormData({ id, reason: "พร้อมกัน" }))))
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(await qty(a.id)).toBe(10)
    })
  })
})
