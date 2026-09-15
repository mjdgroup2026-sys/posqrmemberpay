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

/// mock เฉพาะการยิงออกไปหาธนาคาร — ตรรกะที่เหลือใน scb.ts (เช่น confirmationResponse) ใช้ของจริง
const inquireMock = vi.fn()
vi.mock("@/lib/payment-provider/scb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment-provider/scb")>()
  return { ...actual, inquireBillPayment: (...args: unknown[]) => inquireMock(...args) }
})

const WEBHOOK_SECRET = "test-secret-0123456789abcdef"

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("payment confirmation ของ SCB (Phase 10)", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let issuePaymentIntent: typeof import("@/lib/payment-intent").issuePaymentIntent
  let POST: typeof import("@/app/api/payments/webhook/scb/[secret]/route").POST

  beforeAll(async () => {
    process.env.SCB_WEBHOOK_SECRET = WEBHOOK_SECRET
    const tables = await import("@/app/actions/tables")
    const intents = await import("@/lib/payment-intent")
    const route = await import("@/app/api/payments/webhook/scb/[secret]/route")
    openTableSession = tables.openTableSession
    issuePaymentIntent = intents.issuePaymentIntent
    POST = route.POST
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "0.00" })
    inquireMock.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// โต๊ะที่มีออร์เดอร์รวม 260 บาท + PaymentIntent ที่ออก QR ไว้แล้ว
  async function seedSessionWithIntent() {
    const table = await createTestTable()
    const qr = await createTestQrCode(table.id, { type: "DYNAMIC" })
    const opened = await openTableSession(makeFormData({ qrToken: qr.token }))
    expect(opened.ok).toBe(true)
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

    const menuA = await createTestMenuItem({ name: "ข้าวกะเพราหมู", price: "80.00" })
    const menuB = await createTestMenuItem({ name: "ต้มยำกุ้ง", price: "100.00" })
    const order = await createTestOrder(sessionId)
    await createTestOrderItem(order.id, menuA.id, { quantity: 2, unitPrice: "80.00" })
    await createTestOrderItem(order.id, menuB.id, { quantity: 1, unitPrice: "100.00" })

    const intent = await issuePaymentIntent(TEST_STORE_ID, sessionId, 260)
    return { table, sessionId, intent }
  }

  function callWebhook(secret: string, payload: unknown) {
    const request = new Request(`http://localhost/api/payments/webhook/scb/${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    const context = { params: Promise.resolve({ secret }) }
    return POST(request as Parameters<typeof POST>[0], context as Parameters<typeof POST>[1])
  }

  it("ธนาคารยืนยันและยอดตรง → ปิดบิลอัตโนมัติเป็น Sale channel MOBILE_ORDER", async () => {
    const db = testPrisma()
    const { table, sessionId, intent } = await seedSessionWithIntent()

    inquireMock.mockResolvedValue({
      ok: true,
      data: { transactionId: "SCBTX-0001", amount: 260, billPaymentRef1: intent.ref1 },
    })

    const response = await callWebhook(WEBHOOK_SECRET, {
      transactionId: "SCBTX-0001",
      billPaymentRef1: intent.ref1,
      amount: "260.00",
      transactionDateandTime: "2026-09-07T12:30:00.000+07:00",
    })
    const body = await response.json()

    // ต้องตอบตามรูปแบบที่ SCB บังคับ ไม่งั้นธนาคารถือว่าล้มเหลวแล้วยิงซ้ำ 3 ครั้ง
    expect(body.resCode).toBe("00")
    expect(body.resDesc).toBe("success")
    expect(body.transactionId).toBe("SCBTX-0001")

    const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId } })
    expect(sale?.channel).toBe("MOBILE_ORDER")
    expect(sale?.paymentMethod).toBe("PROMPTPAY")
    expect(sale?.paymentReference).toBe("SCBTX-0001")
    expect(Number(sale?.total)).toBe(260)

    const reloadedIntent = await db.paymentIntent.findUnique({ where: { id: intent.id } })
    expect(reloadedIntent?.status).toBe("PAID")
    expect(reloadedIntent?.transactionId).toBe("SCBTX-0001")

    const session = await db.tableSession.findUnique({ where: { id: sessionId } })
    expect(session?.status).toBe("CLOSED")
    const reloadedTable = await db.table.findUnique({ where: { id: table.id } })
    expect(reloadedTable?.status).toBe("EMPTY")

    // ตรวจว่าถามกลับไปที่ธนาคารจริง ด้วยวันที่จาก payload ไม่ใช่วันที่ของเครื่อง server
    expect(inquireMock).toHaveBeenCalledWith({ transactionDate: "2026-09-07", ref1: intent.ref1 })
  })

  it("ธนาคารยิง callback ซ้ำด้วย transactionId เดิม → ไม่สร้างบิลซ้ำ และยังตอบสำเร็จ", async () => {
    const db = testPrisma()
    const { sessionId, intent } = await seedSessionWithIntent()

    inquireMock.mockResolvedValue({
      ok: true,
      data: { transactionId: "SCBTX-DUP", amount: 260, billPaymentRef1: intent.ref1 },
    })

    const payload = {
      transactionId: "SCBTX-DUP",
      billPaymentRef1: intent.ref1,
      amount: "260.00",
      transactionDateandTime: "2026-09-07T12:30:00.000+07:00",
    }

    const first = await callWebhook(WEBHOOK_SECRET, payload)
    const second = await callWebhook(WEBHOOK_SECRET, payload)
    const third = await callWebhook(WEBHOOK_SECRET, payload)

    expect((await first.json()).resCode).toBe("00")
    expect((await second.json()).resCode).toBe("00")
    expect((await third.json()).resCode).toBe("00")

    const sales = await db.sale.findMany({ where: { tableSessionId: sessionId } })
    expect(sales).toHaveLength(1)

    // รอบซ้ำต้องตัดจบตั้งแต่เจอ Sale เดิม ไม่ต้องไปรบกวนธนาคารอีก
    expect(inquireMock).toHaveBeenCalledTimes(1)
  })

  it("ยอดที่ธนาคารยืนยันไม่ตรงกับบิล → ห้ามปิดบิล ต้องแจ้งพนักงานและ mark FAILED", async () => {
    const db = testPrisma()
    const { sessionId, intent } = await seedSessionWithIntent()

    // ลูกค้าแก้จำนวนเงินในแอปธนาคารเป็น 200 ทั้งที่บิล 260
    inquireMock.mockResolvedValue({
      ok: true,
      data: { transactionId: "SCBTX-SHORT", amount: 200, billPaymentRef1: intent.ref1 },
    })

    const response = await callWebhook(WEBHOOK_SECRET, {
      transactionId: "SCBTX-SHORT",
      billPaymentRef1: intent.ref1,
      amount: "260.00", // payload โกหกว่าจ่ายครบ — ต้องไม่ถูกเชื่อ
      transactionDateandTime: "2026-09-07T12:30:00.000+07:00",
    })
    expect((await response.json()).resCode).toBe("99")

    const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId } })
    expect(sale).toBeNull()

    const session = await db.tableSession.findUnique({ where: { id: sessionId } })
    expect(session?.status).not.toBe("CLOSED")

    const reloadedIntent = await db.paymentIntent.findUnique({ where: { id: intent.id } })
    expect(reloadedIntent?.status).toBe("FAILED")

    const notification = await db.notification.findFirst({
      where: { tableSessionId: sessionId, type: "CHECK_BILL" },
      orderBy: { createdAt: "desc" },
    })
    expect(notification?.reason).toContain("ยอดชำระไม่ตรงกับบิล")
  })

  it("ธนาคารบอกว่าไม่พบรายการ → ห้ามปิดบิล และไม่ mark FAILED เพราะอาจแค่ธนาคารตอบช้า", async () => {
    const db = testPrisma()
    const { sessionId, intent } = await seedSessionWithIntent()

    inquireMock.mockResolvedValue({ ok: false, error: "ธนาคารไม่พบรายการชำระเงินที่ตรงกับเลขอ้างอิงนี้" })

    const response = await callWebhook(WEBHOOK_SECRET, {
      transactionId: "SCBTX-FAKE",
      billPaymentRef1: intent.ref1,
      amount: "260.00",
    })
    expect((await response.json()).resCode).toBe("99")

    expect(await db.sale.findFirst({ where: { tableSessionId: sessionId } })).toBeNull()

    // ยังเป็น PENDING เพื่อให้ callback รอบถัดไปของธนาคารยังปิดบิลได้ถ้ารายการมาช้า
    const reloadedIntent = await db.paymentIntent.findUnique({ where: { id: intent.id } })
    expect(reloadedIntent?.status).toBe("PENDING")
  })

  it("ref1 ที่ไม่รู้จัก → ปฏิเสธโดยไม่แตะฐานข้อมูล", async () => {
    const db = testPrisma()
    const { sessionId } = await seedSessionWithIntent()

    const response = await callWebhook(WEBHOOK_SECRET, {
      transactionId: "SCBTX-UNKNOWN",
      billPaymentRef1: "NOTAREALREF1",
      amount: "260.00",
    })
    expect((await response.json()).resCode).toBe("99")
    expect(await db.sale.findFirst({ where: { tableSessionId: sessionId } })).toBeNull()
    expect(inquireMock).not.toHaveBeenCalled()
  })

  it("path secret ผิด → 401 และไม่ถามธนาคารเลย", async () => {
    const { intent } = await seedSessionWithIntent()

    const response = await callWebhook("wrong-secret-value-aaaaaaaaaa", {
      transactionId: "SCBTX-BAD",
      billPaymentRef1: intent.ref1,
      amount: "260.00",
    })
    expect(response.status).toBe(401)
    expect(inquireMock).not.toHaveBeenCalled()
  })

  describe("การออก PaymentIntent", () => {
    it("ยอดเท่าเดิม → ใช้ใบเดิมซ้ำ ไม่ออก QR ใบใหม่", async () => {
      const db = testPrisma()
      const { sessionId, intent } = await seedSessionWithIntent()

      const again = await issuePaymentIntent(TEST_STORE_ID, sessionId, 260)
      expect(again.ref1).toBe(intent.ref1)

      const all = await db.paymentIntent.findMany({ where: { tableSessionId: sessionId } })
      expect(all).toHaveLength(1)
    })

    it("ยอดเปลี่ยน (ลูกค้าสั่งเพิ่ม) → ออกใบใหม่ และปิดใบเก่าเป็น EXPIRED", async () => {
      const db = testPrisma()
      const { sessionId, intent } = await seedSessionWithIntent()

      const updated = await issuePaymentIntent(TEST_STORE_ID, sessionId, 340)
      expect(updated.ref1).not.toBe(intent.ref1)

      const old = await db.paymentIntent.findUnique({ where: { id: intent.id } })
      expect(old?.status).toBe("EXPIRED")

      const fresh = await db.paymentIntent.findUnique({ where: { id: updated.id } })
      expect(fresh?.status).toBe("PENDING")
      expect(Number(fresh?.amount)).toBe(340)
    })

    it("ref1 ต้องเป็น A-Z0-9 ไม่เกิน 20 ตัวตามที่ SCB รับได้", async () => {
      const { intent } = await seedSessionWithIntent()
      expect(intent.ref1).toMatch(/^[A-Z0-9]{1,20}$/)
    })

    /// เจอจริง 2026-09-10: ลูกค้าจ่ายหลัง QR บนจอหมดอายุ เงินเข้าจริง แต่จอลูกค้าไม่ขึ้นใบเสร็จ
    ///
    /// "หมดอายุ" ของเราไม่ได้ทำให้ QR ในแอปธนาคารจ่ายไม่ได้ — เมื่อธนาคารยืนยันว่าเงินเข้าและยอดตรง
    /// ต้องปิดบิลให้ตามปกติ แล้วสถานะฝั่งลูกค้าต้องกลายเป็น PAID เพื่อให้หน้าเว็บพาไปหน้าใบเสร็จ
    it("QR หมดอายุฝั่งเราแล้วลูกค้ายังจ่ายได้ → ต้องปิดบิลและออกใบเสร็จให้ลูกค้าตามปกติ", async () => {
      const db = testPrisma()
      const { table, sessionId, intent } = await seedSessionWithIntent()

      // จำลองใบที่หมดอายุไปแล้ว (ลูกค้ากดสร้าง QR ใหม่ หรือใบเก่าพ้น TTL)
      await db.paymentIntent.update({
        where: { id: intent.id },
        data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 60_000) },
      })

      inquireMock.mockResolvedValue({
        ok: true,
        data: { transactionId: "SCBTX-LATE-QR", amount: 260, billPaymentRef1: intent.ref1 },
      })

      const response = await callWebhook(WEBHOOK_SECRET, {
        transactionId: "SCBTX-LATE-QR",
        billPaymentRef1: intent.ref1,
        amount: "260.00",
        transactionDateandTime: "2026-09-10T12:30:00.000+07:00",
      })
      expect((await response.json()).resCode).toBe("00")

      const sale = await db.sale.findFirst({ where: { tableSessionId: sessionId } })
      expect(sale?.paymentReference).toBe("SCBTX-LATE-QR")

      // ใบที่หมดอายุต้องถูกบันทึกว่าจ่ายแล้ว ไม่ใช่ค้าง EXPIRED ทั้งที่มีเงินเข้า
      const reloaded = await db.paymentIntent.findUnique({ where: { id: intent.id } })
      expect(reloaded?.status).toBe("PAID")
      expect(reloaded?.transactionId).toBe("SCBTX-LATE-QR")

      // ★ หัวใจของเคสนี้ — หน้าลูกค้าโพลผ่าน getCustomerPaymentStatus ต้องได้ PAID พร้อมเลขบิล
      const qr = await db.qRCode.findFirst({ where: { tableId: table.id } })
      const queries = await import("@/lib/queries")
      const status = await queries.getCustomerPaymentStatus(qr?.token ?? "")
      expect(status.state).toBe("PAID")
      if (status.state === "PAID") {
        expect(status.saleNumber).toBe(sale?.saleNumber)
        expect(status.total).toBe(260)
      }

      // ★ ฝั่งพนักงานต้องเห็นป้าย "ลูกค้าชำระเงินแล้ว" ในกรอบของโต๊ะนี้ด้วย — บิลที่มาจากใบ QR
      //   ที่หมดอายุไปแล้วก็ยังเป็นบิลที่ระบบปิดเอง ต้องไม่ตกหล่นจากป้าย
      const paidBills = await queries.listCustomerPaidBills(TEST_STORE_ID)
      expect(paidBills.map((bill) => bill.tableId)).toContain(table.id)
      expect(paidBills[0]?.saleNumber).toBe(sale?.saleNumber)
    })
  })

  describe("ด่านกันเงินขาดและกันแจ้งเตือนซ้ำ", () => {
    it("บิลโตขึ้นหลังออก QR จนเงินที่โอนมาไม่พอ → ห้ามปิดบิล ต้องแจ้งพนักงาน", async () => {
      const db = testPrisma()
      const { sessionId, intent } = await seedSessionWithIntent()

      // ลูกค้าอีกคนบนโต๊ะเดียวกันสั่งเพิ่ม 100 บาทระหว่างที่คนแรกกำลังจ่าย → บิลจริงกลายเป็น 360
      // ยอดใน PaymentIntent ยังเป็น 260 อยู่ (ล็อกไว้ตอนออก QR) ด่านเทียบยอดชั้นแรกจึงผ่าน
      const extra = await createTestMenuItem({ name: "ข้าวผัดปู", price: "100.00" })
      const order2 = await createTestOrder(sessionId, 2)
      await createTestOrderItem(order2.id, extra.id, { quantity: 1, unitPrice: "100.00" })

      inquireMock.mockResolvedValue({
        ok: true,
        data: { transactionId: "SCBTX-GREW", amount: 260, billPaymentRef1: intent.ref1 },
      })

      const response = await callWebhook(WEBHOOK_SECRET, {
        transactionId: "SCBTX-GREW",
        billPaymentRef1: intent.ref1,
        amount: "260.00",
        transactionDateandTime: "2026-09-09T12:30:00.000+07:00",
      })
      expect((await response.json()).resCode).toBe("99")

      // ปิดบิลตรงนี้คือร้านขาดเงิน 100 บาทโดยไม่มีใครรู้
      expect(await db.sale.findFirst({ where: { tableSessionId: sessionId } })).toBeNull()
      expect((await db.tableSession.findUnique({ where: { id: sessionId } }))?.status).not.toBe("CLOSED")
      expect((await db.paymentIntent.findUnique({ where: { id: intent.id } }))?.status).toBe("FAILED")

      const notification = await db.notification.findFirst({
        where: { tableSessionId: sessionId, type: "CHECK_BILL" },
      })
      expect(notification?.reason).toContain("ได้รับเงิน 260.00 บาทแล้ว")
      expect(notification?.reason).toContain("SCBTX-GREW")
    })

    it("ธนาคาร retry callback ที่ยอดไม่ตรง 3 ครั้ง → แจ้งพนักงานใบเดียว ไม่ใช่สามใบ", async () => {
      const db = testPrisma()
      const { sessionId, intent } = await seedSessionWithIntent()

      // ลูกค้าแก้จำนวนเงินในแอปธนาคารเป็น 200 ทั้งที่บิล 260
      inquireMock.mockResolvedValue({
        ok: true,
        data: { transactionId: "SCBTX-RETRY", amount: 200, billPaymentRef1: intent.ref1 },
      })

      const payload = {
        transactionId: "SCBTX-RETRY",
        billPaymentRef1: intent.ref1,
        amount: "260.00",
        transactionDateandTime: "2026-09-09T12:30:00.000+07:00",
      }

      // SCB ยิงซ้ำ 3 ครั้ง ห่างกัน 12 วินาที เมื่อได้ resCode ที่ไม่ใช่ 00
      await callWebhook(WEBHOOK_SECRET, payload)
      await callWebhook(WEBHOOK_SECRET, payload)
      await callWebhook(WEBHOOK_SECRET, payload)

      const notifications = await db.notification.findMany({
        where: { tableSessionId: sessionId, type: "CHECK_BILL" },
      })
      expect(notifications).toHaveLength(1)
      expect(notifications[0]?.reason).toContain("ยอดชำระไม่ตรงกับบิล")
    })
  })
})
