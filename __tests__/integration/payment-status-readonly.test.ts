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

/// ดักการยิงออกไปหาธนาคาร — เทสชุดนี้พิสูจน์ว่า endpoint สถานะ **ไม่เคยเรียกมันเลย**
const inquireMock = vi.fn()
vi.mock("@/lib/payment-provider/scb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment-provider/scb")>()
  return { ...actual, inquireBillPayment: (...args: unknown[]) => inquireMock(...args) }
})

const dbReady = await isTestDbReachable()

/// `/api/order/[qrToken]/payment` ต้องรายงานสถานะอย่างเดียว ห้ามปิดบิลเอง
///
/// เคยมีเวอร์ชันที่ endpoint นี้ถาม `inquireBillPayment` แล้วปิดบิลให้เมื่อเจอเงิน (ตอนที่ callback
/// ของ SCB ยังมาไม่ถึงเลยสักครั้ง) · ถอดออกตามการตัดสินใจ 2026-09-09 ว่าเงินเข้าต้องถูกยืนยัน
/// ด้วย callback ของธนาคารเท่านั้น · เทสชุดนี้กันไม่ให้เส้นทางนั้นแอบกลับเข้ามาโดยไม่ตั้งใจ
describe.skipIf(!dbReady)("endpoint สถานะการชำระเงินของลูกค้า ต้องอ่านอย่างเดียว", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let issuePaymentIntent: typeof import("@/lib/payment-intent").issuePaymentIntent
  let GET: typeof import("@/app/api/order/[qrToken]/payment/route").GET

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const intents = await import("@/lib/payment-intent")
    const route = await import("@/app/api/order/[qrToken]/payment/route")
    openTableSession = tables.openTableSession
    issuePaymentIntent = intents.issuePaymentIntent
    GET = route.GET
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
    return { table, qr, sessionId, intent }
  }

  function poll(qrToken: string) {
    const request = new Request(`http://localhost/api/order/${qrToken}/payment`)
    const context = { params: Promise.resolve({ qrToken }) }
    return GET(request as Parameters<typeof GET>[0], context as Parameters<typeof GET>[1])
  }

  it("ถึงเงินจะเข้าธนาคารแล้ว แต่ยังไม่มี callback → ห้ามปิดบิล และห้ามยิงถามธนาคาร", async () => {
    const db = testPrisma()
    const { table, qr, sessionId, intent } = await seedSessionWithIntent()

    // ธนาคารมีรายการนี้อยู่จริงแล้ว — ถ้า endpoint แอบไปถาม มันจะปิดบิลได้ทันที ซึ่งต้องไม่เกิด
    inquireMock.mockResolvedValue({
      ok: true,
      data: { transactionId: "SCBTX-NO-CALLBACK", amount: 260, billPaymentRef1: intent.ref1 },
    })

    for (let i = 0; i < 5; i++) {
      const body = await (await poll(qr.token)).json()
      expect(body.ok).toBe(true)
      expect(body.status.state).toBe("UNPAID")
    }

    // ★ หัวใจของเทสชุดนี้ — ห้ามมีการยิงออกไปหาธนาคารจาก endpoint สาธารณะนี้เลย
    expect(inquireMock).not.toHaveBeenCalled()

    expect(await db.sale.findFirst({ where: { tableSessionId: sessionId } })).toBeNull()
    expect((await db.tableSession.findUnique({ where: { id: sessionId } }))?.status).not.toBe("CLOSED")
    expect((await db.paymentIntent.findUnique({ where: { id: intent.id } }))?.status).toBe("PENDING")
    expect((await db.table.findUnique({ where: { id: table.id } }))?.status).not.toBe("EMPTY")
  })

  it("รายงานยอดบิลปัจจุบันได้ถูกต้อง รวมรายการที่สั่งเพิ่มทีหลัง", async () => {
    const { qr, sessionId } = await seedSessionWithIntent()

    const before = await (await poll(qr.token)).json()
    expect(before.status.total).toBe(260)

    const extra = await createTestMenuItem({ name: "ข้าวผัดปู", price: "100.00" })
    const order2 = await createTestOrder(sessionId, 2)
    await createTestOrderItem(order2.id, extra.id, { quantity: 1, unitPrice: "100.00" })

    const after = await (await poll(qr.token)).json()
    expect(after.status.total).toBe(360)
  })

  it("บิลถูกปิดไปแล้ว → ตอบ PAID ต่อได้แม้ DYNAMIC QR ถูก invalidate ไปแล้ว", async () => {
    const { qr, sessionId } = await seedSessionWithIntent()

    const closeSession = await import("@/lib/close-session")
    const closed = await closeSession.closeSessionWithPayment({
      storeId: TEST_STORE_ID,
      sessionId,
      paymentMethod: "PROMPTPAY",
      paymentReference: "SCBTX-ALREADY",
      amountReceived: 260,
    })
    expect(closed.ok).toBe(true)

    // รอบโพลรอบที่ทำให้รู้ว่าจ่ายสำเร็จต้องไม่กลายเป็น 404 ไม่งั้นลูกค้าค้างหน้า QR ตลอดไป
    const response = await poll(qr.token)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status.state).toBe("PAID")
    expect(inquireMock).not.toHaveBeenCalled()
  })

  it("qrToken ที่ไม่รู้จัก → 404 และไม่แตะธนาคาร", async () => {
    const response = await poll("ไม่มีโทเคนนี้")
    expect(response.status).toBe(404)
    expect(inquireMock).not.toHaveBeenCalled()
  })
})
