import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { disconnectTestDb, isTestDbReachable, testPrisma } from "../helpers/db"

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
}))

const dbReady = await isTestDbReachable()

const VERIFIED = "signup-dup-verified@example.com"
const UNVERIFIED = "signup-dup-unverified@example.com"
const FRESH = "signup-dup-fresh@example.com"
const ALL = [VERIFIED, UNVERIFIED, FRESH]

/// สมัครซ้ำด้วยอีเมลที่มีบัญชีแล้วต้องได้ 422 + code (2026-10-03) — lib/signup-existing.ts + hooks.before ใน lib/auth.ts
/// Better Auth เปิด requireEmailVerification จะตอบ "สำเร็จ" หลอก ๆ ให้อีเมลซ้ำ ผู้ใช้เลยรออีเมลที่ไม่มีวันมา
describe.skipIf(!dbReady)("สมัครด้วยอีเมลที่มีบัญชีอยู่แล้ว", () => {
  let auth: typeof import("@/lib/auth").auth
  const prevSignupOpen = process.env.SIGNUP_OPEN

  async function cleanup() {
    await testPrisma().user.deleteMany({ where: { email: { in: ALL } } })
  }

  async function signUp(email: string) {
    try {
      await auth.api.signUpEmail({ body: { name: "ผู้สมัครซ้ำ", email, password: "password-1234" } })
      return { ok: true as const }
    } catch (e) {
      const err = e as { statusCode?: number; body?: { code?: string } }
      return { ok: false as const, status: err.statusCode, code: err.body?.code }
    }
  }

  beforeAll(async () => {
    process.env.SIGNUP_OPEN = "true"
    ;({ auth } = await import("@/lib/auth"))
  })

  beforeEach(async () => {
    await cleanup()
    const db = testPrisma()
    await db.user.create({ data: { id: "signup-dup-v", name: "ยืนยันแล้ว", email: VERIFIED, emailVerified: true } })
    await db.user.create({ data: { id: "signup-dup-u", name: "ยังไม่ยืนยัน", email: UNVERIFIED, emailVerified: false } })
  })

  afterAll(async () => {
    await cleanup()
    process.env.SIGNUP_OPEN = prevSignupOpen
    await disconnectTestDb()
  })

  it("อีเมลที่ยืนยันแล้ว → 422 EMAIL_ALREADY_REGISTERED และไม่สร้างผู้ใช้ใหม่", async () => {
    const result = await signUp(VERIFIED)
    expect(result).toMatchObject({ ok: false, status: 422, code: "EMAIL_ALREADY_REGISTERED" })
    expect(await testPrisma().user.count({ where: { email: VERIFIED } })).toBe(1)
  })

  it("อีเมลที่ยังไม่ยืนยัน → 422 EMAIL_REGISTERED_UNVERIFIED", async () => {
    const result = await signUp(UNVERIFIED)
    expect(result).toMatchObject({ ok: false, status: 422, code: "EMAIL_REGISTERED_UNVERIFIED" })
  })

  it("ตัวพิมพ์ใหญ่/ช่องว่างต่างกันก็ยังนับเป็นอีเมลเดียวกัน", async () => {
    const result = await signUp(`  ${VERIFIED.toUpperCase()}`)
    expect(result).toMatchObject({ ok: false, status: 422, code: "EMAIL_ALREADY_REGISTERED" })
  })

  it("อีเมลใหม่ยังสมัครได้ตามปกติ", async () => {
    const result = await signUp(FRESH)
    expect(result.ok).toBe(true)
    const user = await testPrisma().user.findFirst({ where: { email: FRESH } })
    expect(user?.emailVerified).toBe(false)
  })
})
