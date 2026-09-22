"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { guardAction } from "@/lib/permissions"
import { businessDateOnly, businessDayKey, businessDayRange, parseBusinessDayKey } from "@/lib/day"
import { closingSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import { formatBusinessDate, toNumber } from "@/lib/format"
import type { ActionResult } from "@/lib/types"


function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/// ปิดยอดประจำวัน — 1 ครั้ง/แคชเชียร์/วัน (unique cashierId+closingDate เป็นด่านจริง)
/// Phase 19: เลือกวันปิดรอบได้ (ย้อนหลังเท่านั้น) — ทุกยอดคำนวณจากช่วงเวลาของวันที่เลือก ไม่ใช่วันนี้เสมอ
/// void บิลของวันนั้นถูกล็อกตามมาเอง เพราะ voidSale เช็ค CashierClosing ตามวันของบิล (sales.ts)
/// ยอดทั้งหมดคำนวณสดจาก Sale ในทรานแซคชันเดียวกัน ไม่รับตัวเลขสรุปจากฝั่ง client
export async function closeCashierDay(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ POS_CLOSING:ADD ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("POS_CLOSING", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)
  const user = guard.user

  const parsed = closingSchema.safeParse({
    // ไม่ส่งวันที่มา = วันนี้ (ผู้เรียกเดิม/เทสเดิมยังใช้ได้) — ส่งมาแล้วต้องเป็นวันที่มีจริงและไม่ใช่อนาคต
    closingDate: formData.get("closingDate") ?? businessDayKey(),
    countedCash: formData.get("countedCash"),
    note: formData.get("note") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { countedCash, note } = parsed.data
  const closingDay = parseBusinessDayKey(parsed.data.closingDate)
  if (!closingDay) {
    return {
      ok: false,
      error: "วันที่ปิดรอบไม่ถูกต้อง — เลือกได้เฉพาะวันนี้หรือย้อนหลัง",
      fieldErrors: { closingDate: "เลือกได้เฉพาะวันนี้หรือย้อนหลัง" },
    }
  }
  const { start, end } = businessDayRange(closingDay)

  try {
    const difference = await db.$transaction(async (tx) => {
      const [completed, voidedCount] = await Promise.all([
        tx.sale.findMany({
          where: { cashierId: user.id, status: "COMPLETED", createdAt: { gte: start, lt: end } },
          select: { total: true, paymentMethod: true },
        }),
        tx.sale.count({
          where: { cashierId: user.id, status: "VOIDED", voidedAt: { gte: start, lt: end } },
        }),
      ])

      let totalSales = 0
      let totalCash = 0
      let totalTransfer = 0
      let totalQR = 0
      let totalCard = 0
      for (const sale of completed) {
        const value = toNumber(sale.total)
        totalSales += value
        if (sale.paymentMethod === "CASH") totalCash += value
        else if (sale.paymentMethod === "TRANSFER") totalTransfer += value
        else if (sale.paymentMethod === "QR") totalQR += value
        // พร้อมเพย์/บัตรจาก MJD Mobile Order — ไม่กระทบเงินสดในลิ้นชัก จึงแยกถังของตัวเอง (Phase 10)
        else totalCard += value
      }

      const gap = round2(countedCash - round2(totalCash))

      await tx.cashierClosing.create({
        data: {
          storeId,
          cashierId: user.id,
          closingDate: businessDateOnly(closingDay),
          totalSales: round2(totalSales).toFixed(2),
          totalCash: round2(totalCash).toFixed(2),
          totalTransfer: round2(totalTransfer).toFixed(2),
          totalQR: round2(totalQR).toFixed(2),
          totalCard: round2(totalCard).toFixed(2),
          billCount: completed.length,
          voidedCount,
          countedCash: round2(countedCash).toFixed(2),
          difference: gap.toFixed(2),
          note,
        },
      })

      return gap
    })

    revalidatePath("/pos/closing")
    revalidatePath("/pos/history")

    const verdict =
      difference === 0
        ? "เงินสดตรงพอดี"
        : difference > 0
          ? `เงินเกิน ${difference.toFixed(2)} บาท`
          : `เงินขาด ${Math.abs(difference).toFixed(2)} บาท`

    return { ok: true, message: `ปิดยอดรอบวันที่ ${formatBusinessDate(closingDay)} เรียบร้อยแล้ว — ${verdict}` }
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: "ปิดยอดของวันที่นี้ไปแล้ว — ปิดซ้ำวันเดิมไม่ได้" }
    }
    return { ok: false, error: "ปิดยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
