"use server"

import { revalidatePath } from "next/cache"
// ผู้ดูแลแพลตฟอร์มทำงานข้ามร้านโดยตั้งใจ (ระงับ/ปลดระงับร้านใดก็ได้) — ไม่มี storeId ให้ forStore()
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { requirePlatformAdmin, storeErrorMessage } from "@/lib/session"
import { isStoreScbReady } from "@/lib/scb-store"
import { isSlipVerificationConfigured } from "@/lib/slip-provider"
import { adminPaymentModeSchema, firstIssueMessage, storeModulesSchema, storeStatusSchema } from "@/lib/validation"
import { MODULE_LABEL, STORE_MODULES } from "@/lib/modules"
import type { ActionResult } from "@/lib/types"

/// การกระทำของผู้ดูแลแพลตฟอร์ม (Phase 14a) — แตะได้แค่ Store.status (+ Store.paymentMode ใน 15a) ไม่แก้ข้อมูลในร้าน
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

/// เปลี่ยนวิธีรับเงินของร้าน (Phase 15a) — ผู้ดูแลเท่านั้นที่ตั้ง SCB_BILLER ได้ เพราะเฟสนี้ credential SCB ยังเป็นของ
/// แพลตฟอร์ม (env) · ต้องตั้ง env ครบก่อน ไม่งั้นร้านจะออก QR ไม่ได้เลย · 15c จะย้ายเป็น credential ต่อร้าน + ปุ่มทดสอบการเชื่อมต่อ
export async function setStorePaymentMode(formData: FormData): Promise<ActionResult> {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = adminPaymentModeSchema.safeParse({ storeId: formData.get("storeId"), paymentMode: formData.get("paymentMode") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const { storeId, paymentMode } = parsed.data

  if (paymentMode === "PROMPTPAY_SLIP" && !isSlipVerificationConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้ง SLIP_PROVIDER/SLIP_API_KEY ใน env — ตั้งครบก่อนจึงเปิดโหมดตรวจสลิปได้" }
  }
  if (paymentMode === "SCB_BILLER" && !(await isStoreScbReady(storeId))) {
    return { ok: false, error: "ร้านนี้ยังไม่มี credential SCB ที่ใช้ได้ (ของร้านต้องผ่านการทดสอบ หรือแพลตฟอร์มต้องตั้ง env SCB_* ครบ)" }
  }

  const result = await prisma.store.updateMany({ where: { id: storeId, paymentMode: { not: paymentMode } }, data: { paymentMode } })
  if (result.count === 0) {
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } })
    return { ok: false, error: store ? "ร้านนี้ใช้โหมดนี้อยู่แล้ว" : "ไม่พบร้านนี้" }
  }

  revalidatePath("/admin/stores")
  revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath("/mobile-order/settings")
  revalidatePath("/order", "layout")
  const message =
    paymentMode === "SCB_BILLER"
      ? "เปิดรับเงินผ่าน SCB ให้ร้านแล้ว — ปิดบิลอัตโนมัติจาก callback"
      : paymentMode === "PROMPTPAY_SLIP"
        ? "เปิดโหมดตรวจสลิปอัตโนมัติให้ร้านแล้ว"
        : "เปลี่ยนเป็นพร้อมเพย์ตรงของร้านแล้ว"
  return { ok: true, message }
}

/// เปิด/ปิดโมดูลของร้าน (2026-09-30) — ผู้ดูแลแพลตฟอร์มเท่านั้น · ร้านเปลี่ยนเองไม่ได้
///
/// เก็บเป็นรายการโมดูลที่ **ปิด** (ว่าง = ได้ครบ) · ปิดแล้วไม่แตะข้อมูลใด ๆ ของร้าน — ด่านอยู่ที่ permissionsFromContext()
/// (lib/permissions.ts) และ getStoreSettings() (lib/queries.ts) ซึ่งอ่านค่านี้ทุกคำขอ จึงมีผลทันทีในคำขอถัดไป
/// รับ `disabled` เป็น JSON array ของชื่อโมดูล
export async function setStoreModules(formData: FormData): Promise<ActionResult> {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  let disabled: unknown
  try {
    disabled = JSON.parse(String(formData.get("disabled") ?? "[]"))
  } catch {
    return { ok: false, error: "ข้อมูลโมดูลไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่" }
  }
  const parsed = storeModulesSchema.safeParse({ storeId: formData.get("storeId"), disabled })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const { storeId } = parsed.data
  // เรียงตามลำดับคงที่ + ตัดซ้ำ — เทียบ/แสดงผลได้ตรงกันเสมอ
  const modules = STORE_MODULES.filter((m) => parsed.data.disabled.includes(m))

  const result = await prisma.store.updateMany({ where: { id: storeId }, data: { disabledModules: modules } })
  if (result.count === 0) return { ok: false, error: "ไม่พบร้านนี้" }

  revalidatePath("/admin/stores")
  revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath("/", "layout")
  return {
    ok: true,
    message:
      modules.length === 0
        ? "เปิดครบทุกโมดูลแล้ว"
        : `บันทึกแล้ว — ปิด ${modules.map((m) => MODULE_LABEL[m]).join(", ")}`,
  }
}
