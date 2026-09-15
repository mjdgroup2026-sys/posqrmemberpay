"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { forStore } from "@/lib/db"
// switchActiveStore() ต้องค้น StoreMember ข้ามร้าน (ยังไม่รู้ว่าจะไปร้านไหน) — จุดเดียวในไฟล์นี้ที่ใช้ prisma ตรง
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import {
  ACTIVE_STORE_COOKIE,
  requireOwner,
  requireUser,
  storeErrorMessage,
  type StoreContext,
} from "@/lib/session"
import { firstIssueMessage, storeMemberRoleSchema, storeSwitchSchema, userIdSchema } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// สมาชิกร้าน (Phase 13) — ใครอยู่ร้านไหนในบทบาทอะไร
///
/// กติกาที่ต้องคงไว้เสมอ: **ต้องมี OWNER อย่างน้อย 1 คนต่อร้าน** — บังคับที่ action ในทรานแซคชัน
/// เดียวกับการเขียน (นับก่อนแล้วค่อยเขียนแยกกันไม่ได้ เพราะสองคนกดพร้อมกันจะหลุด)

class MemberAbort extends Error {
  constructor(readonly reason: string) {
    super("MEMBER_ABORT")
  }
}

function revalidateMemberPages() {
  revalidatePath("/users")
  revalidatePath("/", "layout")
}

/// สลับร้านที่ทำงานอยู่ — เขียนแค่ cookie · ค่านี้ถูกตรวจกับ StoreMember ซ้ำทุกคำขอโดย requireStore()
/// จึงไม่ต้องกลัวว่าใครแก้ cookie ชี้ร้านที่ตัวเองไม่ได้อยู่ (ตกไปใช้ร้านแรกของตัวเองแทน)
export async function switchActiveStore(formData: FormData): Promise<ActionResult> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = storeSwitchSchema.safeParse({ storeId: formData.get("storeId") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const membership = await prisma.storeMember.findUnique({
    where: { userId_storeId: { userId, storeId: parsed.data.storeId } },
    select: { store: { select: { name: true, status: true } } },
  })
  if (!membership) return { ok: false, error: "คุณไม่ได้เป็นสมาชิกของร้านนี้" }
  if (membership.store.status === "SUSPENDED") return { ok: false, error: "ร้านนี้ถูกระงับการใช้งาน" }

  const jar = await cookies()
  jar.set(ACTIVE_STORE_COOKIE, parsed.data.storeId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath("/", "layout")
  return { ok: true, message: `สลับไปร้าน ${membership.store.name} แล้ว` }
}

/// เปลี่ยนบทบาทระดับร้าน (OWNER ↔ STAFF) — เฉพาะเจ้าของร้าน
export async function setStoreMemberRole(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const db = forStore(ctx.storeId)

  const parsed = storeMemberRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const { userId, role } = parsed.data

  try {
    await db.$transaction(async (tx) => {
      const target = await tx.storeMember.findFirst({ where: { userId }, select: { id: true, role: true } })
      if (!target) throw new MemberAbort("ไม่พบพนักงานคนนี้ในร้าน")
      if (target.role === role) return

      // ★ ถอด OWNER คนสุดท้ายไม่ได้ — นับในทรานแซคชันเดียวกับการเขียน
      if (target.role === "OWNER") {
        const owners = await tx.storeMember.count({ where: { role: "OWNER", userId: { not: userId } } })
        if (owners === 0) {
          throw new MemberAbort("เปลี่ยนไม่ได้ — นี่คือเจ้าของร้านคนสุดท้าย ต้องมีเจ้าของร้านอย่างน้อย 1 คนเสมอ")
        }
      }

      await tx.storeMember.update({ where: { id: target.id }, data: { role } })
    })
  } catch (error) {
    if (error instanceof MemberAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "เปลี่ยนบทบาทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateMemberPages()
  return { ok: true, message: role === "OWNER" ? "ตั้งเป็นเจ้าของร้านแล้ว" : "เปลี่ยนเป็นพนักงานแล้ว" }
}

/// ถอดพนักงานออกจากร้าน — เฉพาะเจ้าของร้าน · บัญชีผู้ใช้ยังอยู่ (อาจอยู่ร้านอื่นด้วย) แค่ตัดความสัมพันธ์
export async function removeStoreMember(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const db = forStore(ctx.storeId)

  const parsed = userIdSchema.safeParse({ userId: formData.get("userId") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const { userId } = parsed.data

  if (userId === ctx.user.id) return { ok: false, error: "ถอดตัวเองออกจากร้านไม่ได้ ให้เจ้าของร้านคนอื่นเป็นคนทำ" }

  try {
    await db.$transaction(async (tx) => {
      const target = await tx.storeMember.findFirst({ where: { userId }, select: { id: true, role: true } })
      if (!target) throw new MemberAbort("ไม่พบพนักงานคนนี้ในร้าน")

      if (target.role === "OWNER") {
        const owners = await tx.storeMember.count({ where: { role: "OWNER", userId: { not: userId } } })
        if (owners === 0) throw new MemberAbort("ถอดไม่ได้ — นี่คือเจ้าของร้านคนสุดท้าย")
      }

      await tx.storeMember.delete({ where: { id: target.id } })
    })
  } catch (error) {
    if (error instanceof MemberAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "ถอดพนักงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateMemberPages()
  return { ok: true, message: "ถอดพนักงานออกจากร้านแล้ว" }
}
