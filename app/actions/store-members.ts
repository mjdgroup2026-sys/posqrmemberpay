"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { forStore } from "@/lib/db"
// switchActiveStore() ต้องค้น StoreMember ข้ามร้าน (ยังไม่รู้ว่าจะไปร้านไหน) — จุดเดียวในไฟล์นี้ที่ใช้ prisma ตรง
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { hashInviteToken, INVITE_TTL_MS, newInviteToken } from "@/lib/invite-token"
import { sendStoreInviteMail } from "@/lib/mail"
import { findStoreByInviteId, findStoreByInviteTokenHash } from "@/lib/store-resolve"
import {
  ACTIVE_STORE_COOKIE,
  requireOwner,
  requireUser,
  storeErrorMessage,
  type StoreContext,
} from "@/lib/session"
import { loadStoreContext } from "@/lib/store-context"
import { publicBaseUrl } from "@/lib/urls"
import {
  firstIssueMessage,
  inviteIdSchema,
  inviteMemberSchema,
  acceptInviteSchema,
  storeMemberRoleSchema,
  storeSwitchSchema,
  userIdSchema,
  zodToFieldErrors,
} from "@/lib/validation"
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

  // ตรรกะเดียวกับ requireStore(): StoreMember หรือสาขาใต้แบรนด์ที่ตัวเองเป็นเจ้าของ (Phase 14c) — ไม่เขียนซ้ำที่นี่
  // ดูจากรายการ memberships ที่ loadStoreContext() คำนวณให้ (คืนมาทั้งกรณี ok และไม่ ok)
  const access = await loadStoreContext(prisma, userId, parsed.data.storeId)
  const memberships = access.ok ? access.context.memberships : access.memberships
  const target = memberships.find((m) => m.storeId === parsed.data.storeId)
  if (!target) return { ok: false, error: "คุณไม่ได้เป็นสมาชิกของร้านนี้" }
  if (target.status === "SUSPENDED") return { ok: false, error: "ร้านนี้ถูกระงับการใช้งาน" }

  const jar = await cookies()
  jar.set(ACTIVE_STORE_COOKIE, parsed.data.storeId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath("/", "layout")
  return { ok: true, message: `สลับไปร้าน ${target.name} แล้ว` }
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

// ───────────────────── คำเชิญเข้าร้าน (Phase 14a) ─────────────────────
// อ่านคำเชิญ (lookupInvite/listPendingInvites) อยู่ที่ lib/queries.ts — ไฟล์นี้มีแค่การเขียน

function inviteUrl(token: string) {
  return `${publicBaseUrl()}/invite/${token}`
}

function setActiveStoreCookie(jar: Awaited<ReturnType<typeof cookies>>, storeId: string) {
  jar.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

/// เชิญพนักงานทางอีเมล — เฉพาะเจ้าของร้าน
/// อีเมลเดิมมีคำเชิญค้างอยู่ → ยกเลิกใบเก่าแล้วออกใบใหม่ (ส่งซ้ำ = ลิงก์ใหม่ ลิงก์เก่าใช้ไม่ได้)
export async function inviteMember(formData: FormData): Promise<ActionResult<{ inviteUrl?: string }>> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const db = forStore(ctx.storeId)

  const parsed = inviteMemberSchema.safeParse({ email: formData.get("email"), role: formData.get("role") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { email, role } = parsed.data

  // อีเมลนี้เป็นสมาชิกร้านอยู่แล้ว → ไม่ต้องเชิญ (เปลี่ยนบทบาทได้ที่ตารางพนักงาน)
  const existing = await db.storeMember.findFirst({ where: { user: { email } }, select: { id: true } })
  if (existing) return { ok: false, error: "อีเมลนี้เป็นสมาชิกของร้านอยู่แล้ว", fieldErrors: { email: "เป็นสมาชิกอยู่แล้ว" } }

  const token = newInviteToken()
  const tokenHash = hashInviteToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  await db.$transaction(async (tx) => {
    await tx.storeInvite.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await tx.storeInvite.create({
      data: { storeId: ctx.storeId, email, role, tokenHash, expiresAt, invitedById: ctx.user.id },
    })
  })

  const url = inviteUrl(token)
  const mail = await sendStoreInviteMail(email, {
    storeName: ctx.store.name,
    inviterName: ctx.user.name,
    role,
    url,
  })

  revalidateMemberPages()

  if (!mail.ok) {
    // แถวคำเชิญยังอยู่ ให้เจ้าของร้านส่งลิงก์เองได้ — แต่ **ห้าม log ลิงก์** (credential ชั่วคราว)
    console.error("[mail] ส่งอีเมลคำเชิญไม่สำเร็จ:", mail.error)
    return {
      ok: true,
      message: "บันทึกคำเชิญแล้ว แต่ส่งอีเมลไม่สำเร็จ — คัดลอกลิงก์ด้านล่างส่งให้พนักงานเองได้",
      data: { inviteUrl: url },
    }
  }
  if (mail.skipped) {
    // dev ไม่มี RESEND_API_KEY — lib/mail.ts พิมพ์ลิงก์ลง console แล้ว ส่งกลับให้กดจากหน้าจอได้ด้วย
    return { ok: true, message: "บันทึกคำเชิญแล้ว (โหมด dev ไม่ได้ส่งอีเมลจริง)", data: { inviteUrl: url } }
  }
  return { ok: true, message: `ส่งคำเชิญไปที่ ${email} แล้ว` }
}

/// ยกเลิกคำเชิญที่ยังไม่ตอบรับ — เฉพาะเจ้าของร้าน · ลิงก์ในอีเมลใช้ไม่ได้ทันที
export async function revokeInvite(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const db = forStore(ctx.storeId)

  const parsed = inviteIdSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const result = await db.storeInvite.updateMany({
    where: { id: parsed.data.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) return { ok: false, error: "ไม่พบคำเชิญ หรือคำเชิญนี้ถูกตอบรับ/ยกเลิกไปแล้ว" }

  revalidateMemberPages()
  return { ok: true, message: "ยกเลิกคำเชิญแล้ว" }
}

/// ตอบรับคำเชิญ — ผู้ใช้ที่ล็อกอินอยู่ต้องใช้อีเมลเดียวกับที่ถูกเชิญ
/// หาร้านจาก token ก่อน (lib/store-resolve.ts) แล้วทุกอย่างหลังจากนั้นผ่าน forStore(storeId) ตามปกติ
/// ใช้ครั้งเดียว: ปิดคำเชิญด้วย updateMany where acceptedAt: null (กติกาข้อ 7) กันกดรับ 2 ครั้งพร้อมกัน
export async function acceptInvite(formData: FormData): Promise<ActionResult<{ storeId: string }>> {
  let user: { id: string; email: string }
  try {
    user = await requireUser()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  // formData.get() คืน null เมื่อไม่มีฟิลด์ — zod optional รับ undefined เท่านั้น
  const parsed = acceptInviteSchema.safeParse({
    token: formData.get("token") ?? undefined,
    inviteId: formData.get("inviteId") ?? undefined,
  })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  // ทางที่ 1 token จากลิงก์อีเมล (ใครถือลิงก์ก็เปิดหน้าได้ แต่รับได้เฉพาะบัญชีอีเมลที่ถูกเชิญ)
  // ทางที่ 2 inviteId จากรายการคำเชิญค้างของอีเมลตัวเอง — ด่านคือ where email ด้านล่าง
  const tokenHash = parsed.data.token ? hashInviteToken(parsed.data.token) : null
  const store = tokenHash
    ? await findStoreByInviteTokenHash(tokenHash)
    : await findStoreByInviteId(parsed.data.inviteId ?? "")
  if (!store) return { ok: false, error: "ไม่พบคำเชิญนี้ ลิงก์อาจไม่ถูกต้อง" }
  if (store.status === "SUSPENDED") return { ok: false, error: "ร้านนี้ถูกระงับการใช้งาน ยังเข้าร่วมไม่ได้" }
  const db = forStore(store.storeId)

  const invite = await db.storeInvite.findFirst({
    where: tokenHash ? { tokenHash } : { id: parsed.data.inviteId, email: user.email.trim().toLowerCase() },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      store: { select: { name: true } },
    },
  })
  if (!invite) return { ok: false, error: "ไม่พบคำเชิญนี้ ลิงก์อาจไม่ถูกต้อง" }
  if (invite.acceptedAt) return { ok: false, error: "คำเชิญนี้ถูกตอบรับไปแล้ว" }
  if (invite.revokedAt) return { ok: false, error: "คำเชิญนี้ถูกยกเลิกโดยเจ้าของร้านแล้ว" }
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, error: "คำเชิญนี้หมดอายุแล้ว กรุณาขอให้เจ้าของร้านส่งใหม่" }
  if (invite.email !== user.email.trim().toLowerCase()) {
    return {
      ok: false,
      error: `คำเชิญนี้ส่งถึง ${invite.email} แต่คุณล็อกอินด้วย ${user.email} — กรุณาเข้าสู่ระบบด้วยบัญชีที่ถูกเชิญ`,
    }
  }

  try {
    await db.$transaction(async (tx) => {
      // ★ ด่านจริงกันรับซ้ำ/พร้อมกัน — ถ้าอีกคำขอปิดไปก่อน count จะเป็น 0
      const closed = await tx.storeInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedById: user.id },
      })
      if (closed.count === 0) throw new MemberAbort("คำเชิญนี้ถูกตอบรับหรือยกเลิกไปแล้ว")

      // อาจเป็นสมาชิกอยู่แล้ว (ถูกเพิ่มทางอื่นระหว่างรอ) → ไม่ลดบทบาทที่มีอยู่
      await tx.storeMember.upsert({
        where: { userId_storeId: { userId: user.id, storeId: store.storeId } },
        update: {},
        create: { userId: user.id, storeId: store.storeId, role: invite.role },
      })
    })
  } catch (error) {
    if (error instanceof MemberAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "เข้าร่วมร้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  setActiveStoreCookie(await cookies(), store.storeId)
  revalidateMemberPages()
  return { ok: true, message: `เข้าร่วมร้าน ${invite.store.name} แล้ว`, data: { storeId: store.storeId } }
}
