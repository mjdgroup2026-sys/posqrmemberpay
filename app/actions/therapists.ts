"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { parseAssetId } from "@/lib/assets"
import { therapistSchema, idSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// พนักงานนวด (Phase 20a) — master data ของร้านนวด สิทธิ์ `SPA_THERAPISTS`
///
/// ไม่ผูกกับบัญชีล็อกอิน · ทักษะ = ประเภทบริการ (KitchenStation) ของร้านนี้เท่านั้น (FK จากฟอร์มต้องเช็คเอง กติกาข้อ 5)
/// · ลบได้เฉพาะคนที่ยังไม่มีชื่อในบิล (SaleItem.therapistId RESTRICT) — มีประวัติแล้วให้ปิดใช้งานแทน

function revalidateTherapistPages(storeId: string) {
  publishStoreEvent(storeId, "menu")
  revalidatePath("/spa/therapists")
  revalidatePath("/mobile-order/pos")
  revalidatePath("/mobile-order/tables")
}

export async function saveTherapist(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_THERAPISTS", formData.get("id") ? "EDIT" : "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = therapistSchema.safeParse({
    id: formData.get("id") ?? undefined,
    code: formData.get("code"),
    name: formData.get("name"),
    nickname: formData.get("nickname") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    gender: formData.get("gender") ?? undefined,
    startedAt: formData.get("startedAt") ?? undefined,
    note: formData.get("note") ?? undefined,
    imageUrl: formData.get("imageUrl") ?? "",
    isActive: formData.get("isActive") === "true" || formData.get("isActive") === "on",
    skillIds: formData.get("skillIds") ?? "",
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const data = parsed.data

  // ทักษะทุกตัวต้องเป็นประเภทบริการของร้านนี้ — forStore() กรอง storeId ให้ นับได้ไม่ครบ = มี id แปลกปลอม
  if (data.skillIds.length > 0) {
    const owned = await db.kitchenStation.count({ where: { id: { in: data.skillIds } } })
    if (owned !== data.skillIds.length) {
      return { ok: false, error: "มีทักษะที่ไม่ใช่ประเภทบริการของร้านนี้", fieldErrors: { skillIds: "ทักษะไม่ถูกต้อง" } }
    }
  }

  const base = {
    code: data.code.toUpperCase(),
    name: data.name,
    nickname: data.nickname ?? null,
    phone: data.phone ?? null,
    gender: data.gender ?? null,
    startedAt: data.startedAt ? new Date(`${data.startedAt}T00:00:00.000Z`) : null,
    note: data.note ?? null,
    imageUrl: data.imageUrl,
    isActive: data.isActive,
    skills: { set: data.skillIds.map((id) => ({ id })) },
  }

  try {
    await db.$transaction(async (tx) => {
      if (data.id) {
        // รูปเดิมที่ถูกแทนที่ต้องถูกลบในทรานแซคชันเดียวกัน (แบบเดียวกับเมนู Phase 17a)
        const previous = await tx.therapist.findUnique({ where: { id: data.id }, select: { imageUrl: true } })
        if (!previous) throw Object.assign(new Error("NOT_FOUND"), { code: "P2025" })
        const staleId = parseAssetId(previous.imageUrl)
        if (staleId && staleId !== parseAssetId(data.imageUrl)) {
          await tx.storeAsset.deleteMany({ where: { id: staleId } })
        }
        await tx.therapist.update({ where: { id: data.id }, data: base })
      } else {
        await tx.therapist.create({
          data: { ...base, storeId, skills: { connect: data.skillIds.map((id) => ({ id })) } },
        })
      }
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "P2002") {
      return { ok: false, error: `มีพนักงานรหัส ${data.code.toUpperCase()} อยู่แล้ว`, fieldErrors: { code: "รหัสซ้ำ" } }
    }
    if (code === "P2025") return { ok: false, error: "ไม่พบพนักงานนวดที่ต้องการแก้ไข" }
    return { ok: false, error: "บันทึกข้อมูลพนักงานนวดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateTherapistPages(storeId)
  return {
    ok: true,
    message: data.id ? `บันทึกข้อมูลพนักงาน ${data.code.toUpperCase()} แล้ว` : `เพิ่มพนักงานนวด ${data.code.toUpperCase()} เรียบร้อยแล้ว`,
  }
}

export async function toggleTherapistActive(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_THERAPISTS", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const current = await db.therapist.findUnique({ where: { id: parsed.data.id }, select: { isActive: true, code: true } })
  if (!current) return { ok: false, error: "ไม่พบพนักงานนวดคนนี้" }

  const next = !current.isActive
  await db.therapist.update({ where: { id: parsed.data.id }, data: { isActive: next } })

  revalidateTherapistPages(storeId)
  return { ok: true, message: next ? `เปิดใช้งานพนักงาน ${current.code} แล้ว` : `ปิดใช้งานพนักงาน ${current.code} แล้ว — จะไม่ขึ้นให้เลือกบนจอขาย` }
}

export async function deleteTherapist(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_THERAPISTS", "DELETE"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const therapist = await db.therapist.findUnique({
    where: { id: parsed.data.id },
    select: { code: true, imageUrl: true, _count: { select: { saleItems: true, orderItems: true } } },
  })
  if (!therapist) return { ok: false, error: "ไม่พบพนักงานนวดที่ต้องการลบ" }

  // มีชื่อในบิล/ออร์เดอร์แล้วลบไม่ได้ — ประวัติการขายต้องไม่ชี้ไปที่ว่าง (เหมือนเมนูที่เคยถูกสั่ง)
  const used = therapist._count.saleItems + therapist._count.orderItems
  if (used > 0) {
    return { ok: false, error: `ลบไม่ได้ — พนักงาน ${therapist.code} มีประวัติให้บริการ ${used} รายการ กรุณาปิดใช้งานแทน` }
  }

  await db.$transaction(async (tx) => {
    await tx.therapist.delete({ where: { id: parsed.data.id } })
    const assetId = parseAssetId(therapist.imageUrl)
    if (assetId) await tx.storeAsset.deleteMany({ where: { id: assetId } })
  })

  revalidateTherapistPages(storeId)
  return { ok: true, message: `ลบพนักงาน ${therapist.code} เรียบร้อยแล้ว` }
}
