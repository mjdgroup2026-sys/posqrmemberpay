"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { guardAction } from "@/lib/permissions"
import { stockMoveSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"


function revalidateStockPages() {
  revalidatePath("/")
  revalidatePath("/products")
  revalidatePath("/stock-in")
  revalidatePath("/stock-out")
  revalidatePath("/reports")
}

function parseMove(formData: FormData) {
  // formData.get() คืน null เมื่อไม่มีฟิลด์นั้น แต่ zod .optional() รับแค่ undefined
  // ถ้าส่ง null เข้าไปตรง ๆ จะได้ข้อความอังกฤษดิบ "expected string, received null" หลุดถึงผู้ใช้
  // (ละเมิดกติกาข้อ 6) — ฟอร์มปกติไม่เจอ แต่ Server Action ถูกเรียกตรงได้ตามกติกาข้อ 5
  return stockMoveSchema.safeParse({
    productId: formData.get("productId") ?? "",
    quantity: formData.get("quantity"),
    note: formData.get("note") ?? undefined,
  })
}

export async function stockIn(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ STOCK_IN:ADD ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("STOCK_IN", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = parseMove(formData)
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { productId, quantity, note } = parsed.data

  try {
    // สร้าง ledger + เพิ่มยอด ต้องอยู่ใน transaction เดียวกันเสมอ (กติกาข้อ 2)
    const product = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: productId },
        data: { quantity: { increment: quantity } },
        select: { name: true, unit: true, quantity: true },
      })
      await tx.stockTransaction.create({
        data: { storeId, productId, type: "IN", quantity, note },
      })
      return updated
    })

    revalidateStockPages()
    return {
      ok: true,
      message: `รับเข้า ${product.name} จำนวน ${quantity} ${product.unit} — คงเหลือ ${product.quantity}`,
    }
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return { ok: false, error: "ไม่พบสินค้าที่เลือก" }
    }
    return { ok: false, error: "บันทึกรับสินค้าเข้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

export async function stockOut(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ STOCK_OUT:ADD ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("STOCK_OUT", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = parseMove(formData)
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { productId, quantity, note } = parsed.data

  try {
    const result = await db.$transaction(async (tx) => {
      // ★ ด่านกันเบิกเกิน: updateMany + where quantity gte เป็นด่านเดียวที่กัน race condition
      //   ได้จริงตอนมีคำขอพร้อมกัน — ห้ามใช้ if เช็คก่อนแล้วค่อย update (กติกาข้อ 4)
      const updated = await tx.product.updateMany({
        where: { id: productId, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } },
      })

      if (updated.count === 0) {
        const current = await tx.product.findUnique({
          where: { id: productId },
          select: { name: true, unit: true, quantity: true },
        })
        if (!current) return { status: "missing" as const }
        return { status: "insufficient" as const, product: current }
      }

      await tx.stockTransaction.create({
        data: { storeId, productId, type: "OUT", quantity, note },
      })

      const product = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: { name: true, unit: true, quantity: true },
      })
      return { status: "ok" as const, product }
    })

    if (result.status === "missing") return { ok: false, error: "ไม่พบสินค้าที่เลือก" }

    if (result.status === "insufficient") {
      const { name, quantity: available, unit } = result.product
      return {
        ok: false,
        error: `สต็อก ${name} ไม่พอเบิก — ขอ ${quantity} ${unit} แต่มีอยู่ ${available} ${unit}`,
        fieldErrors: { quantity: `เบิกได้ไม่เกิน ${available} ${unit}` },
      }
    }

    revalidateStockPages()
    return {
      ok: true,
      message: `เบิก ${result.product.name} จำนวน ${quantity} ${result.product.unit} — คงเหลือ ${result.product.quantity}`,
    }
  } catch {
    return { ok: false, error: "บันทึกเบิกจ่ายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
