"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { requireStore, storeErrorMessage, type StoreContext } from "@/lib/session"
import { idSchema, firstIssueMessage } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"


function revalidateNotificationPages() {
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/notifications")
}

/// กด "รับทราบ" — ไม่เปลี่ยนสถานะฐานของโต๊ะ (ORDERED/AWAITING_BILL) เป็นแค่ badge ซ้อนทับ (§3 F12)
export async function acknowledgeNotification(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStore()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const user = ctx.user
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    // ★ conditional update — กันสองคนกดรับทราบพร้อมกันแล้วชื่อผู้รับทราบทับกัน
    const updated = await db.notification.updateMany({
      where: { id: parsed.data.id, status: "PENDING" },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: user.id },
    })
    if (updated.count === 0) {
      return { ok: false, error: "การแจ้งเตือนนี้ถูกรับทราบไปแล้ว" }
    }
  } catch {
    return { ok: false, error: "รับทราบการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateNotificationPages()
  return { ok: true, message: "รับทราบการแจ้งเตือนแล้ว" }
}

export async function acknowledgeAllNotifications(): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStore()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const user = ctx.user
  const storeId = ctx.storeId
  const db = forStore(storeId)

  try {
    const updated = await db.notification.updateMany({
      where: { status: "PENDING" },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: user.id },
    })

    revalidateNotificationPages()
    return {
      ok: true,
      message:
        updated.count === 0
          ? "ไม่มีการแจ้งเตือนที่รอรับทราบ"
          : `รับทราบการแจ้งเตือน ${updated.count} รายการแล้ว`,
    }
  } catch {
    return { ok: false, error: "รับทราบการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
