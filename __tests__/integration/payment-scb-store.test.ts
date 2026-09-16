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
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

/// mock เฉพาะการยิงธนาคาร — จับ credential ที่ถูกส่งไปด้วย เพื่อพิสูจน์ว่า "ยิงในนามร้านไหน"
const inquireMock = vi.fn()
const createQrMock = vi.fn()
vi.mock("@/lib/payment-provider/scb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment-provider/scb")>()
  return {
    ...actual,
    inquireBillPayment: (...args: unknown[]) => inquireMock(...args),
    createQrCode: (...args: unknown[]) => createQrMock(...args),
  }
})

const dbReady = await isTestDbReachable()
const SCB_ENV_KEYS = ["SCB_API_BASE", "SCB_API_KEY", "SCB_API_SECRET", "SCB_BILLER_ID", "SCB_REF3_PREFIX"] as const
const savedEnv: Record<string, string | undefined> = {}

const STORE_CREDS = { environment: "production", apiKey: "store-key-ABCD", apiSecret: "store-secret-1234", billerId: "123456789012345", ref3Prefix: "MJD" }

/// SCB Biller ต่อร้าน (Phase 15c — โหมด ข): credential เข้ารหัส · ทดสอบด้วย callback 1 บาทก่อนเปิด · webhook ร้าน A ปิดบิลร้าน B ไม่ได้
describe.skipIf(!dbReady)("SCB ต่อร้าน — payment-scb-store (Phase 15c)", () => {
  let scbConfig: typeof import("@/app/actions/scb-config")
  let paymentConfig: typeof import("@/app/actions/payment-config")
  let scbStore: typeof import("@/lib/scb-store")
  let methods: typeof import("@/lib/payment-methods")
  let queries: typeof import("@/lib/queries")
  let issuePaymentIntent: typeof import("@/lib/payment-intent").issuePaymentIntent
  let openTableSession: typeof import("@/app/actions/tables").openTableSession
  let storeWebhook: typeof import("@/app/api/payments/webhook/scb/store/[token]/route").POST

  beforeAll(async () => {
    for (const key of SCB_ENV_KEYS) savedEnv[key] = process.env[key]
    scbConfig = await import("@/app/actions/scb-config")
    paymentConfig = await import("@/app/actions/payment-config")
    scbStore = await import("@/lib/scb-store")
    methods = await import("@/lib/payment-methods")
    queries = await import("@/lib/queries")
    issuePaymentIntent = (await import("@/lib/payment-intent")).issuePaymentIntent
    openTableSession = (await import("@/app/actions/tables")).openTableSession
    storeWebhook = (await import("@/app/api/payments/webhook/scb/store/[token]/route")).POST
  })

  beforeEach(async () => {
    await resetDb()
    inquireMock.mockReset()
    createQrMock.mockReset()
    await ensureTestUser("owner", "เจ้าของร้าน", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestUser("staff", "พนักงาน", { storeId: TEST_STORE_ID, role: "STAFF" })
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
    await ensureTestUser("owner-b", "เจ้าของร้าน B", { storeId: OTHER_STORE_ID, role: "OWNER" })
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "0.00" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterEach(() => {
    for (const key of SCB_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key] as string
    }
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  function clearPlatformEnv() {
    for (const key of SCB_ENV_KEYS) delete process.env[key]
  }

  async function saveStoreCreds(overrides: Partial<typeof STORE_CREDS> = {}) {
    const result = await scbConfig.updateScbCredentials(makeFormData({ ...STORE_CREDS, ...overrides }))
    expect(result.ok, result.ok ? "" : result.error).toBe(true)
    return testPrisma().storePaymentConfig.findUniqueOrThrow({ where: { storeId: TEST_STORE_ID } })
  }

  function callStoreWebhook(token: string, payload: unknown) {
    const request = new Request(`http://localhost/api/payments/webhook/scb/store/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    return storeWebhook(request as never, { params: Promise.resolve({ token }) } as never)
  }

  const confirmation = (ref1: string, transactionId: string, amount = 260) => ({
    payeeProxyId: "123456789012345",
    payeeProxyType: "BILLERID",
    payeeAccountNumber: "xxx",
    payerAccountNumber: "xxx",
    payerName: "ผู้จ่าย",
    sendingBankCode: "014",
    receivingBankCode: "014",
    amount: amount.toFixed(2),
    transactionId,
    transactionDateandTime: "2026-09-16T10:00:00.000+07:00",
    billPaymentRef1: ref1,
    billPaymentRef2: "",
    billPaymentRef3: `MJD${ref1}`,
    currencyCode: "764",
    channelCode: "PMH",
    transactionType: "PAY",
  })

  /// โต๊ะ 260 บาท + intent ในร้านที่ระบุ
  async function seedIntent(storeId: string) {
    const table = await createTestTable(undefined, storeId)
    const qr = await createTestQrCode(table.id, { type: "DYNAMIC", storeId })
    setActiveTestStore(storeId)
    const opened = await openTableSession(makeFormData({ qrToken: qr.token }))
    expect(opened.ok, opened.ok ? "" : opened.error).toBe(true)
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
    const menu = await createTestMenuItem({ name: "ข้าวกะเพรา", price: "80.00", storeId })
    const order = await createTestOrder(sessionId)
    await createTestOrderItem(order.id, menu.id, { quantity: 2, unitPrice: "80.00" })
    const menuB = await createTestMenuItem({ name: "ต้มยำ", price: "100.00", storeId })
    await createTestOrderItem(order.id, menuB.id, { quantity: 1, unitPrice: "100.00" })
    const intent = await issuePaymentIntent(storeId, sessionId, 260)
    setActiveTestStore(TEST_STORE_ID)
    return { sessionId, intent }
  }

  describe("เก็บ credential", () => {
    it("เจ้าของบันทึก → key/secret ถูกเข้ารหัส (ไม่มีข้อความธรรมดาในฐาน) · ได้ webhook token · ยังไม่ verified", async () => {
      const row = await saveStoreCreds()
      expect(row.scbApiKeyEnc).toMatch(/^v1\./)
      expect(row.scbApiSecretEnc).toMatch(/^v1\./)
      expect(JSON.stringify(row)).not.toContain(STORE_CREDS.apiKey)
      expect(JSON.stringify(row)).not.toContain(STORE_CREDS.apiSecret)
      expect(row.scbWebhookToken).toMatch(/^[A-Za-z0-9_-]{40,}$/)
      expect(row.scbVerifiedAt).toBeNull()
      expect(row.scbBillerId).toBe(STORE_CREDS.billerId)

      // ถอดรหัสกลับได้ครบ และ view ไม่คืน secret
      const decoded = scbStore.decodeStoreScb(row)
      expect(decoded?.creds).toMatchObject({ key: STORE_CREDS.apiKey, secret: STORE_CREDS.apiSecret, billerId: STORE_CREDS.billerId, ref3Prefix: "MJD" })
      const view = await queries.getScbConfig(TEST_STORE_ID)
      expect(view).toMatchObject({ configured: true, decryptable: true, apiKeyTail: "…ABCD", environment: "production" })
      expect(JSON.stringify(view)).not.toContain(STORE_CREDS.apiSecret)
    })

    it("เว้นว่าง key/secret ตอนแก้ Biller ID = คงค่าเดิม แต่ verified ถูกรีเซ็ต · token เดิมคงอยู่", async () => {
      const first = await saveStoreCreds()
      await testPrisma().storePaymentConfig.update({ where: { storeId: TEST_STORE_ID }, data: { scbVerifiedAt: new Date() } })
      const second = await saveStoreCreds({ apiKey: "", apiSecret: "", billerId: "999999999999999" })
      expect(second.scbApiKeyEnc).toBe(first.scbApiKeyEnc)
      expect(second.scbWebhookToken).toBe(first.scbWebhookToken)
      expect(second.scbBillerId).toBe("999999999999999")
      expect(second.scbVerifiedAt).toBeNull()
    })

    it("STAFF บันทึกไม่ได้ · ไม่มี PAYMENT_CONFIG_KEY = ปฏิเสธ (fail closed)", async () => {
      setTestUser("staff")
      expect((await scbConfig.updateScbCredentials(makeFormData(STORE_CREDS))).ok).toBe(false)
      setTestUser("owner")
      const key = process.env.PAYMENT_CONFIG_KEY
      delete process.env.PAYMENT_CONFIG_KEY
      try {
        expect((await scbConfig.updateScbCredentials(makeFormData(STORE_CREDS))).ok).toBe(false)
      } finally {
        process.env.PAYMENT_CONFIG_KEY = key
      }
      expect(await testPrisma().storePaymentConfig.count()).toBe(0)
    })
  })

  describe("getStoreScb — เลือก credential", () => {
    it("ร้านที่ยังไม่ผ่านการทดสอบ → ใช้ env ของแพลตฟอร์ม (fallback) · ไม่มี env = null · allowUnverified ได้ของร้าน", async () => {
      await saveStoreCreds()
      expect((await scbStore.getStoreScb(TEST_STORE_ID))?.source).toBe("env")
      expect((await scbStore.getStoreScb(TEST_STORE_ID, { allowUnverified: true }))?.source).toBe("store")
      clearPlatformEnv()
      expect(await scbStore.getStoreScb(TEST_STORE_ID)).toBeNull()
      expect(await scbStore.isStoreScbReady(TEST_STORE_ID)).toBe(false)
    })

    it("ผ่านการทดสอบแล้ว → ใช้ของร้าน แม้มี env · profile ของร้านโหมด SCB ปิดบิลเองได้", async () => {
      await saveStoreCreds()
      await testPrisma().storePaymentConfig.update({ where: { storeId: TEST_STORE_ID }, data: { scbVerifiedAt: new Date() } })
      const scb = await scbStore.getStoreScb(TEST_STORE_ID)
      expect(scb?.source).toBe("store")
      expect(scb?.creds.billerId).toBe(STORE_CREDS.billerId)

      await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "SCB_BILLER" } })
      clearPlatformEnv()
      expect(await methods.getStorePaymentProfile(TEST_STORE_ID)).toMatchObject({ mode: "SCB_BILLER", autoSettle: true, qrAvailable: true })
    })
  })

  describe("ทดสอบการเชื่อมต่อ (QR 1 บาท → callback ต่อร้าน)", () => {
    it("ออก QR ด้วย credential ของร้าน → callback เข้า token ของร้าน → ธนาคารยืนยัน 1 บาท → scbVerifiedAt ประทับ · โหมด SCB เลือกได้", async () => {
      const row = await saveStoreCreds()
      createQrMock.mockResolvedValue({ ok: true, data: "00020101021230TESTPAYLOAD" })

      const started = await scbConfig.startScbConnectionTest()
      expect(started.ok, started.ok ? "" : started.error).toBe(true)
      const ref1 = started.ok ? started.data!.ref1 : ""
      expect(ref1).toMatch(/^T[2-9A-HJ-NP-Z]{11}$/)
      // ยิงธนาคารในนามร้าน (Biller ID ของร้าน) ไม่ใช่แพลตฟอร์ม
      expect(createQrMock.mock.calls[0][0]).toMatchObject({ billerId: STORE_CREDS.billerId, key: STORE_CREDS.apiKey })
      expect(createQrMock.mock.calls[0][1]).toMatchObject({ amount: 1, ref1 })

      const pending = await scbConfig.getScbTestStatus()
      expect(pending.ok && pending.data?.pendingRef1).toBe(ref1)

      inquireMock.mockResolvedValue({ ok: true, data: { transactionId: "SCBTX-TEST-1", amount: 1, billPaymentRef1: ref1 } })
      const response = await callStoreWebhook(row.scbWebhookToken as string, confirmation(ref1, "SCBTX-TEST-1", 1))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ resCode: "00", confirmId: "SCB-TEST" })
      expect(inquireMock.mock.calls[0][0]).toMatchObject({ billerId: STORE_CREDS.billerId })

      const after = await testPrisma().storePaymentConfig.findUniqueOrThrow({ where: { storeId: TEST_STORE_ID } })
      expect(after.scbVerifiedAt).not.toBeNull()
      expect(after.scbTestRef1).toBeNull()

      // เจ้าของเลือกโหมด SCB เองได้แล้ว
      const switched = await paymentConfig.updatePaymentConfig(makeFormData({ paymentMode: "SCB_BILLER", promptPayId: "0812345678" }))
      expect(switched.ok, switched.ok ? "" : switched.error).toBe(true)
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).paymentMode).toBe("SCB_BILLER")
    })

    it("ธนาคารไม่ยืนยันรายการทดสอบ → ไม่ประทับ · เจ้าของยังเปิดโหมด SCB เองไม่ได้", async () => {
      const row = await saveStoreCreds()
      createQrMock.mockResolvedValue({ ok: true, data: "PAYLOAD" })
      const started = await scbConfig.startScbConnectionTest()
      const ref1 = started.ok ? started.data!.ref1 : ""
      inquireMock.mockResolvedValue({ ok: false, error: "ธนาคารไม่พบรายการ" })
      const response = await callStoreWebhook(row.scbWebhookToken as string, confirmation(ref1, "SCBTX-NOPE", 1))
      expect(await response.json()).toMatchObject({ resCode: "99" })
      expect((await testPrisma().storePaymentConfig.findUniqueOrThrow({ where: { storeId: TEST_STORE_ID } })).scbVerifiedAt).toBeNull()

      clearPlatformEnv()
      expect((await paymentConfig.updatePaymentConfig(makeFormData({ paymentMode: "SCB_BILLER", promptPayId: "0812345678" }))).ok).toBe(false)
    })

    it("ถอด SCB ออก → credential หาย และร้านที่อยู่โหมด SCB กลับเป็นพร้อมเพย์ตรง", async () => {
      await saveStoreCreds()
      await testPrisma().storePaymentConfig.update({ where: { storeId: TEST_STORE_ID }, data: { scbVerifiedAt: new Date() } })
      await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "SCB_BILLER" } })
      expect((await scbConfig.clearScbCredentials()).ok).toBe(true)
      const row = await testPrisma().storePaymentConfig.findUniqueOrThrow({ where: { storeId: TEST_STORE_ID } })
      expect(row.scbApiKeyEnc).toBeNull()
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).paymentMode).toBe("PROMPTPAY_DIRECT")
    })
  })

  describe("webhook ต่อร้าน — ปิดบิลได้เฉพาะโต๊ะของร้านเจ้าของ token", () => {
    async function verifiedStore() {
      const row = await saveStoreCreds()
      await testPrisma().storePaymentConfig.update({ where: { storeId: TEST_STORE_ID }, data: { scbVerifiedAt: new Date() } })
      await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "SCB_BILLER" } })
      return row.scbWebhookToken as string
    }

    it("token ร้าน A + intent ร้าน A → ถามธนาคารด้วย credential ของ A แล้วปิดบิล", async () => {
      const token = await verifiedStore()
      const { sessionId, intent } = await seedIntent(TEST_STORE_ID)
      inquireMock.mockResolvedValue({ ok: true, data: { transactionId: "SCBTX-A", amount: 260, billPaymentRef1: intent.ref1 } })
      const response = await callStoreWebhook(token, confirmation(intent.ref1, "SCBTX-A"))
      expect(await response.json()).toMatchObject({ resCode: "00" })
      expect(inquireMock.mock.calls[0][0]).toMatchObject({ billerId: STORE_CREDS.billerId, key: STORE_CREDS.apiKey })
      expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("CLOSED")
    })

    it("★ token ร้าน A + intent ของร้าน B → ปฏิเสธโดยไม่ถามธนาคาร โต๊ะ B ยังเปิด", async () => {
      const token = await verifiedStore()
      const { sessionId, intent } = await seedIntent(OTHER_STORE_ID)
      const response = await callStoreWebhook(token, confirmation(intent.ref1, "SCBTX-B"))
      expect(await response.json()).toMatchObject({ resCode: "99" })
      expect(inquireMock).not.toHaveBeenCalled()
      expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("OPEN")
      expect(await testPrisma().sale.count()).toBe(0)
    })

    it("token ที่ไม่มีอยู่ → 401 · ร้านถูกระงับ → ปฏิเสธ", async () => {
      const token = await verifiedStore()
      expect((await callStoreWebhook("no-such-token", confirmation("X", "Y"))).status).toBe(401)
      await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { status: "SUSPENDED" } })
      expect(await (await callStoreWebhook(token, confirmation("X", "Y"))).json()).toMatchObject({ resCode: "99" })
      expect(inquireMock).not.toHaveBeenCalled()
    })
  })
})
