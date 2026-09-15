"use server"

import { revalidatePath } from "next/cache"
// ผู้ดูแลแพลตฟอร์มทำงานข้ามร้านโดยตั้งใจ (ระงับ/ปลดระงับร้านใดก็ได้) — ไม่มี storeId ให้ forStore()
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { requirePlatformAdmin, storeErrorMessage } from "@/lib/session"
import { firstIssueMessage, storeStatusSchema } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// การกระทำของผู้ดูแลแพลตฟอร์ม (Phase 14a) — แตะได้แค่ Store.status ไม่แก้ข้อมูลในร้าน
///
/// ระงับแล้ว requireStore() ของทุกสมาชิกร้านนั้นโยน STORE_SUSPENDED ทันทีในคำขอถัดไป (Phase 13)
/// และฝั่งลูกค้าที่สแกน QR เห็น "ร้านปิดรับออเดอร์ชั่วคราว" — ข้อมูลยังอยู่ครบ ปลดระงับแล้วกลับมาใช้ได้ทันที
export async function setStoreStatus(formData: FormData): Promise<ActionResult> {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = storeStatusSchema.safeParse({ storeId: formData.get("storeId"), status: formData.get("status") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const { storeId, status } = parsed.data

  const result = await prisma.store.updateMany({
    where: { id: storeId, status: status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" },
    data: { status },
  })
  if (result.count === 0) {
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { status: true } })
    if (!store) return { ok: false, error: "ไม่พบร้านนี้" }
    return { ok: false, error: status === "ACTIVE" ? "ร้านนี้ใช้งานอยู่แล้ว" : "ร้านนี้ถูกระงับอยู่แล้ว" }
  }

  revalidatePath("/admin/stores")
  revalidatePath("/", "layout")
  return { ok: true, message: status === "ACTIVE" ? "ปลดระงับร้านแล้ว" : "ระงับร้านแล้ว — สมาชิกร้านใช้งานไม่ได้จนกว่าจะปลด" }
}
