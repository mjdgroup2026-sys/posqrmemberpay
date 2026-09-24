import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { ActionResult } from "@/lib/types"
import { businessDayKey } from "@/lib/day"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  setStoreSettings,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// รายงานแยกประเภท อาหาร / นวดสปา / สินค้าหน้าร้าน (20e ข้อ 8 — เจ้าของสั่ง 2026-09-24)
///
/// สิ่งที่ต้องพิสูจน์: ทุกทางที่ออกบิลบันทึก `SaleItem.kind` ถูก (POS / ปิดบิลโต๊ะ-ห้อง / กลับบ้าน) ·
/// บิลเดียวที่มีทั้งอาหารและนวดแยกยอดถูก · ยอดทุกประเภท + ค่าบริการ − ส่วนลด = ยอดสุทธิพอดี ·
/// บิล void ไม่นับ · CSV มี BOM + กันสูตร Excel + เห็นเฉพาะร้านตัวเอง
describe.skipIf(!dbReady)("รายงานยอดขายแยกประเภท (20e)", () => {
  let createSale: (formData: FormData) => Promise<ActionResult<{ id: string }>>
  let createTakeawaySale: (formData: FormData) => Promise<ActionResult<unknown>>
  let voidSale: (formData: FormData) => Promise<ActionResult>
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment
  let queries: typeof import("@/lib/queries")

  const today = businessDayKey()
  const range = { from: today, to: today }

  beforeAll(async () => {
    const sales = await import("@/app/actions/sales")
    createSale = sales.createSale as typeof createSale
    voidSale = sales.voidSale
    createTakeawaySale = (await import("@/app/actions/staff-order")).createTakeawaySale as typeof createTakeawaySale
    closeSessionWithPayment = (await import("@/lib/close-session")).closeSessionWithPayment
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "10.00" })
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true } })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// ห้องนวด 1 บิล: นวดไทย 300 (มีพนักงาน) + น้ำขิง 2 × 40 → รายการ 380 · ค่าบริการ 10% = 38 · สุทธิ 418
  async function closeSpaBill() {
    const db = testPrisma()
    const program = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60 },
    })
    const drink = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "=น้ำขิง", price: "40.00" } })
    const therapist = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด" } })
    const room = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/1", kind: "ROOM", status: "ORDERED" } })
    const session = await db.tableSession.create({ data: { storeId: TEST_STORE_ID, tableId: room.id } })
    await db.mobileOrder.create({
      data: {
        storeId: TEST_STORE_ID,
        tableSessionId: session.id,
        orderNumber: 1,
        items: {
          create: [
            { menuItemId: program.id, quantity: 1, unitPrice: "300.00", status: "SERVED", therapistId: therapist.id },
            { menuItemId: drink.id, quantity: 2, unitPrice: "40.00", status: "SERVED" },
          ],
        },
      },
    })
    const closed = await closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId: session.id, paymentMethod: "CASH", cashierId: "owner" })
    expect(closed.ok).toBe(true)
    return { program, drink, session }
  }

  it("ทุกทางออกบิลบันทึก kind ถูก และยอดแยกประเภท + ค่าบริการ − ส่วนลด = ยอดสุทธิ", async () => {
    const db = testPrisma()
    // POS หน้าร้าน: 2 × 25 = 50 ส่วนลด 10 → 40
    const product = await createTestProduct({ quantity: 10, price: "25.00" })
    const pos = await createSale(
      makeFormData({ items: JSON.stringify([{ productId: product.id, quantity: 2 }]), discount: "10", paymentMethod: "CASH", amountReceived: "100" }),
    )
    expect(pos.ok).toBe(true)

    // ห้องสปา: นวด 300 + อาหาร 80 + ค่าบริการ 38
    await closeSpaBill()

    // กลับบ้าน: อาหาร 60 ไม่คิดค่าบริการ
    const takeawayMenu = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "ข้าวกล่อง", price: "60.00" } })
    const takeaway = await createTakeawaySale(
      makeFormData({ items: JSON.stringify([{ menuItemId: takeawayMenu.id, quantity: 1, optionIds: [] }]), paymentMethod: "CASH", amountReceived: "60" }),
    )
    expect(takeaway.ok).toBe(true)

    const kinds = await db.saleItem.findMany({ select: { name: true, kind: true }, orderBy: { name: "asc" } })
    expect(Object.fromEntries(kinds.map((k) => [k.name, k.kind]))).toEqual({
      "=น้ำขิง": "FOOD",
      "ข้าวกล่อง": "FOOD",
      "นวดไทย 60": "SERVICE",
      "น้ำปลาทดสอบ": "PRODUCT",
    })

    const report = await queries.getSalesByKind(TEST_STORE_ID, range)
    expect(report.kinds.FOOD).toEqual({ revenue: 140, quantity: 3, bills: 2 })
    expect(report.kinds.SERVICE).toEqual({ revenue: 300, quantity: 1, bills: 1 })
    expect(report.kinds.PRODUCT).toEqual({ revenue: 50, quantity: 2, bills: 1 })
    expect(report.serviceCharge).toBe(38)
    expect(report.discount).toBe(10)
    expect(report.bills).toBe(3)
    expect(report.grandTotal).toBe(40 + 418 + 60)
    // ★ ตัวตรวจหลัก — แถวแยกบวกกันต้องเท่ายอดสุทธิพอดี
    const parts = report.kinds.FOOD.revenue + report.kinds.SERVICE.revenue + report.kinds.PRODUCT.revenue + report.serviceCharge - report.discount
    expect(parts).toBeCloseTo(report.grandTotal, 2)
    expect(report.daily).toHaveLength(1)
    expect(report.daily[0]).toMatchObject({ day: today, FOOD: 140, SERVICE: 300, PRODUCT: 50, adjustments: 28, total: 518 })

    const topService = await queries.getTopItemsByKind(TEST_STORE_ID, range, "SERVICE")
    expect(topService).toEqual([{ name: "นวดไทย 60", quantity: 1, revenue: 300 }])
  })

  it("บิลที่ void ไม่ถูกนับในทุกประเภท", async () => {
    await closeSpaBill()
    const sale = await testPrisma().sale.findFirstOrThrow({ where: { storeId: TEST_STORE_ID } })
    expect((await voidSale(makeFormData({ id: sale.id, reason: "ทดสอบ" }))).ok).toBe(true)

    const report = await queries.getSalesByKind(TEST_STORE_ID, range)
    expect(report.kinds.SERVICE.revenue).toBe(0)
    expect(report.kinds.FOOD.revenue).toBe(0)
    expect(report.grandTotal).toBe(0)
    expect(await queries.listSalesForExport(TEST_STORE_ID, range, null)).toHaveLength(0)
  })

  it("เปลี่ยนเมนูเป็นอาหารทีหลัง รายงานย้อนหลังยังเป็นนวด (snapshot ไม่อ่านเมนูปัจจุบัน)", async () => {
    const { program } = await closeSpaBill()
    await testPrisma().menuItem.update({ where: { id: program.id }, data: { itemType: "FOOD" } })
    expect((await queries.getSalesByKind(TEST_STORE_ID, range)).kinds.SERVICE.revenue).toBe(300)
  })

  it("ตารางพนักงาน × วัน/โปรแกรม ตรงกับยอดรายคน", async () => {
    await closeSpaBill()
    const matrix = await queries.getTherapistDailyMatrix(TEST_STORE_ID, range)
    expect(matrix.days).toEqual([today])
    expect(matrix.rows).toHaveLength(1)
    expect(matrix.rows[0].cells[today]).toEqual({ revenue: 300, services: 1 })
    expect(matrix.dayTotals[today]).toEqual({ revenue: 300, services: 1 })
    expect(matrix.programs).toEqual([expect.objectContaining({ menuItemName: "นวดไทย 60", services: 1, revenue: 300 })])
  })

  it("CSV: BOM + หัวตารางไทย + กันสูตร Excel · กรองประเภทได้ · ไม่เห็นบิลร้านอื่น", async () => {
    await closeSpaBill()
    // บิลของร้าน B วันเดียวกัน — ต้องไม่หลุดเข้าไฟล์ของร้าน A
    await ensureTestStore({ id: OTHER_STORE_ID, slug: "test-b", name: "ร้าน B" })
    const otherProduct = await createTestProduct({ storeId: OTHER_STORE_ID, name: "ของร้านบี", quantity: 5 })
    await testPrisma().sale.create({
      data: {
        storeId: OTHER_STORE_ID,
        saleNumber: "INV-B00001",
        subtotal: "99.00",
        total: "99.00",
        paymentMethod: "CASH",
        amountReceived: "99.00",
        cashierId: "owner",
        items: { create: [{ productId: otherProduct.id, kind: "PRODUCT", name: "ของร้านบี", quantity: 1, unitPrice: "99.00", subtotal: "99.00" }] },
      },
    })

    const { GET } = await import("@/app/api/reports/sales-csv/route")
    const all = await GET(new NextRequest(`http://localhost/api/reports/sales-csv?from=${today}&to=${today}`))
    expect(all.status).toBe(200)
    expect(all.headers.get("content-type")).toContain("text/csv")
    const bytes = new Uint8Array(await all.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = await all.text()
    const lines = text.replace(/^﻿/, "").trim().split("\r\n")
    expect(lines[0]).toBe("วันที่,เวลา,เลขบิล,ช่องทาง,ประเภท,รายการ,จำนวน,ราคาต่อหน่วย,ยอด,พนักงานนวด,โต๊ะ/ห้อง,วิธีชำระ")
    expect(lines).toHaveLength(3)
    expect(text).toContain("'=น้ำขิง")
    expect(text).toContain("นวด/สปา,นวดไทย 60,1,300.00,300.00,001 นิด,3/1")
    expect(text).not.toContain("ของร้านบี")

    const onlySpa = await (await GET(new NextRequest(`http://localhost/api/reports/sales-csv?from=${today}&to=${today}&kind=SERVICE`))).text()
    expect(onlySpa.trim().split("\r\n")).toHaveLength(2)
    expect(onlySpa).not.toContain("น้ำขิง")
  })

  /// 20f — ตัวกรองรายงานสปา: พนักงาน / ประเภทบริการ · id ของร้านอื่น = ผลว่าง
  it("ตัวกรองพนักงานนวดและประเภทบริการ ใช้ได้ทั้งตารางรายคน ตารางรายวัน และ CSV", async () => {
    const db = testPrisma()
    const thai = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดไทย" } })
    const foot = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดเท้า" } })
    const thaiProgram = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60, stationId: thai.id },
    })
    const footProgram = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดเท้า 30", price: "200.00", itemType: "SERVICE", durationMinutes: 30, stationId: foot.id },
    })
    const nid = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด" } })
    const noi = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "002", name: "หน่อย" } })
    const room = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/1", kind: "ROOM", status: "ORDERED" } })
    // บิลเดียว: นิดนวดไทย 300 + หน่อยนวดเท้า 200
    const session = await db.tableSession.create({ data: { storeId: TEST_STORE_ID, tableId: room.id } })
    await db.mobileOrder.create({
      data: {
        storeId: TEST_STORE_ID,
        tableSessionId: session.id,
        orderNumber: 1,
        items: {
          create: [
            { menuItemId: thaiProgram.id, quantity: 1, unitPrice: "300.00", status: "SERVED", therapistId: nid.id },
            { menuItemId: footProgram.id, quantity: 1, unitPrice: "200.00", status: "SERVED", therapistId: noi.id },
          ],
        },
      },
    })
    expect((await closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId: session.id, paymentMethod: "CASH", cashierId: "owner" })).ok).toBe(true)

    const revenueOf = (rows: { therapistId: string; revenue: number }[]) => Object.fromEntries(rows.map((r) => [r.therapistId, r.revenue]))

    // ไม่กรอง
    expect(revenueOf(await queries.getTherapistSalesReport(TEST_STORE_ID, range))).toEqual({ [nid.id]: 300, [noi.id]: 200 })
    // กรองพนักงาน → เหลือคนเดียว
    const onlyNid = await queries.getTherapistSalesReport(TEST_STORE_ID, range, { therapistId: nid.id })
    expect(revenueOf(onlyNid)).toEqual({ [nid.id]: 300 })
    // กรองประเภทบริการ → ทุกคนยังอยู่ แต่นับเฉพาะนวดเท้า
    expect(revenueOf(await queries.getTherapistSalesReport(TEST_STORE_ID, range, { stationId: foot.id }))).toEqual({ [nid.id]: 0, [noi.id]: 200 })
    // ตารางรายวัน + โปรแกรม ใช้ตัวกรองเดียวกัน
    const matrix = await queries.getTherapistDailyMatrix(TEST_STORE_ID, range, { stationId: thai.id })
    expect(matrix.dayTotals[today]).toEqual({ revenue: 300, services: 1 })
    expect(matrix.programs.map((p) => p.menuItemName)).toEqual(["นวดไทย 60"])
    expect((await queries.getTherapistDailyMatrix(TEST_STORE_ID, range, { therapistId: noi.id })).rows.map((r) => r.therapistId)).toEqual([noi.id])
    // CSV
    const csvRows = await queries.listSalesForExport(TEST_STORE_ID, range, "SERVICE", { therapistId: noi.id })
    expect(csvRows.map((r) => r.name)).toEqual(["นวดเท้า 30"])

    // id ของร้านอื่น = ผลว่าง ไม่หลุดข้อมูล
    await ensureTestStore({ id: OTHER_STORE_ID, slug: "test-b", name: "ร้าน B" })
    const foreign = await db.therapist.create({ data: { storeId: OTHER_STORE_ID, code: "B01", name: "คนร้านบี" } })
    expect(await queries.getTherapistSalesReport(TEST_STORE_ID, range, { therapistId: foreign.id })).toEqual([])
    expect(await queries.listSalesForExport(TEST_STORE_ID, range, "SERVICE", { therapistId: foreign.id })).toEqual([])
  })
})
