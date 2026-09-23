"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { dateOnlyFromKey, parseHhMm } from "@/lib/day"
import { copyShiftsSchema, firstIssueMessage, shiftSchema, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// กะทำงานของพนักงานนวด (Phase 20b) — สิทธิ์เดียวกับประวัติพนักงาน (`SPA_THERAPISTS:EDIT`)
///
/// กะเป็น "ข้อมูลของพนักงาน" ไม่ใช่ของคิว จึงไม่ผูกกับ `SPA_BOOKINGS` — หัวหน้าที่จัดกะได้ไม่จำเป็นต้องรับจองด้วย
/// · เก็บรายวัน (ดู schema) การตั้งทั้งสัปดาห์คือ `copyShifts` ที่เขียนแถวรายวันให้ครบ

function revalidateShiftPages(storeId: string) {
  publishStoreEvent(storeId, "bookings")
  revalidatePath("/spa/shifts")
  revalidatePath("/spa/bookings")
  revalidatePath("/spa/board")
}

export async function saveShift(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_THERAPISTS", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = shiftSchema.safeParse({
    therapistId: formData.get("therapistId"),
    workDate: formData.get("workDate"),
    startTime: formData.get("startTime") ?? "",
    endTime: formData.get("endTime") ?? "",
    isOff: formData.get("isOff") === "true" || formData.get("isOff") === "on",
    note: formData.get("note") ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const data = parsed.data

  // FK จากฟอร์มต้องเป็นของร้านนี้ (กติกาข้อ 5) — forStore กรอง storeId ให้แล้ว หาไม่เจอ = ของร้านอื่น
  const therapist = await db.therapist.findUnique({ where: { id: data.therapistId }, select: { id: true, code: true } })
  if (!therapist) return { ok: false, error: "ไม่พบพนักงานนวดคนนี้ในร้าน" }

  const startMinute = parseHhMm(data.startTime) ?? 0
  const endMinute = parseHhMm(data.endTime) ?? 0

  await db.therapistShift.upsert({
    where: { therapistId_workDate: { therapistId: therapist.id, workDate: dateOnlyFromKey(data.workDate) } },
    create: {
      storeId,
      therapistId: therapist.id,
      workDate: dateOnlyFromKey(data.workDate),
      startMinute,
      endMinute,
      isOff: data.isOff,
      note: data.note ?? null,
    },
    update: { startMinute, endMinute, isOff: data.isOff, note: data.note ?? null },
  })

  revalidateShiftPages(storeId)
  return { ok: true, message: data.isOff ? `บันทึกวันหยุดของ ${therapist.code} แล้ว` : `บันทึกกะของ ${therapist.code} แล้ว` }
}

/// ลบกะของวันนั้น = กลับไปเป็น "ยังไม่ตั้งกะ" (ต่างจากวันหยุด ซึ่งเป็นแถวที่ isOff = true)
export async function deleteShift(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_THERAPISTS", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const therapistId = String(formData.get("therapistId") ?? "")
  const workDate = String(formData.get("workDate") ?? "")
  if (!therapistId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { ok: false, error: "ไม่พบกะที่ต้องการลบ" }

  const removed = await db.therapistShift.deleteMany({ where: { therapistId, workDate: dateOnlyFromKey(workDate) } })
  if (removed.count === 0) return { ok: false, error: "ไม่พบกะที่ต้องการลบ" }

  revalidateShiftPages(storeId)
  return { ok: true, message: "ลบกะของวันนี้แล้ว" }
}

/// คัดลอกกะของทั้งร้านจากวันหนึ่งไปหลายวัน — ปุ่ม "ทั้งสัปดาห์" / "ไปสัปดาห์หน้า" ในหน้าตารางกะ
///
/// เขียนทับวันปลายทางทั้งวัน (ลบแล้วสร้างใหม่) ในทรานแซคชันเดียว เพื่อให้ผลลัพธ์เหมือนวันต้นทางเป๊ะ ๆ
/// ไม่ใช่ "รวมกัน" ซึ่งอ่านยากเวลาคนจัดกะแก้แล้วคัดลอกซ้ำ
export async function copyShifts(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_THERAPISTS", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = copyShiftsSchema.safeParse({
    sourceDate: formData.get("sourceDate"),
    targetDates: formData.get("targetDates"),
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { sourceDate, targetDates } = parsed.data
  const targets = [...new Set(targetDates)].filter((day) => day !== sourceDate)
  if (targets.length === 0) return { ok: false, error: "วันปลายทางต้องไม่ใช่วันต้นทาง" }

  const source = await db.therapistShift.findMany({
    where: { workDate: dateOnlyFromKey(sourceDate) },
    select: { therapistId: true, startMinute: true, endMinute: true, isOff: true, note: true },
  })
  if (source.length === 0) return { ok: false, error: "วันต้นทางยังไม่ได้ตั้งกะของใครเลย" }

  await db.$transaction(async (tx) => {
    for (const day of targets) {
      await tx.therapistShift.deleteMany({ where: { workDate: dateOnlyFromKey(day) } })
      await tx.therapistShift.createMany({
        data: source.map((row) => ({ ...row, storeId, workDate: dateOnlyFromKey(day) })),
      })
    }
  })

  revalidateShiftPages(storeId)
  return { ok: true, message: `คัดลอกกะไป ${targets.length} วันแล้ว` }
}
