import { vi } from "vitest"
import { storeErrorMessage } from "@/lib/store-errors"
import { isPlanActive } from "@/lib/subscription"
import { testPrisma } from "./db"

/// mock ของ `@/lib/session` ที่ใช้ร่วมกันทุก integration test (Phase 13)
///
/// ต่างจาก mock เดิมที่คืน user คงที่: ตัวนี้ **อ่าน StoreMember จากฐานเทสจริง** จึงได้ตรรกะ
/// ร้าน/บทบาทเหมือน production ทุกประการ — เทสแยกร้าน (tenant-isolation) สลับได้ทั้ง "ใครล็อกอิน"
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

async function resolveStoreContext() {
  if (!currentUserId) return { ok: false as const, reason: "UNAUTHENTICATED" as const, memberships: [] }
  const db = testPrisma()
  const user = await db.user.findUnique({
    where: { id: currentUserId },
    select: {
      id: true,
      name: true,
      email: true,
      isPlatformAdmin: true,
      storeMemberships: {
        orderBy: { createdAt: "asc" },
        select: {
          storeId: true,
          role: true,
          roleId: true,
          store: {
            select: { id: true, slug: true, name: true, status: true, planTier: true, tableLimit: true, planExpiresAt: true },
          },
        },
      },
    },
  })
  if (!user) return { ok: false as const, reason: "UNAUTHENTICATED" as const, memberships: [] }

  const memberships = user.storeMemberships.map((m) => ({
    storeId: m.storeId,
    slug: m.store.slug,
    name: m.store.name,
    status: m.store.status,
    role: m.role,
  }))
  if (memberships.length === 0) return { ok: false as const, reason: "NO_STORE" as const, memberships }

  const membership = user.storeMemberships.find((m) => m.storeId === currentStoreId) ?? user.storeMemberships[0]
  if (membership.store.status === "SUSPENDED") {
    return { ok: false as const, reason: "STORE_SUSPENDED" as const, memberships }
  }

  return {
    ok: true as const,
    context: {
      user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
      storeId: membership.storeId,
      store: { id: membership.store.id, slug: membership.store.slug, name: membership.store.name, status: membership.store.status },
      plan: { tier: membership.store.planTier, tableLimit: membership.store.tableLimit, expiresAt: membership.store.planExpiresAt },
      role: membership.role,
      permissionRoleId: membership.roleId,
      memberships,
    },
  }
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
