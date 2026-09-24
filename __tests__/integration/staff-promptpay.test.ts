import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { StaffPromptPayQr } from "@/app/actions/payments"
import {
  createTestMenuItem,
  createTestOrder,
  createTestOrderItem,
  createTestSession,
  createTestTable,
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

/// ธนาคาร — mock เฉพาะการยิงออกไปหา SCB และการถอด credential (ร้านทดสอบไม่มี key จริง)
const scbReady = { value: false }
const createQrMock = vi.fn()
vi.mock("@/lib/scb-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scb-store")>()
  return {
    ...actual,
    isStoreScbReady: async () => scbReady.value,
    getStoreScb: async () => (scbReady.value ? { creds: { base: "x", key: "k", secret: "s", billerId: "b", ref3Prefix: "T" }, source: "store", verifiedAt: new Date() } : null),
  }
})
vi.mock("@/lib/payment-provider/scb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment-provider/scb")>()
  return { ...actual, createQrCode: (...args: unknown[]) => createQrMock(...args) }
})

const dbReady = await isTestDbReachable()

/// ปิดบิลด้วยพร้อมเพย์ต้องแสดง QR ก่อน (20f — เจ้าของเจอ 2026-09-24 ว่ากดแล้วปิดบิลเลยโดยไม่มี QR)
///
/// สิ่งที่ต้องพิสูจน์: ออก QR แล้วบิลยังไม่ปิด · ยอดคิดที่ server รวมค่าบริการ · ร้านไม่มีเลขพร้อมเพย์ถูกปฏิเสธ ·
/// โหมด SCB ออก QR ธนาคารพก ref1 และกดซ้ำได้ intent ใบเดิม · บิลของร้านอื่น/บิลที่ปิดแล้วไม่ได้
describe.skipIf(!dbReady)("ปิดบิลพร้อมเพย์ — แสดง QR ก่อน (20f)", () => {
  let prepareStaffPromptPay: (formData: FormData) => Promise<ActionResult<StaffPromptPayQr>>
  let getStaffBillStatus: (formData: FormData) => Promise<ActionResult<{ closed: boolean; saleNumber: string | null }>>
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment

  beforeAll(async () => {
    const payments = await import("@/app/actions/payments")
    prepareStaffPromptPay = payments.prepareStaffPromptPay
    getStaffBillStatus = payments.getStaffBillStatus
    closeSessionWithPayment = (await import("@/lib/close-session")).closeSessionWithPayment
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "10.00" })
    scbReady.value = false
    createQrMock.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// บิล 2 × 100 = 200 + ค่าบริการ 10% = 220
  async function seedBill(storeId = TEST_STORE_ID) {
    const table = await createTestTable(undefined, storeId)
    const session = await createTestSession(table.id)
    const menu = await createTestMenuItem({ name: "ผัดไทย", price: "100.00", storeId })
    const order = await createTestOrder(session.id)
    await createTestOrderItem(order.id, menu.id, { quantity: 2, unitPrice: "100.00" })
    return session.id
  }

  it("ร้านพร้อมเพย์ตรง: ได้ QR ของร้านยอดรวมค่าบริการ และบิลยังไม่ถูกปิด", async () => {
    await testPrisma().storePaymentConfig.create({ data: { storeId: TEST_STORE_ID, promptPayId: "0812345678" } })
    const sessionId = await seedBill()

    const result = await prepareStaffPromptPay(makeFormData({ sessionId }))
    expect(result.ok).toBe(true)
    const qr = result.ok ? result.data : undefined
    expect(qr?.mode).toBe("MANUAL")
    expect(qr?.amount).toBe(220)
    expect(qr?.dataUrl.startsWith("data:image/png;base64,")).toBe(true)
    expect(qr?.maskedId).toBe("081xxxx678")

    // ★ แค่ออก QR — ไม่มีบิล ไม่ปิดโต๊ะ
    expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("OPEN")
    expect(await testPrisma().sale.count()).toBe(0)
    const status = await getStaffBillStatus(makeFormData({ sessionId }))
    expect(status.ok && status.data).toEqual({ closed: false, saleNumber: null })
  })

  it("ร้านยังไม่ตั้งเลขพร้อมเพย์ = ปฏิเสธพร้อมบอกทางไปตั้งค่า", async () => {
    const sessionId = await seedBill()
    const result = await prepareStaffPromptPay(makeFormData({ sessionId }))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("ตั้งค่าร้าน")
  })

  it("ร้านโหมด SCB: QR ธนาคารพก ref1 · กดซ้ำได้ intent ใบเดิม · ปิดบิลแล้วสถานะบอกว่าปิด", async () => {
    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "SCB_BILLER" } })
    scbReady.value = true
    createQrMock.mockResolvedValue({ ok: true, data: "00020101021230SCBQRPAYLOAD" })
    const sessionId = await seedBill()

    const first = await prepareStaffPromptPay(makeFormData({ sessionId }))
    const second = await prepareStaffPromptPay(makeFormData({ sessionId }))
    expect(first.ok && first.data?.mode).toBe("AUTO")
    expect(first.ok && first.data?.ref1).toBeTruthy()
    expect(second.ok && second.data?.ref1).toBe(first.ok ? first.data?.ref1 : "")
    expect(createQrMock).toHaveBeenCalledWith(expect.anything(), { amount: 220, ref1: first.ok ? first.data?.ref1 : "" })
    expect(await testPrisma().paymentIntent.count({ where: { tableSessionId: sessionId, status: "PENDING" } })).toBe(1)

    // จำลอง callback ปิดบิล → หน้าจอถามสถานะแล้วได้เลขบิล
    const closed = await closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId, paymentMethod: "PROMPTPAY", cashierId: "owner" })
    expect(closed.ok).toBe(true)
    const status = await getStaffBillStatus(makeFormData({ sessionId }))
    expect(status.ok && status.data?.closed).toBe(true)
    expect(status.ok && status.data?.saleNumber).toBeTruthy()
  })

  it("ธนาคารออก QR ไม่ได้ = ถอยไปใช้พร้อมเพย์ของร้าน (พนักงานกดยืนยันเอง)", async () => {
    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "SCB_BILLER" } })
    await testPrisma().storePaymentConfig.create({ data: { storeId: TEST_STORE_ID, promptPayId: "0812345678" } })
    scbReady.value = true
    createQrMock.mockResolvedValue({ ok: false, error: "ธนาคารล่ม" })
    const sessionId = await seedBill()

    const result = await prepareStaffPromptPay(makeFormData({ sessionId }))
    expect(result.ok && result.data?.mode).toBe("MANUAL")
  })

  it("บิลของร้านอื่น / บิลที่ปิดแล้ว ออก QR ไม่ได้", async () => {
    await testPrisma().storePaymentConfig.create({ data: { storeId: TEST_STORE_ID, promptPayId: "0812345678" } })
    await ensureTestStore({ id: OTHER_STORE_ID, slug: "test-b", name: "ร้าน B" })
    const otherSession = await seedBill(OTHER_STORE_ID)
    expect((await prepareStaffPromptPay(makeFormData({ sessionId: otherSession }))).ok).toBe(false)
    expect((await getStaffBillStatus(makeFormData({ sessionId: otherSession }))).ok).toBe(false)

    const sessionId = await seedBill()
    await closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId, paymentMethod: "CASH", cashierId: "owner" })
    const afterClose = await prepareStaffPromptPay(makeFormData({ sessionId }))
    expect(afterClose.ok === false && afterClose.error).toContain("ปิด")
  })
})
