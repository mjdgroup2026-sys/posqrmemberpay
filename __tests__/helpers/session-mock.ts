import { vi } from "vitest"
import { storeErrorMessage } from "@/lib/store-errors"
import { isPlanActive } from "@/lib/subscription"
import { loadStoreContext } from "@/lib/store-context"
import { testPrisma } from "./db"

/// mock ของ `@/lib/session` ที่ใช้ร่วมกันทุก integration test (Phase 13)
///
/// ต่างจาก mock เดิมที่คืน user คงที่: ตัวนี้ **อ่าน StoreMember จากฐานเทสจริงผ่าน loadStoreContext()
/// ตัวเดียวกับ production** จึงได้ตรรกะร้าน/บทบาท (รวมเจ้าของแบรนด์ Phase 14c) เหมือน production ทุกประการ — เทสแยกร้าน (tenant-isolation) สลับได้ทั้ง "ใครล็อกอิน"
/// และ "ทำงานกับร้านไหน" ผ่าน setter ด้านล่าง โดยไม่ต้อง mock next/headers
///
/// ใช้แบบนี้ (factory ต้อง import แบบ dynamic เพราะ vi.mock ถูก hoist):
///   vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

let currentUserId: string | null = "test-user"
let currentStoreId: string | null = null

/// null = ยังไม่ล็อกอิน
export function setTestUser(userId: string | null) {
  currentUserId = userId
}

/// null = ใช้ร้านแรกที่ผู้ใช้เป็นสมาชิก (เหมือนไม่มี cookie)
export function setActiveTestStore(storeId: string | null) {
  currentStoreId = storeId
}

/// ตรรกะเดียวกับ production ทุกบรรทัด — lib/session.ts ก็เรียก loadStoreContext() ตัวนี้ (Phase 14c)
async function resolveStoreContext() {
  return loadStoreContext(testPrisma(), currentUserId, currentStoreId)
}

export function sessionMockModule() {
  return {
    ACTIVE_STORE_COOKIE: "activeStoreId",
    getSession: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
    requireUser: vi.fn(async () => {
      if (!currentUserId) throw new Error("UNAUTHENTICATED")
      const user = await testPrisma().user.findUnique({ where: { id: currentUserId } })
      if (!user) throw new Error("UNAUTHENTICATED")
      return { id: user.id, name: user.name, email: user.email }
    }),
    resolveStoreContext: vi.fn(resolveStoreContext),
    requireStore: vi.fn(async () => {
      const result = await resolveStoreContext()
      if (!result.ok) throw new Error(result.reason)
      return result.context
    }),
    requireSellingStore: vi.fn(async () => {
      const result = await resolveStoreContext()
      if (!result.ok) throw new Error(result.reason)
      if (!isPlanActive(new Date(), result.context.plan.expiresAt)) throw new Error("STORE_EXPIRED")
      return result.context
    }),
    requireOwner: vi.fn(async () => {
      const result = await resolveStoreContext()
      if (!result.ok) throw new Error(result.reason)
      if (result.context.role !== "OWNER") throw new Error("NOT_OWNER")
      return result.context
    }),
    requirePlatformAdmin: vi.fn(async () => {
      if (!currentUserId) throw new Error("UNAUTHENTICATED")
      const user = await testPrisma().user.findUnique({ where: { id: currentUserId } })
      if (!user?.isPlatformAdmin) throw new Error("NOT_PLATFORM_ADMIN")
      return user
    }),
    storeErrorMessage,
  }
}
