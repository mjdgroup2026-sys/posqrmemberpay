import "server-only"
import { cache } from "react"
import { cookies, headers } from "next/headers"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isPlanActive } from "@/lib/subscription"
import { loadStoreContext, type StoreContext, type StoreContextResult } from "@/lib/store-context"

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

/// type ทั้งหมดของ context อยู่ที่ lib/store-context.ts (ไม่แตะ server-only) — re-export ให้ผู้เรียกเดิม import จากที่นี่ได้ต่อ
export type { StoreContext, StoreContextResult, StoreMembershipSummary, StorePlan } from "@/lib/store-context"

/// อ่าน "ผู้ใช้ + ร้านที่ทำงานอยู่ + บทบาทในร้านนั้น" จาก DB — `cache()` ทำให้เรียกกี่ครั้งในคำขอเดียว
/// ก็ยิง query ครั้งเดียว แต่ไม่ข้ามคำขอ · ตรรกะจริงอยู่ที่ loadStoreContext() (ใช้ร่วมกับ mock ของเทส)
export const resolveStoreContext = cache(async (): Promise<StoreContextResult> => {
  const session = await getSession()
  const wanted = (await cookies()).get(ACTIVE_STORE_COOKIE)?.value
  return loadStoreContext(prisma, session?.user?.id ?? null, wanted)
})

/// เรียกเป็นบรรทัดแรกของทุก Server Action ที่แตะข้อมูลร้าน (แทน requireUser() ตั้งแต่ Phase 13)
/// โยน Error ที่ message เป็นรหัส — ผู้เรียกจับแล้วแปลงเป็น ActionResult ภาษาไทยผ่าน `storeErrorMessage()`
export async function requireStore(): Promise<StoreContext> {
  const result = await resolveStoreContext()
  if (!result.ok) throw new Error(result.reason)
  return result.context
}

/// ร้านที่ "ขายได้" — แพ็กเกจยังไม่หมดอายุ (Phase 14b) · ใช้กับ action ที่สร้างข้อมูลขายใหม่เท่านั้น
/// (เปิดโต๊ะ, checkout POS, รับออเดอร์ลูกค้า) — reports/history/settings/ปิดบิลโต๊ะที่เปิดอยู่แล้ว ใช้ requireStore() ตามเดิม
/// ไม่แก้ requireStore() เพราะ "หมดอายุ = อ่านได้ ขายไม่ได้" ไม่ใช่ล็อกทั้งร้าน
export async function requireSellingStore(): Promise<StoreContext> {
  const context = await requireStore()
  if (!isPlanActive(new Date(), context.plan.expiresAt)) throw new Error("STORE_EXPIRED")
  return context
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
