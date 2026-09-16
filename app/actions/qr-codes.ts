"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { generateQrSchema, idSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"


function revalidateQrPages() {
  revalidatePath("/mobile-order/qr-codes")
  revalidatePath("/mobile-order/tables")
}

/// token ต้องเดาไม่ได้ — ใช้ 24 ไบต์สุ่มจาก crypto (base64url = 32 อักขระ) ห้ามใช้ tableId
function newToken(): string {
  return randomBytes(24).toString("base64url")
}

/// สร้าง QR ใบใหม่ให้โต๊ะ — โต๊ะหนึ่งมี QR ที่ใช้งานได้พร้อมกันแค่ใบเดียว
/// ใบเก่าจึงถูก invalidate ในทรานแซคชันเดียวกันเสมอ (§2 ความสัมพันธ์ Table 1—* QRCode)
export async function generateQRCode(formData: FormData): Promise<ActionResult<{ token: string }>> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = generateQrSchema.safeParse({
    tableId: formData.get("tableId") ?? "",
    type: formData.get("type") ?? "",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const table = await tx.table.findUnique({
        where: { id: parsed.data.tableId },
        select: { id: true, code: true },
      })
      if (!table) return null

      await tx.qRCode.updateMany({
        where: { tableId: table.id, status: "ACTIVE" },
        data: { status: "INVALIDATED", invalidatedAt: new Date() },
      })

      const qr = await tx.qRCode.create({
        data: { storeId, tableId: table.id, type: parsed.data.type, token: newToken() },
        select: { token: true },
      })

      return { token: qr.token, code: table.code }
    })

    if (!created) return { ok: false, error: "ไม่พบโต๊ะที่เลือก" }

    revalidateQrPages()
    return {
      ok: true,
      message: `สร้าง QR ใบใหม่ให้โต๊ะ ${created.code} แล้ว — ใบเก่าใช้ไม่ได้อีก`,
      data: { token: created.token },
    }
  } catch {
    return { ok: false, error: "สร้าง QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ยกเลิกการใช้งาน QR — ใช้ตอนใบถูกถ่ายรูปหลุดออกไปหรือปิดโต๊ะแบบ DYNAMIC
export async function invalidateQRCode(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "DELETE"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    const updated = await db.qRCode.updateMany({
      where: { id: parsed.data.id, status: "ACTIVE" },
      data: { status: "INVALIDATED", invalidatedAt: new Date() },
    })
    if (updated.count === 0) return { ok: false, error: "QR ใบนี้ถูกยกเลิกไปแล้ว" }
  } catch {
    return { ok: false, error: "ยกเลิก QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateQrPages()
  return { ok: true, message: "ยกเลิกการใช้งาน QR ใบนี้แล้ว" }
}

/// บันทึกว่าพิมพ์ใบเดิมซ้ำ — token เดิมยังใช้ได้ (ต่างจาก generate ที่ออก token ใหม่)
export async function reprintQRCode(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    const updated = await db.qRCode.updateMany({
      where: { id: parsed.data.id, status: "ACTIVE" },
      data: { issuedAt: new Date() },
    })
    if (updated.count === 0) return { ok: false, error: "QR ใบนี้ใช้งานไม่ได้แล้ว กรุณาสร้างใบใหม่" }
  } catch {
    return { ok: false, error: "บันทึกการพิมพ์ซ้ำไม่สำเร็จ" }
  }

  revalidateQrPages()
  return { ok: true, message: "บันทึกการพิมพ์ QR ซ้ำแล้ว" }
}

/// สร้าง QR ให้ทุกโต๊ะที่ยังไม่มีใบที่ใช้งานได้ (bulk) — ไม่แตะโต๊ะที่มี QR อยู่แล้ว
export async function generateMissingQRCodes(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const rawType = formData.get("type")
  const type = rawType === "DYNAMIC" ? "DYNAMIC" : "STATIC"

  try {
    const created = await db.$transaction(async (tx) => {
      const tables = await tx.table.findMany({
        where: { qrCodes: { none: { status: "ACTIVE" } } },
        select: { id: true },
      })

      for (const table of tables) {
        await tx.qRCode.create({ data: { storeId, tableId: table.id, type, token: newToken() } })
      }

      return tables.length
    })

    revalidateQrPages()
    return {
      ok: true,
      message:
        created === 0
          ? "ทุกโต๊ะมี QR ที่ใช้งานได้อยู่แล้ว"
          : `สร้าง QR ให้ ${created} โต๊ะที่ยังไม่มีเรียบร้อยแล้ว`,
    }
  } catch {
    return { ok: false, error: "สร้าง QR แบบชุดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
