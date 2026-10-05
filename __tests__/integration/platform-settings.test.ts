import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()
const { updatePlatformPromptPay } = await import("@/app/actions/platform-settings")
const { getPlatformPromptPay, platformPromptPayQr } = await import("@/lib/platform-settings")

/// พร้อมเพย์ของแพลตฟอร์ม (2026-10-05) — เลขนี้กำหนดว่าเงินค่าใช้งานของทุกร้านเข้าบัญชีไหน แก้ได้เฉพาะผู้ดูแลแพลตฟอร์ม
describe.skipIf(!dbReady)("ตั้งค่าแพลตฟอร์ม: พร้อมเพย์รับค่าใช้งาน", () => {
  const savedEnv = process.env.PLATFORM_PROMPTPAY_ID

  beforeEach(async () => {
    await resetDb()
    delete process.env.PLATFORM_PROMPTPAY_ID
    await ensureTestUser("owner", "เจ้าของร้าน", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestUser("platform", "ทีมแพลตฟอร์ม", { storeId: null, isPlatformAdmin: true })
    setActiveTestStore(TEST_STORE_ID)
    setTestUser("platform")
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.PLATFORM_PROMPTPAY_ID
    else process.env.PLATFORM_PROMPTPAY_ID = savedEnv
    setTestUser("test-user")
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const save = (promptPayId: string, promptPayName = "บจก. เอ็มเจดี") =>
    updatePlatformPromptPay(makeFormData({ promptPayId, promptPayName }))

  it("เจ้าของร้าน / ผู้ไม่ล็อกอิน แก้ไม่ได้", async () => {
    setTestUser("owner")
    expect((await save("0812345678")).ok).toBe(false)
    setTestUser(null)
    expect((await save("0812345678")).ok).toBe(false)
    expect(await testPrisma().platformSetting.count()).toBe(0)
  })

  it("ผู้ดูแลบันทึกได้ — เก็บตัวเลขล้วน + ผู้แก้ล่าสุด · หน้า billing ได้ QR ตามยอด", async () => {
    const result = await save("081-234-5678")
    expect(result.ok).toBe(true)

    const row = await testPrisma().platformSetting.findUniqueOrThrow({ where: { id: "platform" } })
    expect(row.promptPayId).toBe("0812345678")
    expect(row.updatedById).toBe("platform")

    const platform = await getPlatformPromptPay()
    expect(platform).toMatchObject({ promptPayId: "0812345678", promptPayName: "บจก. เอ็มเจดี", source: "db", updatedByName: "ทีมแพลตฟอร์ม" })
    expect(await platformPromptPayQr(300, platform)).toMatch(/^data:image\/png;base64,/)
  })

  it("เลขผิดรูปแบบ / ไม่มีชื่อบัญชี ถูกปฏิเสธ", async () => {
    expect((await save("12345")).ok).toBe(false)
    expect((await save("0812345678", "")).ok).toBe(false)
    expect(await testPrisma().platformSetting.count()).toBe(0)
  })

  it("ค่าในฐานชนะ env · ล้างเลขแล้วกลับไปใช้ env · ไม่มีทั้งคู่ = null", async () => {
    process.env.PLATFORM_PROMPTPAY_ID = "0899999999"
    expect(await getPlatformPromptPay()).toMatchObject({ promptPayId: "0899999999", source: "env" })

    await save("0812345678")
    expect(await getPlatformPromptPay()).toMatchObject({ promptPayId: "0812345678", source: "db" })

    expect((await save("", "")).ok).toBe(true)
    expect(await getPlatformPromptPay()).toMatchObject({ promptPayId: "0899999999", source: "env" })

    delete process.env.PLATFORM_PROMPTPAY_ID
    expect(await getPlatformPromptPay()).toBeNull()
    expect(await platformPromptPayQr(300, null)).toBeNull()
  })
})
