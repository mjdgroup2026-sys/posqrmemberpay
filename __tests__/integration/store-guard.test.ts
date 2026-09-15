import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  addTestMember,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

/// เทสนี้ใช้ `lib/session.ts` ตัวจริง (ไม่ mock) — สิ่งที่ mock คือของที่ Next.js ให้มาตอนรันในเซิร์ฟเวอร์:
/// cookie/headers ของคำขอ และ Better Auth ที่บอกว่า "ใครล็อกอินอยู่"
let currentUserId: string | null = "test-user"
let cookieStoreId: string | null = null

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "activeStoreId" && cookieStoreId ? { name, value: cookieStoreId } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}))

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        currentUserId ? { user: { id: currentUserId, name: "ผู้ทดสอบ", email: `${currentUserId}@example.com` } } : null,
      ),
    },
  },
}))

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("requireStore() / requireOwner() — ด่านร้านที่ทำงานอยู่ (Phase 13)", () => {
  let session: typeof import("@/lib/session")
  let updateStoreSettings: (formData: FormData) => Promise<ActionResult>
  let setStoreMemberRole: (formData: FormData) => Promise<ActionResult>
  let removeStoreMember: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    session = await import("@/lib/session")
    updateStoreSettings = (await import("@/app/actions/settings")).updateStoreSettings
    const members = await import("@/app/actions/store-members")
    setStoreMemberRole = members.setStoreMemberRole
    removeStoreMember = members.removeStoreMember
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("test-user", "ผู้ทดสอบ", { role: "OWNER" })
    await ensureTestStore({ id: OTHER_STORE_ID })
    currentUserId = "test-user"
    cookieStoreId = null
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const settingsForm = () =>
    makeFormData({ storeName: "ชื่อใหม่", themeColor: "#123456", serviceChargePercent: "0", hasKDS: "false" })

  describe("cookie activeStoreId เป็นค่าจากเบราว์เซอร์ — เชื่อไม่ได้", () => {
    it("ไม่มี cookie → ใช้ร้านแรกที่เป็นสมาชิก", async () => {
      const ctx = await session.requireStore()
      expect(ctx.storeId).toBe(TEST_STORE_ID)
      expect(ctx.role).toBe("OWNER")
      expect(ctx.user.id).toBe("test-user")
    })

    it("cookie ชี้ร้านที่ไม่ได้เป็นสมาชิก → ต้องไม่ได้ร้านนั้นเด็ดขาด (ตกไปร้านของตัวเอง)", async () => {
      cookieStoreId = OTHER_STORE_ID
      const ctx = await session.requireStore()
      expect(ctx.storeId).toBe(TEST_STORE_ID)
      expect(ctx.memberships.map((m) => m.storeId)).toEqual([TEST_STORE_ID])
    })

    it("cookie ชี้ร้านที่ไม่มีอยู่จริง → ตกไปร้านของตัวเองเช่นกัน", async () => {
      cookieStoreId = "ไม่มีร้านนี้"
      expect((await session.requireStore()).storeId).toBe(TEST_STORE_ID)
    })

    it("อยู่หลายร้าน + cookie ชี้ร้านที่เป็นสมาชิก → ได้ร้านนั้นพร้อมบทบาทของร้านนั้น", async () => {
      await addTestMember("test-user", OTHER_STORE_ID, "STAFF")
      cookieStoreId = OTHER_STORE_ID
      const ctx = await session.requireStore()
      expect(ctx.storeId).toBe(OTHER_STORE_ID)
      expect(ctx.role).toBe("STAFF")
      expect(ctx.memberships).toHaveLength(2)
    })

    it("ถูกถอดออกจากร้านแล้วต้องมีผลทันทีในคำขอถัดไป (ไม่ cache ข้ามคำขอ)", async () => {
      await addTestMember("test-user", OTHER_STORE_ID, "STAFF")
      cookieStoreId = OTHER_STORE_ID
      expect((await session.requireStore()).storeId).toBe(OTHER_STORE_ID)

      await testPrisma().storeMember.delete({
        where: { userId_storeId: { userId: "test-user", storeId: OTHER_STORE_ID } },
      })
      // react `cache()` ผูกกับคำขอ — ใน vitest ไม่มีขอบเขตคำขอ จึงต้อง import โมดูลใหม่แทนคำขอใหม่
      vi.resetModules()
      const fresh = await import("@/lib/session")
      expect((await fresh.requireStore()).storeId).toBe(TEST_STORE_ID)
    })
  })

  describe("ปฏิเสธเมื่อไม่มีสิทธิ์เข้าร้าน", () => {
    it("ยังไม่ล็อกอิน → UNAUTHENTICATED", async () => {
      currentUserId = null
      await expect(session.requireStore()).rejects.toThrow("UNAUTHENTICATED")
      expect(session.storeErrorMessage(new Error("UNAUTHENTICATED"))).toContain("เข้าสู่ระบบ")
    })

    it("ล็อกอินแล้วแต่ไม่ได้อยู่ในร้านใดเลย → NO_STORE", async () => {
      await ensureTestUser("lonely", "คนไม่มีร้าน", { storeId: null })
      currentUserId = "lonely"
      await expect(session.requireStore()).rejects.toThrow("NO_STORE")

      const resolved = await session.resolveStoreContext()
      expect(resolved.ok).toBe(false)
      if (!resolved.ok) expect(resolved.reason).toBe("NO_STORE")
    })

    it("ร้านถูกระงับ (SUSPENDED) → STORE_SUSPENDED แม้เป็น OWNER", async () => {
      await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { status: "SUSPENDED" } })
      await expect(session.requireStore()).rejects.toThrow("STORE_SUSPENDED")

      // action จริงต้องตอบเป็นข้อความไทย ไม่ใช่ 500
      const result = await updateStoreSettings(settingsForm())
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ระงับ")
    })

    it("ร้านที่ถูกระงับยังปรากฏในรายการร้านของผู้ใช้ (ให้ตัวสลับร้านบอกสถานะได้)", async () => {
      await addTestMember("test-user", OTHER_STORE_ID, "STAFF")
      await testPrisma().store.update({ where: { id: OTHER_STORE_ID }, data: { status: "SUSPENDED" } })
      cookieStoreId = OTHER_STORE_ID
      const resolved = await session.resolveStoreContext()
      expect(resolved.ok).toBe(false)
      if (!resolved.ok) {
        expect(resolved.reason).toBe("STORE_SUSPENDED")
        expect(resolved.memberships.find((m) => m.storeId === OTHER_STORE_ID)?.status).toBe("SUSPENDED")
      }
    })
  })

  describe("requireOwner() — STAFF เรียก action ของ OWNER ตรง ๆ ต้องถูกปฏิเสธ", () => {
    beforeEach(async () => {
      await ensureTestUser("staff-1", "พนักงาน", { role: "STAFF" })
      currentUserId = "staff-1"
    })

    it("requireOwner() โยน NOT_OWNER", async () => {
      await expect(session.requireOwner()).rejects.toThrow("NOT_OWNER")
      expect(session.storeErrorMessage(new Error("NOT_OWNER"))).toContain("เจ้าของร้าน")
    })

    it("updateStoreSettings → ok:false และค่าไม่เปลี่ยน", async () => {
      const result = await updateStoreSettings(settingsForm())
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("เจ้าของร้าน")
      const settings = await testPrisma().storeSettings.findUniqueOrThrow({ where: { storeId: TEST_STORE_ID } })
      expect(settings.storeName).not.toBe("ชื่อใหม่")
    })

    it("setStoreMemberRole / removeStoreMember → ok:false และสมาชิกไม่เปลี่ยน", async () => {
      const promote = await setStoreMemberRole(makeFormData({ userId: "staff-1", role: "OWNER" }))
      expect(promote.ok).toBe(false)

      const remove = await removeStoreMember(makeFormData({ userId: "test-user" }))
      expect(remove.ok).toBe(false)

      const members = await testPrisma().storeMember.findMany({ where: { storeId: TEST_STORE_ID } })
      expect(members.find((m) => m.userId === "staff-1")?.role).toBe("STAFF")
      expect(members.find((m) => m.userId === "test-user")?.role).toBe("OWNER")
    })

    it("OWNER ทำได้ตามปกติ", async () => {
      currentUserId = "test-user"
      const result = await setStoreMemberRole(makeFormData({ userId: "staff-1", role: "OWNER" }))
      expect(result.ok).toBe(true)
    })
  })

  describe("requirePlatformAdmin()", () => {
    it("ผู้ใช้ทั่วไป → NOT_PLATFORM_ADMIN · ผู้ดูแลแพลตฟอร์มผ่านโดยไม่ต้องอยู่ร้านใด", async () => {
      await expect(session.requirePlatformAdmin()).rejects.toThrow("NOT_PLATFORM_ADMIN")

      await ensureTestUser("platform-admin", "ผู้ดูแลแพลตฟอร์ม", { storeId: null, isPlatformAdmin: true })
      currentUserId = "platform-admin"
      const admin = await session.requirePlatformAdmin()
      expect(admin.isPlatformAdmin).toBe(true)
      // แกนคนละแกนกับ StoreMember — ไม่ได้อยู่ร้านใด requireStore() ยังปฏิเสธ
      await expect(session.requireStore()).rejects.toThrow("NO_STORE")
    })
  })
})
