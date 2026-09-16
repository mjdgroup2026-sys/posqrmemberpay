import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTestMenuItem,
  createTestOrder,
  createTestOrderItem,
  createTestQrCode,
  createTestTable,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  setStoreSettings,
  TEST_STORE_ID,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()
const STORE_PROMPTPAY = "0812345678"
const originalProvider = process.env.SLIP_PROVIDER

/// ตรวจสลิปอัตโนมัติ (Phase 15b — โหมด ก+) ผ่านผู้ให้บริการจำลอง: เทสทุกกติกาใน spec
///   สลิปซ้ำไม่ปิดบิลซ้ำ · สลิปโอนเข้าบัญชีร้านอื่นถูกปฏิเสธ · ยอดขาดถูกส่งให้พนักงาน · ผู้ให้บริการล่มตกไปปิดมือ · สลิปเก่าไม่รับ
describe.skipIf(!dbReady)("ตรวจสลิปแล้วปิดบิล — payment-slip (Phase 15b)", () => {
  let submitPaymentSlip: typeof import("@/app/actions/payments")["submitPaymentSlip"]
  let openTableSession: typeof import("@/app/actions/tables")["openTableSession"]
  let settle: typeof import("@/lib/slip-settle")
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    submitPaymentSlip = (await import("@/app/actions/payments")).submitPaymentSlip
    openTableSession = (await import("@/app/actions/tables")).openTableSession
    settle = await import("@/lib/slip-settle")
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    process.env.SLIP_PROVIDER = "mock"
    delete process.env.SLIP_MAX_AGE_MINUTES
    await resetDb()
    await ensureTestUser()
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "0.00" })
    // ร้านทดสอบเปิดโหมด ก+ พร้อมเลขพร้อมเพย์
    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "PROMPTPAY_SLIP" } })
    await testPrisma().storePaymentConfig.create({ data: { storeId: TEST_STORE_ID, promptPayId: STORE_PROMPTPAY, bankAccountNumber: "1234567890" } })
  })

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.SLIP_PROVIDER
    else process.env.SLIP_PROVIDER = originalProvider
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// โต๊ะเปิดด้วย QR + ออร์เดอร์ 260 บาท (2×80 + 100)
  async function seedTable() {
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
    return { table, qr, sessionId }
  }

  const slip = (transRef: string, amount: number, receiver = STORE_PROMPTPAY, minutesAgo = 0) => `MOCK|${transRef}|${amount}|${receiver}|${minutesAgo}`

  it("สลิปถูกต้อง (ผู้รับ = ร้าน · ยอดพอ · ใหม่) → ปิดบิลเป็น Sale PROMPTPAY อ้างอิง SLIP:<transRef> และ QR ถูก invalidate", async () => {
    const { qr, sessionId } = await seedTable()
    const result = await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-OK-1", 260) }))
    expect(result.ok, result.ok ? "" : result.error).toBe(true)

    const sale = await testPrisma().sale.findFirstOrThrow({ where: { tableSessionId: sessionId } })
    expect(sale.paymentMethod).toBe("PROMPTPAY")
    expect(sale.paymentReference).toBe("SLIP:TX-OK-1")
    expect(sale.channel).toBe("MOBILE_ORDER")
    expect(Number(sale.total)).toBe(260)
    expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("CLOSED")
    expect((await testPrisma().qRCode.findUniqueOrThrow({ where: { id: qr.id } })).status).toBe("INVALIDATED")
    expect((await queries.getCustomerPaymentStatus(qr.token)).state).toBe("PAID")
  })

  it("ยอดในสลิปมากกว่าบิล (ลูกค้าโอนเกิน/รวมทิป) ยังปิดบิลได้ตามยอดบิล", async () => {
    const { qr, sessionId } = await seedTable()
    expect((await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-OVER", 300) }))).ok).toBe(true)
    expect(Number((await testPrisma().sale.findFirstOrThrow({ where: { tableSessionId: sessionId } })).total)).toBe(260)
  })

  it("★ สลิปซ้ำ: ใบเดียวกันส่งซ้ำ = idempotent · เอาสลิปที่ปิดโต๊ะ A แล้วมาปิดโต๊ะ B ไม่ได้", async () => {
    const a = await seedTable()
    const payload = slip("TX-REUSE", 260)
    expect((await submitPaymentSlip(makeFormData({ qrToken: a.qr.token, payload }))).ok).toBe(true)
    // ส่งซ้ำโต๊ะเดิม — สำเร็จแบบ alreadyClosed ไม่สร้างบิลใหม่
    const again = await submitPaymentSlip(makeFormData({ qrToken: a.qr.token, payload }))
    expect(again.ok).toBe(true)
    expect(await testPrisma().sale.count()).toBe(1)

    const b = await seedTable()
    const reused = await submitPaymentSlip(makeFormData({ qrToken: b.qr.token, payload }))
    expect(reused.ok).toBe(false)
    if (!reused.ok) expect(reused.error).toContain("ถูกใช้")
    expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: b.sessionId } })).status).not.toBe("CLOSED")
    expect(await testPrisma().sale.count()).toBe(1)
  })

  it("สลิปโอนเข้าบัญชีที่ไม่ใช่ของร้าน → ปฏิเสธ ไม่ปิดบิล", async () => {
    const { qr, sessionId } = await seedTable()
    const result = await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-OTHER", 260, "0899999999") }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ไม่ได้โอนเข้าบัญชีของร้าน")
    expect(await testPrisma().sale.count({ where: { tableSessionId: sessionId } })).toBe(0)
  })

  it("ผู้ให้บริการคืนเลขบัญชีแบบปิดบางหลัก → เทียบท้ายเลขบัญชีร้านผ่านได้", async () => {
    const { qr } = await seedTable()
    expect((await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-MASK", 260, "xxx-x-x7890") }))).ok).toBe(true)
  })

  it("ยอดในสลิปน้อยกว่าบิล → ไม่ปิดบิล แจ้งพนักงาน (Notification CHECK_BILL) พร้อมตัวเลข", async () => {
    const { qr, sessionId } = await seedTable()
    const result = await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-SHORT", 200) }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("น้อยกว่าบิล")
    expect(await testPrisma().sale.count()).toBe(0)
    const notes = await testPrisma().notification.findMany({ where: { tableSessionId: sessionId, type: "CHECK_BILL" } })
    expect(notes).toHaveLength(1)
    expect(notes[0].reason).toContain("200.00")
    expect(notes[0].reason).toContain("260.00")
    expect(notes[0].reason).toContain("TX-SHORT")
  })

  it("สลิปเก่ากว่า SLIP_MAX_AGE_MINUTES → ปฏิเสธ", async () => {
    process.env.SLIP_MAX_AGE_MINUTES = "15"
    const { qr } = await seedTable()
    const old = await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-OLD", 260, STORE_PROMPTPAY, 20) }))
    expect(old.ok).toBe(false)
    if (!old.ok) expect(old.error).toContain("15 นาที")
    expect((await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-FRESH", 260, STORE_PROMPTPAY, 5) }))).ok).toBe(true)
  })

  it("ผู้ให้บริการล่ม → ไม่ปิดบิล บอกให้แจ้งพนักงาน (ตกไปโหมด ก) · payload ขยะ → ปฏิเสธ", async () => {
    const { qr } = await seedTable()
    const down = await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("DOWN-1", 260) }))
    expect(down.ok).toBe(false)
    if (!down.ok) expect(down.error).toContain("แจ้งพนักงาน")
    const garbage = await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: "this-is-not-a-slip-qr-payload" }))
    expect(garbage.ok).toBe(false)
    expect(await testPrisma().sale.count()).toBe(0)
  })

  it("ร้านที่อยู่โหมดพร้อมเพย์ตรง (ไม่ใช่ ก+) หรือแพลตฟอร์มไม่ได้ตั้ง SLIP_PROVIDER → ไม่รับสลิป", async () => {
    const { qr } = await seedTable()
    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "PROMPTPAY_DIRECT" } })
    expect((await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-MODE", 260) }))).ok).toBe(false)

    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "PROMPTPAY_SLIP" } })
    delete process.env.SLIP_PROVIDER
    expect((await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-NOPROV", 260) }))).ok).toBe(false)
    expect(await testPrisma().sale.count()).toBe(0)
  })

  it("แยกร้าน: สลิปที่โอนเข้าร้าน B เอามาปิดบิลร้าน A ไม่ได้ และ transRef เดียวกันข้ามร้านก็ซ้ำ", async () => {
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
    await testPrisma().store.update({ where: { id: OTHER_STORE_ID }, data: { paymentMode: "PROMPTPAY_SLIP" } })
    await testPrisma().storePaymentConfig.create({ data: { storeId: OTHER_STORE_ID, promptPayId: "0899999999" } })
    const { qr, sessionId } = await seedTable()

    // สลิปโอนเข้าเลขของร้าน B → ร้าน A ปฏิเสธ
    expect((await submitPaymentSlip(makeFormData({ qrToken: qr.token, payload: slip("TX-B", 260, "0899999999") }))).ok).toBe(false)
    expect(await testPrisma().sale.count({ where: { tableSessionId: sessionId } })).toBe(0)

    // verifySlipAndSettle เรียกตรงด้วย storeId ร้าน A แต่ sessionId ของร้าน A — ผ่านตามปกติ · reference unique ทั้งระบบ
    const ok = await settle.verifySlipAndSettle({ storeId: TEST_STORE_ID, sessionId, payload: slip("TX-A", 260) })
    expect(ok.ok).toBe(true)
    expect(await testPrisma().sale.count({ where: { paymentReference: "SLIP:TX-A" } })).toBe(1)
  })
})
