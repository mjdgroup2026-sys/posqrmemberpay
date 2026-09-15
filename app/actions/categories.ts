"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { guardAction } from "@/lib/permissions"
import { categorySchema, idSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"


function revalidateCategoryPages() {
  revalidatePath("/categories")
  revalidatePath("/products")
  revalidatePath("/pos")
}

export async function createCategory(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ CATEGORIES:ADD ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("CATEGORIES", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = categorySchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  try {
    await db.category.create({ data: { storeId, name: parsed.data.name } })
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return {
        ok: false,
        error: `หมวดหมู่ “${parsed.data.name}” มีอยู่แล้ว`,
        fieldErrors: { name: "ชื่อหมวดหมู่นี้ซ้ำกับที่มีอยู่" },
      }
    }
    return { ok: false, error: "เพิ่มหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateCategoryPages()
  return { ok: true, message: `เพิ่มหมวดหมู่ ${parsed.data.name} เรียบร้อยแล้ว` }
}

export async function updateCategory(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ CATEGORIES:EDIT ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("CATEGORIES", "EDIT")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const identity = idSchema.safeParse({ id: formData.get("id") })
  if (!identity.success) return { ok: false, error: firstIssueMessage(identity.error) }

  const parsed = categorySchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  try {
    await db.category.update({
      where: { id: identity.data.id },
      data: { name: parsed.data.name },
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "P2002") {
      return {
        ok: false,
        error: `หมวดหมู่ “${parsed.data.name}” มีอยู่แล้ว`,
        fieldErrors: { name: "ชื่อหมวดหมู่นี้ซ้ำกับที่มีอยู่" },
      }
    }
    if (code === "P2025") return { ok: false, error: "ไม่พบหมวดหมู่ที่ต้องการแก้ไข" }
    return { ok: false, error: "แก้ไขหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateCategoryPages()
  return { ok: true, message: `แก้ไขหมวดหมู่เป็น ${parsed.data.name} เรียบร้อยแล้ว` }
}

export async function deleteCategory(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ CATEGORIES:DELETE ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("CATEGORIES", "DELETE")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const identity = idSchema.safeParse({ id: formData.get("id") })
  if (!identity.success) return { ok: false, error: firstIssueMessage(identity.error) }

  try {
    // นับสินค้าที่ผูกอยู่ก่อน เพื่อบอกจำนวนให้ผู้ใช้ได้ชัด ๆ — FK ที่ฐานเป็นด่านจริงอีกชั้น
    const linked = await db.product.count({ where: { categoryId: identity.data.id } })
    if (linked > 0) {
      return {
        ok: false,
        error: `ลบไม่ได้ — ยังมีสินค้า ${linked} รายการผูกอยู่กับหมวดหมู่นี้ กรุณาย้ายสินค้าไปหมวดหมู่อื่นก่อน`,
      }
    }

    await db.category.delete({ where: { id: identity.data.id } })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "P2025") return { ok: false, error: "ไม่พบหมวดหมู่ที่ต้องการลบ" }
    // P2003 = FK violation — มีสินค้าถูกผูกเข้ามาระหว่างที่เพิ่งนับเสร็จ (race)
    if (code === "P2003") {
      return { ok: false, error: "ลบไม่ได้ — ยังมีสินค้าผูกอยู่กับหมวดหมู่นี้" }
    }
    return { ok: false, error: "ลบหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateCategoryPages()
  return { ok: true, message: "ลบหมวดหมู่เรียบร้อยแล้ว" }
}
