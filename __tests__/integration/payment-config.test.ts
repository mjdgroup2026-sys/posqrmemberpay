import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  TEST_STORE_ID,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

const SCB_KEYS = ["SCB_API_BASE", "SCB_API_KEY", "SCB_API_SECRET", "SCB_BILLER_ID"] as const
const originalEnv: Record<string, string | undefined> = {}
for (const key of SCB_KEYS) originalEnv[key] = process.env[key]
function setScbEnv(on: boolean) {
  if (on) {
    process.env.SCB_API_BASE = "https://api-sandbox.partners.scb/partners/sandbox"
    process.env.SCB_API_KEY = "test-key"
    process.env.SCB_API_SECRET = "test-secret"
    process.env.SCB_BILLER_ID = "048233443520805"
  } else {
    for (const key of SCB_KEYS) delete process.env[key]
  }
}

/// ตั้งค่ารับเงินต่อร้าน (Phase 15a) — เงินต้องเข้าบัญชี "ของร้านนั้น": ร้าน B ต้องไม่ได้ QR ของร้าน A
/// และโหมด SCB (credential ของแพลตฟอร์มในเฟสนี้) ต้องเปิดโดยผู้ดูแลเท่านั้น
describe.skipIf(!dbReady)("บัญชีรับเงินของร้าน — payment-config (Phase 15a)", () => {
  let actions: typeof import("@/app/actions/payment-config")
  let admin: typeof import("@/app/actions/admin")
  let billing: typeof import("@/app/actions/billing")
  let methods: typeof import("@/lib/payment-methods")
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    actions = await import("@/app/actions/payment-config")
    admin = await import("@/app/actions/admin")
    billing = await import("@/app/actions/billing")
    methods = await import("@/lib/payment-methods")
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    setScbEnv(false)
    await ensureTestStore({ id: TEST_STORE_ID })
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
    await ensureTestUser("owner", "เจ้าของร้าน", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestUser("staff", "พนักงาน", { storeId: TEST_STORE_ID, role: "STAFF" })
    await ensureTestUser("owner-b", "เจ้าของร้าน B", { storeId: OTHER_STORE_ID, role: "OWNER" })
    await ensureTestUser("platform", "ทีมแพลตฟอร์ม", { storeId: null, isPlatformAdmin: true })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterEach(() => {
    for (const key of SCB_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key] as string
    }
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  describe("เจ้าของร้านตั้งค่า", () => {
    it("บันทึกเลขพร้อมเพย์ (normalize) + ชื่อ/เลขบัญชี → ลูกค้ากด QR ได้ พนักงานกดยืนยัน", async () => {
      const result = await actions.updatePaymentConfig(
        makeFormData({ paymentMode: "PROMPTPAY_DIRECT", promptPayId: "081-234-5678", accountName: "ร้านทดสอบ", bankAccountNumber: "123-4-56789-0" }),
      )
      expect(result.ok, result.ok ? "" : result.error).toBe(true)

      const config = await queries.getPaymentConfig(TEST_STORE_ID)
      expect(config).toMatchObject({ paymentMode: "PROMPTPAY_DIRECT", promptPayId: "0812345678", accountName: "ร้านทดสอบ", bankAccountNumber: "123-4-56789-0" })

      const profile = await methods.getStorePaymentProfile(TEST_STORE_ID)
      expect(profile).toMatchObject({ mode: "PROMPTPAY_DIRECT", promptPayId: "0812345678", qrAvailable: true, autoSettle: false })
    })

    it("ร้านที่ยังไม่กรอกเลข = ลูกค้ากด QR ไม่ได้ · เลขรูปแบบผิดถูกปฏิเสธ · โหมดพร้อมเพย์ตรงต้องมีเลข", async () => {
      expect((await methods.getStorePaymentProfile(TEST_STORE_ID)).qrAvailable).toBe(false)

      const bad = await actions.updatePaymentConfig(makeFormData({ paymentMode: "PROMPTPAY_DIRECT", promptPayId: "12345" }))
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.fieldErrors?.promptPayId).toBeTruthy()

      const empty = await actions.updatePaymentConfig(makeFormData({ paymentMode: "PROMPTPAY_DIRECT", promptPayId: "" }))
      expect(empty.ok).toBe(false)
      expect(await testPrisma().storePaymentConfig.count()).toBe(0)
    })

    it("พนักงาน (STAFF) ตั้งค่ารับเงินไม่ได้", async () => {
      setTestUser("staff")
      const result = await actions.updatePaymentConfig(makeFormData({ paymentMode: "PROMPTPAY_DIRECT", promptPayId: "0812345678" }))
      expect(result.ok).toBe(false)
      expect(await testPrisma().storePaymentConfig.count()).toBe(0)
    })

    it("เจ้าของเลือกโหมดตรวจสลิป (15b) หรือ SCB เองไม่ได้ — โหมดบน Store ต้องไม่เปลี่ยน", async () => {
      const slip = await actions.updatePaymentConfig(makeFormData({ paymentMode: "PROMPTPAY_SLIP", promptPayId: "0812345678" }))
      expect(slip.ok).toBe(false)
      const scb = await actions.updatePaymentConfig(makeFormData({ paymentMode: "SCB_BILLER", promptPayId: "0812345678" }))
      expect(scb.ok).toBe(false)
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).paymentMode).toBe("PROMPTPAY_DIRECT")
    })

    it("ร้านที่ผู้ดูแลตั้ง SCB ไว้ยังบันทึกเลขพร้อมเพย์สำรองได้ แต่สลับกลับเป็นพร้อมเพย์ตรงเองไม่ได้", async () => {
      await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { paymentMode: "SCB_BILLER" } })
      expect((await actions.updatePaymentConfig(makeFormData({ paymentMode: "SCB_BILLER", promptPayId: "0812345678" }))).ok).toBe(true)
      expect((await actions.updatePaymentConfig(makeFormData({ paymentMode: "PROMPTPAY_DIRECT", promptPayId: "0812345678" }))).ok).toBe(false)
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).paymentMode).toBe("SCB_BILLER")
    })

    it("claimTrial เขียนเลขพร้อมเพย์ลง StorePaymentConfig เดียวกัน (ไม่ใช่ StoreSettings อีกแล้ว)", async () => {
      await ensureTestStore({ id: TEST_STORE_ID, plan: "none" })
      expect((await billing.claimTrial(makeFormData({ promptPayId: "0899999999" }))).ok).toBe(true)
      expect((await queries.getPaymentConfig(TEST_STORE_ID)).promptPayId).toBe("0899999999")
      expect((await methods.getStorePaymentProfile(TEST_STORE_ID)).qrAvailable).toBe(true)
    })
  })

  describe("แยกตามร้าน — เงินต้องเข้าบัญชีของร้านนั้น", () => {
    it("ร้าน A ตั้งพร้อมเพย์แล้ว ร้าน B ยังไม่ได้ → B รับ QR ไม่ได้ และไม่เห็นเลขของ A", async () => {
      expect((await actions.updatePaymentConfig(makeFormData({ paymentMode: "PROMPTPAY_DIRECT", promptPayId: "0812345678" }))).ok).toBe(true)

      const a = await methods.getStorePaymentProfile(TEST_STORE_ID)
      const b = await methods.getStorePaymentProfile(OTHER_STORE_ID)
      expect(a).toMatchObject({ promptPayId: "0812345678", qrAvailable: true })
      expect(b).toMatchObject({ promptPayId: null, qrAvailable: false })
      expect((await queries.getPaymentConfig(OTHER_STORE_ID)).promptPayId).toBeNull()
    })

    it("SCB ของแพลตฟอร์มตั้งครบ แต่มีผลเฉพาะร้านที่ผู้ดูแลตั้งโหมด SCB_BILLER — ร้านอื่นยังต้องใช้เลขของตัวเอง", async () => {
      setScbEnv(true)
      setTestUser("platform")
      expect((await admin.setStorePaymentMode(makeFormData({ storeId: TEST_STORE_ID, paymentMode: "SCB_BILLER" }))).ok).toBe(true)

      expect(await methods.getStorePaymentProfile(TEST_STORE_ID)).toMatchObject({ mode: "SCB_BILLER", qrAvailable: true, autoSettle: true })
      // ร้าน B ไม่มีเลขพร้อมเพย์และไม่ได้อยู่โหมด SCB → ต้องไม่ได้ QR ของแพลตฟอร์มไป (บั๊กก่อน Phase 15)
      expect(await methods.getStorePaymentProfile(OTHER_STORE_ID)).toMatchObject({ mode: "PROMPTPAY_DIRECT", qrAvailable: false, autoSettle: false })
    })
  })

  describe("ผู้ดูแลแพลตฟอร์มตั้งโหมด", () => {
    it("เปิด SCB ได้เฉพาะเมื่อ env ครบ · ตรวจสลิปยังเปิดไม่ได้ · เจ้าของร้าน/พนักงานเรียกไม่ได้", async () => {
      setTestUser("platform")
      expect((await admin.setStorePaymentMode(makeFormData({ storeId: TEST_STORE_ID, paymentMode: "SCB_BILLER" }))).ok).toBe(false)
      expect((await admin.setStorePaymentMode(makeFormData({ storeId: TEST_STORE_ID, paymentMode: "PROMPTPAY_SLIP" }))).ok).toBe(false)

      setScbEnv(true)
      expect((await admin.setStorePaymentMode(makeFormData({ storeId: TEST_STORE_ID, paymentMode: "SCB_BILLER" }))).ok).toBe(true)
      // ตั้งซ้ำโหมดเดิม = ไม่มีอะไรเปลี่ยน
      expect((await admin.setStorePaymentMode(makeFormData({ storeId: TEST_STORE_ID, paymentMode: "SCB_BILLER" }))).ok).toBe(false)
      expect((await admin.setStorePaymentMode(makeFormData({ storeId: TEST_STORE_ID, paymentMode: "PROMPTPAY_DIRECT" }))).ok).toBe(true)

      setTestUser("owner")
      expect((await admin.setStorePaymentMode(makeFormData({ storeId: TEST_STORE_ID, paymentMode: "SCB_BILLER" }))).ok).toBe(false)
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).paymentMode).toBe("PROMPTPAY_DIRECT")
    })
  })
})
