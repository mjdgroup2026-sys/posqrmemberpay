import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestMenuItem,
  createTestOrder,
  createTestOrderItem,
  createTestQrCode,
  createTestTable,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  setStoreSettings,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("ชำระเงินและปิดบิล MJD Mobile Order (Phase 10)", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let mergeTables: (formData: FormData) => Promise<ActionResult>
  let confirmMobilePayment: (formData: FormData) => Promise<ActionResult<{ saleNumber: string }>>
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const payments = await import("@/app/actions/payments")
    const closeSession = await import("@/lib/close-session")
    openTableSession = tables.openTableSession
    mergeTables = tables.mergeTables
    confirmMobilePayment = payments.confirmMobilePayment
    closeSessionWithPayment = closeSession.closeSessionWithPayment
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "0.00" })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// เปิดโต๊ะ + QR ชั่วคราว + ออร์เดอร์ 1 รอบที่มีของ 2 รายการ (รวม 260 บาท)
  async function seedTableWithOrder(options: { qrType?: "STATIC" | "DYNAMIC" } = {}) {
    const db = testPrisma()
    const table = await createTestTable()
    const qr = await createTestQrCode(table.id, { type: options.qrType ?? "DYNAMIC" })

    // เปิดผ่าน qrToken เพื่อให้ session ผูกกับ QR ใบนั้นจริง ๆ (เหมือนลูกค้าสแกนหน้าโต๊ะ)
    const opened = await openTableSession(makeFormData({ qrToken: qr.token }))
    expect(opened.ok).toBe(true)
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

    const menuA = await createTestMenuItem({ name: "ข้าวกะเพราหมู", price: "80.00" })
    const menuB = await createTestMenuItem({ name: "ต้มยำกุ้ง", price: "100.00" })
    const order = await createTestOrder(sessionId)
    await createTestOrderItem(order.id, menuA.id, { quantity: 2, unitPrice: "80.00" })
    await createTestOrderItem(order.id, menuB.id, { quantity: 1, unitPrice: "100.00" })

    // ตั้งใจใส่รายการที่ถูกยกเลิกไว้ด้วย — ห้ามถูกนับเข้าบิล
    const cancelled = await createTestOrderItem(order.id, menuA.id, { quantity: 5, unitPrice: "80.00" })
    await db.mobileOrderItem.update({
      where: { id: cancelled.id },
      data: { status: "CANCELLED", cancelReason: "ลูกค้าเปลี่ยนใจ" },
    })

    return { table, qr, sessionId }
  }

  it("ปิดบิลแล้วออกเป็น Sale ปกติ (channel = MOBILE_ORDER) พร้อม SaleItem ที่อ้าง MenuItem", async () => {
    const db = testPrisma()
    const { table, sessionId } = await seedTableWithOrder()

    const result = await confirmMobilePayment(
      makeFormData({ sessionId, paymentMethod: "CARD", reference: "EDC-0001" }),
    )
    expect(result.ok).toBe(true)

    const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId }, include: { items: true } })
    expect(sale).not.toBeNull()
    expect(sale?.channel).toBe("MOBILE_ORDER")
    expect(sale?.paymentMethod).toBe("CARD")
    expect(sale?.status).toBe("COMPLETED")
    expect(sale?.saleNumber).toMatch(/^INV-\d{6}$/)
    expect(Number(sale?.total)).toBe(260)
    expect(sale?.paymentReference).toBe("EDC-0001")

    // รายการที่ถูกยกเลิกต้องไม่เข้าบิล และทุกบรรทัดต้องอ้าง MenuItem ไม่ใช่ Product
    expect(sale?.items).toHaveLength(2)
    expect(sale?.items.every((item) => item.productId === null && item.menuItemId !== null)).toBe(true)
    expect(sale?.items.map((item) => item.name).sort()).toEqual(["ข้าวกะเพราหมู", "ต้มยำกุ้ง"])

    const session = await db.tableSession.findUnique({ where: { id: sessionId } })
    expect(session?.status).toBe("CLOSED")
    expect(session?.closedAt).not.toBeNull()
    expect(session?.closedById).toBe("test-user")

    const reloaded = await db.table.findUnique({ where: { id: table.id } })
    expect(reloaded?.status).toBe("EMPTY")
  })

  it("บวกค่าบริการจาก StoreSettings เข้า subtotal ก่อนคิดยอดสุทธิ", async () => {
    const db = testPrisma()
    await setStoreSettings({ serviceChargePercent: "10.00" })
    const { sessionId } = await seedTableWithOrder()

    const result = await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))
    expect(result.ok).toBe(true)

    const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId } })
    expect(Number(sale?.subtotal)).toBe(286)
    expect(Number(sale?.total)).toBe(286)
    expect(Number(sale?.amountReceived)).toBe(286)
    expect(Number(sale?.changeDue)).toBe(0)
  })

  it("จ่ายเงินสดไม่พอต้องถูกปฏิเสธ และจ่ายเกินต้องได้เงินทอนถูกต้อง", async () => {
    const db = testPrisma()
    const { sessionId } = await seedTableWithOrder()

    const short = await confirmMobilePayment(
      makeFormData({ sessionId, paymentMethod: "CASH", amountReceived: "100" }),
    )
    expect(short.ok).toBe(false)
    expect(await db.sale.count()).toBe(0)

    const paid = await confirmMobilePayment(
      makeFormData({ sessionId, paymentMethod: "CASH", amountReceived: "300" }),
    )
    expect(paid.ok).toBe(true)

    const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId } })
    expect(Number(sale?.changeDue)).toBe(40)
  })

  it("DYNAMIC QR ถูก invalidate ทันทีที่ปิดบิล แต่ STATIC QR ไม่ถูกแตะต้อง", async () => {
    const db = testPrisma()
    const { table, qr, sessionId } = await seedTableWithOrder({ qrType: "DYNAMIC" })
    const staticQr = await createTestQrCode(table.id, { type: "STATIC" })

    await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))

    expect((await db.qRCode.findUnique({ where: { id: qr.id } }))?.status).toBe("INVALIDATED")
    expect((await db.qRCode.findUnique({ where: { id: staticQr.id } }))?.status).toBe("ACTIVE")
  })

  it("โต๊ะที่ถูกรวมไว้กลับเป็นว่างพร้อมโต๊ะหลักในทรานแซคชันเดียว", async () => {
    const db = testPrisma()
    const { table, sessionId } = await seedTableWithOrder()
    const secondary = await createTestTable()

    const merged = await mergeTables(
      makeFormData({ primaryTableId: table.id, secondaryTableId: secondary.id }),
    )
    expect(merged.ok).toBe(true)

    await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))

    const after = await db.table.findUnique({ where: { id: secondary.id } })
    expect(after?.status).toBe("EMPTY")
    expect(after?.primaryTableId).toBeNull()
  })

  it("ปิดบิลซ้ำด้วย reference เดิม (webhook ยิงซ้ำ) ต้องได้บิลเดิม ไม่ใช่บิลใหม่", async () => {
    const db = testPrisma()
    const { sessionId } = await seedTableWithOrder()

    const first = await closeSessionWithPayment({
      storeId: TEST_STORE_ID,
      sessionId,
      paymentMethod: "PROMPTPAY",
      paymentReference: "BANK-REF-777",
    })
    const second = await closeSessionWithPayment({
      storeId: TEST_STORE_ID,
      sessionId,
      paymentMethod: "PROMPTPAY",
      paymentReference: "BANK-REF-777",
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.alreadyClosed).toBe(true)
      expect(second.saleNumber).toBe(first.saleNumber)
    }
    expect(await db.sale.count()).toBe(1)
  })

  it("ยิงปิดบิลพร้อมกัน 5 ครั้งด้วย reference เดียวกัน ต้องได้บิลเดียว", async () => {
    const db = testPrisma()
    const { sessionId } = await seedTableWithOrder()

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        closeSessionWithPayment({
          storeId: TEST_STORE_ID,
          sessionId,
          paymentMethod: "PROMPTPAY",
          paymentReference: "BANK-REF-RACE",
        }),
      ),
    )

    expect(results.every((r) => r.ok)).toBe(true)
    expect(await db.sale.count()).toBe(1)
  })

  it("พนักงานกดยืนยันพร้อมกับ webhook (คนละ reference) ต้องปิดบิลได้ครั้งเดียว", async () => {
    const db = testPrisma()
    const { sessionId } = await seedTableWithOrder()

    const results = await Promise.all([
      closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId, paymentMethod: "CARD", cashierId: "test-user" }),
      closeSessionWithPayment({
        storeId: TEST_STORE_ID,
        sessionId,
        paymentMethod: "PROMPTPAY",
        paymentReference: "BANK-REF-DUP",
      }),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await db.sale.count()).toBe(1)
  })

  it("โต๊ะที่ยังไม่มีรายการ ปิดบิลไม่ได้", async () => {
    const db = testPrisma()
    const table = await createTestTable()
    const opened = await openTableSession(makeFormData({ tableId: table.id }))
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

    const result = await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))
    expect(result.ok).toBe(false)
    expect(await db.sale.count()).toBe(0)
  })

  it("ปิดบิลแล้วบิลปรากฏใน /pos/history และสรุปยอดปิดกะของแคชเชียร์", async () => {
    const { listSales, getTodaySalesSummary, getCustomerPaymentStatus } = await import("@/lib/queries")
    const { sessionId, qr } = await seedTableWithOrder()

    await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "CARD", reference: "EDC-9" }))

    const sales = await listSales(TEST_STORE_ID, {})
    expect(sales).toHaveLength(1)
    expect(sales[0]?.channel).toBe("MOBILE_ORDER")
    expect(sales[0]?.total).toBe(260)
    // ชื่อรายการเป็น snapshot ในแถวเอง — ไม่มี Product ให้ join
    expect(sales[0]?.items.map((item) => item.name).sort()).toEqual(["ข้าวกะเพราหมู", "ต้มยำกุ้ง"])

    const summary = await getTodaySalesSummary(TEST_STORE_ID, "test-user")
    expect(summary.billCount).toBe(1)
    expect(summary.totalSales).toBe(260)
    expect(summary.totalCard).toBe(260)
    expect(summary.totalCash).toBe(0)
    expect(summary.totalQR).toBe(0)

    // หน้า pay/success ของลูกค้าต้องอ่านสถานะได้ต่อ แม้ QR ชั่วคราวถูก invalidate ไปแล้ว
    const status = await getCustomerPaymentStatus(qr.token)
    expect(status.state).toBe("PAID")
    if (status.state === "PAID") expect(status.total).toBe(260)
  })

  describe("webhook ยืนยันการชำระเงิน (POST /api/payments/webhook)", () => {
    const SECRET = "test-webhook-secret"

    async function post(body: unknown, secret?: string) {
      const { POST } = await import("@/app/api/payments/webhook/route")
      const request = new Request("http://localhost/api/payments/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret === undefined ? {} : { "x-webhook-secret": secret }),
        },
        body: JSON.stringify(body),
      })
      const response = await POST(request as never)
      return { status: response.status, json: (await response.json()) as Record<string, unknown> }
    }

    beforeEach(() => {
      process.env.PAYMENT_WEBHOOK_SECRET = SECRET
    })

    afterAll(() => {
      delete process.env.PAYMENT_WEBHOOK_SECRET
    })

    it("ไม่ตั้ง secret = ปิดเส้นทางอัตโนมัติไว้ก่อน ไม่ใช่เปิดรับใครก็ได้", async () => {
      delete process.env.PAYMENT_WEBHOOK_SECRET
      const { sessionId } = await seedTableWithOrder()
      const res = await post({ reference: "X", sessionId }, SECRET)
      expect(res.status).toBe(503)
      expect(await testPrisma().sale.count()).toBe(0)
    })

    it("secret ผิดหรือไม่ส่งมา ต้องถูกปฏิเสธและไม่มีบิลเกิดขึ้น", async () => {
      const { sessionId } = await seedTableWithOrder()

      expect((await post({ reference: "X", sessionId })).status).toBe(401)
      expect((await post({ reference: "X", sessionId }, "wrong-secret")).status).toBe(401)
      expect(await testPrisma().sale.count()).toBe(0)
    })

    it("payload ไม่มี reference ต้องเป็น 400", async () => {
      const { sessionId } = await seedTableWithOrder()
      const res = await post({ sessionId }, SECRET)
      expect(res.status).toBe(400)
      expect(await testPrisma().sale.count()).toBe(0)
    })

    it("ยืนยันด้วย qrToken แล้วปิดบิลให้อัตโนมัติโดยลูกค้าไม่ต้องกดอะไรเพิ่ม", async () => {
      const db = testPrisma()
      const { qr, sessionId } = await seedTableWithOrder()

      const res = await post({ reference: "BANK-HOOK-1", qrToken: qr.token, amount: 260 }, SECRET)
      expect(res.status).toBe(200)
      expect(res.json.ok).toBe(true)
      expect(res.json.duplicated).toBe(false)

      const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId } })
      expect(sale?.paymentMethod).toBe("PROMPTPAY")
      expect(sale?.paymentReference).toBe("BANK-HOOK-1")
      // บิลจาก webhook ไม่มีพนักงานกด — ใช้ผู้ใช้ระบบเป็น cashier เพราะ FK ห้ามว่าง
      expect(sale?.cashierId).toBe("system")
      expect((await db.tableSession.findUnique({ where: { id: sessionId } }))?.status).toBe("CLOSED")
    })

    it("webhook ยิงซ้ำด้วย reference เดิม ต้องไม่สร้างบิลซ้ำ", async () => {
      const db = testPrisma()
      const { qr } = await seedTableWithOrder()

      const first = await post({ reference: "BANK-HOOK-2", qrToken: qr.token }, SECRET)
      const again = await post({ reference: "BANK-HOOK-2", qrToken: qr.token }, SECRET)

      expect(first.status).toBe(200)
      expect(again.status).toBe(200)
      expect(again.json.duplicated).toBe(true)
      expect(again.json.saleNumber).toBe(first.json.saleNumber)
      expect(await db.sale.count()).toBe(1)
    })

    it("หา session ที่ตรงไม่เจอ ต้องตอบ 404 ไม่ใช่เงียบ ๆ ผ่านไป", async () => {
      const res = await post({ reference: "BANK-HOOK-3", qrToken: "ไม่มีอยู่จริง" }, SECRET)
      expect(res.status).toBe(404)
    })
  })

  it("บิล Mobile Order เข้า Dashboard และรายงาน 30 วันเหมือนบิลหน้าร้าน", async () => {
    const { getDashboardStats, getSalesReport, getPaymentBreakdown, getTopSellingProducts } =
      await import("@/lib/queries")
    const { sessionId } = await seedTableWithOrder()

    await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))

    const stats = await getDashboardStats(TEST_STORE_ID)
    expect(stats.todayBillCount).toBe(1)
    expect(stats.todaySalesTotal).toBe(260)

    const report = await getSalesReport(TEST_STORE_ID)
    expect(report.reduce((sum, day) => sum + day.total, 0)).toBe(260)

    const payments = await getPaymentBreakdown(TEST_STORE_ID)
    expect(payments).toEqual([{ paymentMethod: "PROMPTPAY", total: 260, bills: 1 }])

    // เมนูอาหารต้องโผล่ในรายการขายดีด้วย ไม่ใช่หายไปเพราะไม่มี Product ให้ join
    const top = await getTopSellingProducts(TEST_STORE_ID, 5)
    expect(top.map((row) => row.name).sort()).toEqual(["ข้าวกะเพราหมู", "ต้มยำกุ้ง"])
    expect(top.find((row) => row.name === "ข้าวกะเพราหมู")?.quantity).toBe(2)
  })

  it("ยอดที่หน้าปิดบิลแสดง ตรงกับยอดที่ถูกบันทึกลงบิลจริง", async () => {
    const db = testPrisma()
    const { getBillingView } = await import("@/lib/queries")
    await setStoreSettings({ serviceChargePercent: "7.50" })
    const { table, sessionId } = await seedTableWithOrder()

    const view = await getBillingView(TEST_STORE_ID, table.id)
    expect(view?.itemsTotal).toBe(260)
    expect(view?.serviceCharge).toBe(19.5)
    expect(view?.total).toBe(279.5)
    // รายการที่ถูกยกเลิกไม่โผล่บนใบเสร็จ
    expect(view?.lines).toHaveLength(2)

    await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))
    const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId } })
    expect(Number(sale?.total)).toBe(view?.total)
  })
})
