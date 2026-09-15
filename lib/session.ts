import "server-only"
import { cache } from "react"
import { cookies, headers } from "next/headers"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { StoreRole, StoreStatus } from "@/generated/prisma/client"

export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

/// เรียกเป็นบรรทัดแรกของ Server Action ที่แตะข้อมูล "ของตัวผู้ใช้" (โปรไฟล์/รหัสผ่าน) — ไม่ใช่ของร้าน
/// action ที่แตะข้อมูลร้านต้องใช้ `requireStore()` แทน (Phase 13)
export async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error("UNAUTHENTICATED")
  return session.user
}

// ───────────────────── ร้านที่กำลังทำงานอยู่ (Phase 13) ─────────────────────

/// cookie บอกว่าผู้ใช้เลือกทำงานกับร้านไหน — เป็นค่าจากเบราว์เซอร์ จึง "เชื่อไม่ได้"
/// ต้องตรวจกับ StoreMember ทุกคำขอ ห้าม cache ข้ามคำขอ (ถอดพนักงานแล้วต้องมีผลทันที)
export const ACTIVE_STORE_COOKIE = "activeStoreId"

export type StoreMembershipSummary = {
  storeId: string
  slug: string
  name: string
  status: StoreStatus
  role: StoreRole
}

export type StoreContext = {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean }
  storeId: string
  store: { id: string; slug: string; name: string; status: StoreStatus }
  role: StoreRole
  /// บทบาท matrix สิทธิ์ F1–F9 ในร้านนี้ (null = ยังไม่กำหนด) — OWNER ไม่ใช้ค่านี้
  permissionRoleId: string | null
  /// ร้านทั้งหมดที่ผู้ใช้อยู่ — ไว้ให้ตัวสลับร้านใน topbar
  memberships: StoreMembershipSummary[]
}

export type StoreContextResult =
  | { ok: true; context: StoreContext }
  | { ok: false; reason: "UNAUTHENTICATED" | "NO_STORE" | "STORE_SUSPENDED"; memberships: StoreMembershipSummary[] }

/// อ่าน "ผู้ใช้ + ร้านที่ทำงานอยู่ + บทบาทในร้านนั้น" จาก DB — `cache()` ทำให้เรียกกี่ครั้งในคำขอเดียว
/// ก็ยิง query ครั้งเดียว แต่ไม่ข้ามคำขอ
export const resolveStoreContext = cache(async (): Promise<StoreContextResult> => {
  const session = await getSession()
  if (!session?.user) return { ok: false, reason: "UNAUTHENTICATED", memberships: [] }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
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
          store: { select: { id: true, slug: true, name: true, status: true } },
        },
      },
    },
  })
  if (!user) return { ok: false, reason: "UNAUTHENTICATED", memberships: [] }

  const memberships: StoreMembershipSummary[] = user.storeMemberships.map((m) => ({
    storeId: m.storeId,
    slug: m.store.slug,
    name: m.store.name,
    status: m.store.status,
    role: m.role,
  }))
  if (user.storeMemberships.length === 0) return { ok: false, reason: "NO_STORE", memberships }

  // cookie ชี้ร้านที่ไม่ได้เป็นสมาชิก → ไม่เชื่อ ตกไปใช้ร้านแรก (ไม่ใช่ error เพื่อไม่ให้ค้างหน้าเปล่า)
  const wanted = (await cookies()).get(ACTIVE_STORE_COOKIE)?.value
  const membership = user.storeMemberships.find((m) => m.storeId === wanted) ?? user.storeMemberships[0]

  if (membership.store.status === "SUSPENDED") {
    return { ok: false, reason: "STORE_SUSPENDED", memberships }
  }

  return {
    ok: true,
    context: {
      user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
      storeId: membership.storeId,
      store: membership.store,
      role: membership.role,
      permissionRoleId: membership.roleId,
      memberships,
    },
  }
})

/// เรียกเป็นบรรทัดแรกของทุก Server Action ที่แตะข้อมูลร้าน (แทน requireUser() ตั้งแต่ Phase 13)
/// โยน Error ที่ message เป็นรหัส — ผู้เรียกจับแล้วแปลงเป็น ActionResult ภาษาไทยผ่าน `storeErrorMessage()`
export async function requireStore(): Promise<StoreContext> {
  const result = await resolveStoreContext()
  if (!result.ok) throw new Error(result.reason)
  return result.context
}

/// เฉพาะเจ้าของร้าน — ตั้งค่าร้าน จัดการพนักงาน และทุกอย่างที่แตะบัญชีรับเงิน (Phase 15)
export async function requireOwner(): Promise<StoreContext> {
  const context = await requireStore()
  if (context.role !== "OWNER") throw new Error("NOT_OWNER")
  return context
}

/// ผู้ดูแลแพลตฟอร์ม (เรา) — ไม่ผูกกับร้านใด ใช้กับ /admin/* (Phase 14)
export async function requirePlatformAdmin() {
  const session = await getSession()
  if (!session?.user) throw new Error("UNAUTHENTICATED")
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, isPlatformAdmin: true },
  })
  if (!user?.isPlatformAdmin) throw new Error("NOT_PLATFORM_ADMIN")
  return user
}

export { storeErrorMessage } from "@/lib/store-errors"
