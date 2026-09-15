"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { guardAction } from "@/lib/permissions"
import { productSchema, idSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"


function revalidateProductPages() {
  revalidatePath("/products")
  revalidatePath("/pos")
  revalidatePath("/categories")
  revalidatePath("/")
  revalidatePath("/stock-in")
  revalidatePath("/stock-out")
}

/// สร้าง SKU ถัดไปแบบ SKU-1001, SKU-1002, … (หา max +1) — นับเฉพาะในร้าน ทุกร้านเริ่ม SKU-1001 ของตัวเอง
/// ⚠️ raw SQL ไม่ผ่าน forStore() — ต้องกรอง storeId เองเสมอ
async function nextSku(storeId: string): Promise<string> {
  const rows = await forStore(storeId).$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("sku" FROM '^SKU-([0-9]+)$') AS INTEGER)) AS max
    FROM "product"
    WHERE "storeId" = ${storeId} AND "sku" ~ '^SKU-[0-9]+$'
  `
  const max = rows[0]?.max ?? 1000
  return `SKU-${max + 1}`
}

/// หมวดหมู่ที่ผู้ใช้เลือกต้องเป็นของร้านเดียวกัน (Phase 13) — FK ตรวจแค่ว่ามีแถวอยู่ ไม่รู้ว่าเป็นของร้านไหน
/// ถ้าไม่เช็คตรงนี้ สินค้าของร้าน A จะไปเกาะหมวดของร้าน B ได้เงียบ ๆ (เทส tenant-isolation จับได้)
const CATEGORY_NOT_FOUND: ActionResult = {
  ok: false,
  error: "ไม่พบหมวดหมู่ที่เลือก กรุณาเลือกใหม่อีกครั้ง",
  fieldErrors: { categoryId: "หมวดหมู่นี้ถูกลบไปแล้ว" },
}

async function categoryBelongsToStore(db: ReturnType<typeof forStore>, categoryId: string): Promise<boolean> {
  const found = await db.category.findUnique({ where: { id: categoryId }, select: { id: true } })
  return found !== null
}

export async function createProduct(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ PRODUCTS:ADD ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("PRODUCTS", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku"),
    categoryId: formData.get("categoryId"),
    unit: formData.get("unit"),
    price: formData.get("price"),
    reorderPoint: formData.get("reorderPoint"),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const data = parsed.data
  if (!(await categoryBelongsToStore(db, data.categoryId))) return CATEGORY_NOT_FOUND

  // SKU auto-gen อาจชนกันได้ถ้าสร้างพร้อมกันหลาย session — retry จน insert ผ่าน
  for (let attempt = 0; attempt < 5; attempt++) {
    const sku = data.sku ?? (await nextSku(storeId))
    try {
      await db.product.create({
        data: {
          storeId,
          sku,
          name: data.name,
          categoryId: data.categoryId,
          unit: data.unit,
          price: data.price.toFixed(2),
          reorderPoint: data.reorderPoint,
        },
      })
      revalidateProductPages()
      return { ok: true, message: `เพิ่มสินค้า ${data.name} (${sku}) เรียบร้อยแล้ว` }
    } catch (error) {
      const code = (error as { code?: string }).code
      // P2003 = FK violation — หมวดหมู่ที่เลือกถูกลบไปแล้วระหว่างที่ฟอร์มเปิดค้างอยู่
      if (code === "P2003") {
        return {
          ok: false,
          error: "ไม่พบหมวดหมู่ที่เลือก กรุณาเลือกใหม่อีกครั้ง",
          fieldErrors: { categoryId: "หมวดหมู่นี้ถูกลบไปแล้ว" },
        }
      }
      if (code !== "P2002") {
        return { ok: false, error: "บันทึกสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
      }
      // ผู้ใช้กรอก SKU เอง แล้วซ้ำ → ไม่ต้อง retry บอกไปเลย
      if (data.sku) {
        return {
          ok: false,
          error: `รหัสสินค้า ${data.sku} ถูกใช้ไปแล้ว`,
          fieldErrors: { sku: "SKU นี้ซ้ำกับสินค้าที่มีอยู่" },
        }
      }
    }
  }

  return { ok: false, error: "สร้างรหัสสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
}

export async function updateProduct(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ PRODUCTS:EDIT ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("PRODUCTS", "EDIT")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const identity = idSchema.safeParse({ id: formData.get("id") })
  if (!identity.success) return { ok: false, error: firstIssueMessage(identity.error) }

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku"),
    categoryId: formData.get("categoryId"),
    unit: formData.get("unit"),
    price: formData.get("price"),
    reorderPoint: formData.get("reorderPoint"),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const data = parsed.data
  if (!(await categoryBelongsToStore(db, data.categoryId))) return CATEGORY_NOT_FOUND

  try {
    await db.product.update({
      where: { id: identity.data.id },
      // ไม่มี quantity ในชุดนี้โดยตั้งใจ — ยอดสต็อกแก้ได้ผ่าน Stock In/Out เท่านั้น (กติกาข้อ 2)
      data: {
        ...(data.sku ? { sku: data.sku } : {}),
        name: data.name,
        categoryId: data.categoryId,
        unit: data.unit,
        price: data.price.toFixed(2),
        reorderPoint: data.reorderPoint,
      },
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "P2002") {
      return {
        ok: false,
        error: `รหัสสินค้า ${data.sku} ถูกใช้ไปแล้ว`,
        fieldErrors: { sku: "SKU นี้ซ้ำกับสินค้าที่มีอยู่" },
      }
    }
    if (code === "P2025") return { ok: false, error: "ไม่พบสินค้าที่ต้องการแก้ไข" }
    if (code === "P2003") {
      return {
        ok: false,
        error: "ไม่พบหมวดหมู่ที่เลือก กรุณาเลือกใหม่อีกครั้ง",
        fieldErrors: { categoryId: "หมวดหมู่นี้ถูกลบไปแล้ว" },
      }
    }
    return { ok: false, error: "แก้ไขสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateProductPages()
  return { ok: true, message: `แก้ไขสินค้า ${data.name} เรียบร้อยแล้ว` }
}

export async function deleteProduct(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ PRODUCTS:DELETE ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("PRODUCTS", "DELETE")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const identity = idSchema.safeParse({ id: formData.get("id") })
  if (!identity.success) return { ok: false, error: firstIssueMessage(identity.error) }

  try {
    await db.product.delete({ where: { id: identity.data.id } })
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return { ok: false, error: "ไม่พบสินค้าที่ต้องการลบ" }
    }
    return { ok: false, error: "ลบสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateProductPages()
  return { ok: true, message: "ลบสินค้าเรียบร้อยแล้ว" }
}
