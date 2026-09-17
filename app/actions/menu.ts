"use server"

import { revalidatePath } from "next/cache"
import { forStore, type StoreTx } from "@/lib/db"
import { storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { parseAssetId } from "@/lib/assets"
import { menuItemSchema, idSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// จัดการเมนูอาหาร (master data ของ MJD Mobile Order)
///
/// เดิมเมนูมาจาก `prisma/seed-mobile-order.ts` ทางเดียว — ร้านจริงต้องเพิ่ม/แก้/ปิดใช้งานเองได้


class MenuAbort extends Error {
  constructor(readonly reason: string) {
    super("MENU_ABORT")
  }
}

function revalidateMenuPages(storeId: string) {
  publishStoreEvent(storeId, "menu")
  revalidatePath("/mobile-order/menu")
  revalidatePath("/mobile-order/settings")
  // เมนูฝั่งลูกค้าอ่านจากตารางเดียวกัน
  revalidatePath("/order", "layout")
}

/// ตัวเลือกเสริมทั้งชุดของเมนูหนึ่งรายการ — ส่งมาเป็น JSON แล้วเขียนทับทั้งก้อน
///
/// เขียนทับได้อย่างปลอดภัยเพราะ `MobileOrderItem.selectedOptionsSnapshot` เก็บชื่อ/ราคา
/// ณ เวลาสั่งไว้แล้ว การลบกลุ่มตัวเลือกจึงไม่ทำให้ออร์เดอร์เก่าหรือบิลที่ออกไปแล้วเพี้ยน
type GroupInput = {
  name: string
  selectionType: "SINGLE" | "MULTIPLE"
  required: boolean
  options: { name: string; priceDelta: number }[]
}

function parseGroups(raw: FormDataEntryValue | null): GroupInput[] {
  if (typeof raw !== "string" || !raw.trim()) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new MenuAbort("ข้อมูลตัวเลือกเสริมไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่")
  }
  if (!Array.isArray(parsed)) throw new MenuAbort("ข้อมูลตัวเลือกเสริมไม่ถูกต้อง")
  if (parsed.length > 10) throw new MenuAbort("ใส่กลุ่มตัวเลือกได้สูงสุด 10 กลุ่มต่อเมนู")

  return parsed.map((entry, index) => {
    const record = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim() : ""
    if (!name) throw new MenuAbort(`กลุ่มตัวเลือกที่ ${index + 1} ยังไม่ได้ตั้งชื่อ`)

    const rawOptions = Array.isArray(record.options) ? record.options : []
    if (rawOptions.length === 0) throw new MenuAbort(`กลุ่ม "${name}" ต้องมีตัวเลือกอย่างน้อย 1 รายการ`)
    if (rawOptions.length > 20) throw new MenuAbort(`กลุ่ม "${name}" ใส่ตัวเลือกได้สูงสุด 20 รายการ`)

    const options = rawOptions.map((option) => {
      const row = (typeof option === "object" && option !== null ? option : {}) as Record<string, unknown>
      const optionName = typeof row.name === "string" ? row.name.trim() : ""
      if (!optionName) throw new MenuAbort(`กลุ่ม "${name}" มีตัวเลือกที่ยังไม่ได้ตั้งชื่อ`)

      const priceDelta = Number(row.priceDelta ?? 0)
      if (!Number.isFinite(priceDelta) || Math.abs(priceDelta) > 999_999) {
        throw new MenuAbort(`ราคาส่วนต่างของ "${optionName}" ไม่ถูกต้อง`)
      }
      return { name: optionName, priceDelta }
    })

    return {
      name,
      selectionType: record.selectionType === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
      required: record.required === true,
      options,
    }
  })
}

async function writeGroups(
  tx: StoreTx,
  storeId: string,
  menuItemId: string,
  groups: GroupInput[],
) {
  // ลบทั้งชุดแล้วสร้างใหม่ — option ถูก cascade ตามกลุ่มไปเอง
  await tx.modifierGroup.deleteMany({ where: { menuItemId } })
  for (const [index, group] of groups.entries()) {
    await tx.modifierGroup.create({
      data: {
        storeId,
        menuItemId,
        name: group.name,
        selectionType: group.selectionType,
        required: group.required,
        sortOrder: index,
        options: {
          create: group.options.map((option, optionIndex) => ({
            name: option.name,
            priceDelta: option.priceDelta.toFixed(2),
            sortOrder: optionIndex,
          })),
        },
      },
    })
  }
}

export async function saveMenuItem(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_MENU", formData.get("id") ? "EDIT" : "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = menuItemSchema.safeParse({
    id: formData.get("id") ?? undefined,
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    price: formData.get("price"),
    imageUrl: formData.get("imageUrl") ?? "",
    isActive: formData.get("isActive") === "true" || formData.get("isActive") === "on",
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  const data = parsed.data

  try {
    const groups = parseGroups(formData.get("modifierGroups"))

    await db.$transaction(async (tx) => {
      // รูปเดิมที่ถูกแทนที่ต้องถูกลบในทรานแซคชันเดียวกัน ไม่งั้นไบต์รูปค้างในฐานไปเรื่อย ๆ (Phase 17a)
      // ลบเฉพาะรูปที่เก็บในระบบ (`/api/assets/<id>`) — ลิงก์ภายนอกที่ร้านวางเองไม่ใช่ของเรา
      if (data.id) {
        const previous = await tx.menuItem.findUnique({
          where: { id: data.id },
          select: { imageUrl: true },
        })
        const staleId = parseAssetId(previous?.imageUrl)
        if (staleId && staleId !== parseAssetId(data.imageUrl)) {
          await tx.storeAsset.deleteMany({ where: { id: staleId } })
        }
      }

      const menuItemId = data.id
        ? (
            await tx.menuItem.update({
              where: { id: data.id },
              data: {
                name: data.name,
                description: data.description ?? null,
                price: data.price.toFixed(2),
                imageUrl: data.imageUrl,
                isActive: data.isActive,
              },
              select: { id: true },
            })
          ).id
        : (
            await tx.menuItem.create({
              data: {
                storeId,
                name: data.name,
                description: data.description ?? null,
                price: data.price.toFixed(2),
                imageUrl: data.imageUrl,
                isActive: data.isActive,
              },
              select: { id: true },
            })
          ).id

      await writeGroups(tx, storeId, menuItemId, groups)
    })
  } catch (error) {
    if (error instanceof MenuAbort) return { ok: false, error: error.reason }
    if ((error as { code?: string }).code === "P2025") return { ok: false, error: "ไม่พบเมนูที่ต้องการแก้ไข" }
    return { ok: false, error: "บันทึกเมนูไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateMenuPages(storeId)
  return { ok: true, message: data.id ? `บันทึกเมนู ${data.name} แล้ว` : `เพิ่มเมนู ${data.name} เรียบร้อยแล้ว` }
}

export async function deleteMenuItem(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_MENU", "DELETE"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    await db.$transaction(async (tx) => {
      const item = await tx.menuItem.findUnique({
        where: { id: parsed.data.id },
        select: { name: true, imageUrl: true, _count: { select: { orderItems: true, saleItems: true } } },
      })
      if (!item) throw new MenuAbort("ไม่พบเมนูที่ต้องการลบ")

      // ★ เมนูที่เคยถูกสั่งหรืออยู่ในบิลแล้วลบไม่ได้ — SaleItem.menuItemId อ้างถึงอยู่
      //   ลบทิ้งเท่ากับทำให้ประวัติการขายชี้ไปที่ว่าง · ให้ "ปิดใช้งาน" แทน
      const used = item._count.orderItems + item._count.saleItems
      if (used > 0) {
        throw new MenuAbort(
          `ลบไม่ได้ — เมนู ${item.name} เคยถูกสั่งไปแล้ว ${used} รายการ กรุณาปิดใช้งานแทนเพื่อซ่อนจากลูกค้า`,
        )
      }

      await tx.menuItem.delete({ where: { id: parsed.data.id } })

      // ลบรูปของเมนูที่ถูกลบไปด้วย (Phase 17a) — ไม่มีใครอ้างถึงอีกแล้ว
      const assetId = parseAssetId(item.imageUrl)
      if (assetId) await tx.storeAsset.deleteMany({ where: { id: assetId } })
    })
  } catch (error) {
    if (error instanceof MenuAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "ลบเมนูไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateMenuPages(storeId)
  return { ok: true, message: "ลบเมนูเรียบร้อยแล้ว" }
}

/// สลับเปิด/ปิดการขายอย่างเร็วจากหน้ารายการ โดยไม่ต้องเปิด dialog
export async function toggleMenuItemActive(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_MENU", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  let next: boolean
  try {
    const item = await db.menuItem.findUnique({
      where: { id: parsed.data.id },
      select: { isActive: true },
    })
    if (!item) return { ok: false, error: "ไม่พบเมนูนี้" }
    next = !item.isActive
    await db.menuItem.update({ where: { id: parsed.data.id }, data: { isActive: next } })
  } catch {
    return { ok: false, error: "เปลี่ยนสถานะเมนูไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateMenuPages(storeId)
  return { ok: true, message: next ? "เปิดขายเมนูนี้แล้ว" : "ปิดขายเมนูนี้แล้ว" }
}
