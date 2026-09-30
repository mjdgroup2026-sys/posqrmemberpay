"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
// ตรวจสิทธิ์จากรายการร้านของผู้ใช้เอง (ร้านที่ปิดแล้ว requireStore() เข้าไม่ได้) — ใช้ loadStoreContext() ตัวเดียวกับ requireStore()
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { ACTIVE_STORE_COOKIE, requireUser, storeErrorMessage } from "@/lib/session"
import { loadStoreContext, type StoreMembershipSummary } from "@/lib/store-context"
import { closeStoreRow, deleteUnusedStore, reopenStoreRow, StoreLifecycleError } from "@/lib/store-lifecycle"
import { firstIssueMessage, storeLifecycleSchema } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// ปิดร้าน / เปิดร้านอีกครั้ง / ลบร้านถาวร (2026-09-30) — เฉพาะ OWNER ของร้านนั้น (รวมเจ้าของแบรนด์)
///
/// ไม่ใช้ requireStore() เพราะร้านที่ปิดแล้วไม่ใช่ "ร้านที่ทำงานอยู่" ได้ — รับ storeId จากฟอร์มแล้วตรวจกับรายการร้าน
/// ที่ loadStoreContext() คำนวณ (ตรรกะเดียวกับ requireStore/switchActiveStore) ร้านที่ไม่ใช่ของเราจึงไม่ผ่านตั้งแต่ด่านนี้

type Checked = { ok: true; userId: string; store: StoreMembershipSummary; storeName: string; reason: string } | { ok: false; error: string }

async function checkOwner(formData: FormData, opts: { confirm: boolean; reason: boolean }): Promise<Checked> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = storeLifecycleSchema.safeParse({
    storeId: formData.get("storeId"),
    confirmName: formData.get("confirmName") ?? "",
    reason: formData.get("reason") ?? "",
  })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const { storeId, confirmName, reason } = parsed.data

  const access = await loadStoreContext(prisma, userId, storeId)
  const memberships = access.ok ? access.context.memberships : access.memberships
  const store = memberships.find((m) => m.storeId === storeId)
  if (!store) return { ok: false, error: "ไม่พบร้านนี้ในบัญชีของคุณ" }
  if (store.role !== "OWNER") return { ok: false, error: "เฉพาะเจ้าของร้านเท่านั้นที่ทำรายการนี้ได้" }

  if (opts.confirm && confirmName !== store.name.trim()) {
    return { ok: false, error: "ชื่อร้านที่พิมพ์ไม่ตรง — พิมพ์ชื่อร้านให้ตรงทุกตัวอักษรเพื่อยืนยัน" }
  }
  if (opts.reason && reason.length < 5) return { ok: false, error: "กรุณาระบุเหตุผลที่ปิดร้านอย่างน้อย 5 ตัวอักษร" }
  return { ok: true, userId, store, storeName: store.name, reason }
}

/// ร้านที่ทำงานอยู่เพิ่งปิด/ลบไป — ล้าง cookie ให้ loadStoreContext() เลือกร้านที่ยังเปิดอยู่ร้านถัดไปเอง
async function forgetActiveStore(storeId: string) {
  const jar = await cookies()
  if (jar.get(ACTIVE_STORE_COOKIE)?.value === storeId) jar.delete(ACTIVE_STORE_COOKIE)
}

function lifecycleError(error: unknown): ActionResult {
  if (error instanceof StoreLifecycleError) return { ok: false, error: error.reason }
  return { ok: false, error: "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
}

export async function closeStore(formData: FormData): Promise<ActionResult> {
  const checked = await checkOwner(formData, { confirm: true, reason: true })
  if (!checked.ok) return checked
  try {
    await closeStoreRow(checked.store.storeId, checked.userId, checked.reason)
  } catch (error) {
    return lifecycleError(error)
  }
  await forgetActiveStore(checked.store.storeId)
  revalidatePath("/", "layout")
  return { ok: true, message: `ปิดร้าน ${checked.storeName} แล้ว — เปิดอีกครั้งได้ที่หน้า "ร้านที่คุณปิดไว้"` }
}

export async function reopenStore(formData: FormData): Promise<ActionResult> {
  const checked = await checkOwner(formData, { confirm: false, reason: false })
  if (!checked.ok) return checked
  try {
    await reopenStoreRow(checked.store.storeId)
  } catch (error) {
    return lifecycleError(error)
  }
  revalidatePath("/", "layout")
  return { ok: true, message: `เปิดร้าน ${checked.storeName} อีกครั้งแล้ว` }
}

export async function deleteStore(formData: FormData): Promise<ActionResult> {
  const checked = await checkOwner(formData, { confirm: true, reason: false })
  if (!checked.ok) return checked
  try {
    await deleteUnusedStore(checked.store.storeId)
  } catch (error) {
    return lifecycleError(error)
  }
  await forgetActiveStore(checked.store.storeId)
  revalidatePath("/", "layout")
  return { ok: true, message: `ลบร้าน ${checked.storeName} ถาวรแล้ว` }
}
