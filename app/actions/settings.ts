"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { requireOwner, storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { parseAssetId } from "@/lib/assets"
import {
  storeSettingsSchema,
  featuredMenuSchema,
  MAX_FEATURED_MENU,
  firstIssueMessage,
  zodToFieldErrors,
} from "@/lib/validation"
import type { ActionResult } from "@/lib/types"


function revalidateSettingsPages() {
  revalidatePath("/mobile-order/settings")
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/kitchen")
  revalidatePath("/mobile-order/pos")
  // หน้าฝั่งลูกค้าอ่านชื่อร้าน/สี/เมนูแนะนำจาก StoreSettings เหมือนกัน
  revalidatePath("/order", "layout")
}

/// ตั้งค่าแบรนด์/ธีม/ค่าบริการของร้าน (F21) — เฉพาะเจ้าของร้าน (Phase 13)
export async function updateStoreSettings(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const user = ctx.user
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = storeSettingsSchema.safeParse({
    storeName: formData.get("storeName") ?? "",
    themeColor: formData.get("themeColor") ?? "",
    logoUrl: formData.get("logoUrl") ?? "",
    coverImageUrl: formData.get("coverImageUrl") ?? "",
    serviceChargePercent: formData.get("serviceChargePercent") ?? "0",
    hasKDS: formData.get("hasKDS") === "on" || formData.get("hasKDS") === "true",
    kitchenAlertSound: formData.get("kitchenAlertSound") === "on" || formData.get("kitchenAlertSound") === "true",
    kitchenAutoPrint: formData.get("kitchenAutoPrint") === "on" || formData.get("kitchenAutoPrint") === "true",
    spaEnabled: formData.get("spaEnabled") === "on" || formData.get("spaEnabled") === "true",
    posDefaultMode: formData.get("posDefaultMode") ?? "TABLE",
    crmEnabled: formData.get("crmEnabled") === "on" || formData.get("crmEnabled") === "true",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const data = parsed.data

  try {
    await db.$transaction(async (tx) => {
      const current = await tx.storeSettings.findUnique({
        where: { storeId },
        select: { hasKDS: true, logoUrl: true, coverImageUrl: true },
      })

      // รูปที่ถูกแทนที่ต้องถูกลบในทรานแซคชันเดียวกับการบันทึก (Phase 17a) — เฉพาะรูปที่เก็บในระบบ
      for (const [before, after] of [
        [current?.logoUrl, data.logoUrl],
        [current?.coverImageUrl, data.coverImageUrl],
      ] as const) {
        const staleId = parseAssetId(before)
        if (staleId && staleId !== parseAssetId(after)) {
          await tx.storeAsset.deleteMany({ where: { id: staleId } })
        }
      }

      // ★ ห้ามสลับ hasKDS ขณะมีโต๊ะเปิดอยู่ — รายการที่ค้างอยู่ระหว่าง COOKING/READY จะกำพร้า
      //   เพราะปุ่มที่ใช้เดินสถานะต่อ (KDS หรือปุ่ม "เสิร์ฟแล้ว" บนหน้าโต๊ะ) หายไปพร้อมกับ UI
      //   เช็คในทรานแซคชันเดียวกับการเขียน ไม่ใช่เช็คก่อนแล้วค่อยเขียน
      if (current && current.hasKDS !== data.hasKDS) {
        const openTables = await tx.tableSession.count({
          where: { status: { in: ["OPEN", "AWAITING_BILL"] } },
        })
        if (openTables > 0) {
          throw new SettingsAbort(
            `สลับโหมดครัวไม่ได้ตอนนี้ — ยังมีโต๊ะเปิดอยู่ ${openTables} โต๊ะ กรุณาปิดบิลให้ครบก่อน`,
          )
        }
      }

      await tx.storeSettings.upsert({
        where: { storeId },
        update: {
          storeName: data.storeName,
          themeColor: data.themeColor,
          logoUrl: data.logoUrl,
          coverImageUrl: data.coverImageUrl,
          serviceChargePercent: data.serviceChargePercent.toFixed(2),
          hasKDS: data.hasKDS,
          kitchenAlertSound: data.kitchenAlertSound,
          kitchenAutoPrint: data.kitchenAutoPrint,
          spaEnabled: data.spaEnabled,
          posDefaultMode: data.posDefaultMode,
          crmEnabled: data.crmEnabled,
          updatedById: user.id,
        },
        create: {
          storeId,
          storeName: data.storeName,
          themeColor: data.themeColor,
          logoUrl: data.logoUrl,
          coverImageUrl: data.coverImageUrl,
          serviceChargePercent: data.serviceChargePercent.toFixed(2),
          hasKDS: data.hasKDS,
          kitchenAlertSound: data.kitchenAlertSound,
          kitchenAutoPrint: data.kitchenAutoPrint,
          spaEnabled: data.spaEnabled,
          posDefaultMode: data.posDefaultMode,
          crmEnabled: data.crmEnabled,
          updatedById: user.id,
        },
      })
    })
  } catch (error) {
    if (error instanceof SettingsAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateSettingsPages()
  return { ok: true, message: "บันทึกการตั้งค่าเรียบร้อยแล้ว" }
}

/// ปักหมุด/จัดลำดับเมนูแนะนำ — ลำดับใน `menuItemIds` คือลำดับที่ลูกค้าเห็น (F21)
export async function setFeaturedMenu(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_MENU", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const raw = formData.get("menuItemIds")
  const ids = typeof raw === "string" && raw.trim() ? raw.split(",").map((v) => v.trim()).filter(Boolean) : []

  const parsed = featuredMenuSchema.safeParse({ menuItemIds: ids })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  const chosen = parsed.data.menuItemIds

  try {
    await db.$transaction(async (tx) => {
      const found = await tx.menuItem.count({ where: { id: { in: chosen } } })
      if (found !== chosen.length) throw new SettingsAbort("มีเมนูที่เลือกไว้ถูกลบไปแล้ว กรุณารีเฟรชหน้า")

      // ล้างหมุดเดิมทั้งหมดก่อน แล้วค่อยตั้งใหม่ตามลำดับที่ส่งมา — กันเมนูที่ถูกถอด
      // ออกจากรายการค้างสถานะ featured ไว้
      await tx.menuItem.updateMany({
        where: { isFeatured: true },
        data: { isFeatured: false, featuredSortOrder: null },
      })
      for (const [index, id] of chosen.entries()) {
        await tx.menuItem.update({
          where: { id },
          data: { isFeatured: true, featuredSortOrder: index },
        })
      }
    })
  } catch (error) {
    if (error instanceof SettingsAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "บันทึกเมนูแนะนำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateSettingsPages()
  revalidatePath("/order", "layout")
  return {
    ok: true,
    message:
      chosen.length === 0
        ? "ล้างเมนูแนะนำแล้ว"
        : `ตั้งเมนูแนะนำ ${chosen.length} รายการเรียบร้อยแล้ว (สูงสุด ${MAX_FEATURED_MENU})`,
  }
}

class SettingsAbort extends Error {
  constructor(readonly reason: string) {
    super("SETTINGS_ABORT")
  }
}
