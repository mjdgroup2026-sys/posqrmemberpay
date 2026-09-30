"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { guardAction } from "@/lib/permissions"
import { businessDateOnly, businessDayKey, businessDayRange, parseBusinessDayKey } from "@/lib/day"
import { closingSchema, firstIssueMessage, reopenClosingSchema, zodToFieldErrors } from "@/lib/validation"
import { formatBusinessDate, toNumber } from "@/lib/format"
import { bucketByChannel } from "@/lib/closing-channels"
import type { ActionResult } from "@/lib/types"


function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

class ClosingAbort extends Error {
  constructor(readonly reason: string) {
    super("CLOSING_ABORT")
  }
}

/// ปิดยอด — **ปิดได้หลายรอบต่อวัน** (2026-09-29) · Phase 19: เลือกวันปิดรอบได้ (ย้อนหลังเท่านั้น)
///
/// รอบหนึ่ง = บิลของแคชเชียร์คนนี้ในวันนั้นที่ **ยังไม่ถูกปิดรอบ** (Sale.closingId null) ณ ตอนกด
/// ลำดับในทรานแซคชันเดียว: สร้างแถวรอบ n (unique ร้าน+คน+วัน+รอบ กันกดซ้อน) → ผูกบิลที่ยังว่างเข้ารอบนี้ด้วย
/// updateMany where closingId null → คำนวณยอดจากบิลที่ผูกได้จริง → บันทึกยอด
/// บิลที่ commit ระหว่างนั้นไม่ถูกผูก จึงไปอยู่รอบถัดไปเอง ไม่หล่นและไม่นับซ้ำ · บิลที่ผูกแล้ว void ไม่ได้ (sales.ts)
/// ยังไม่มีรอบที่ใช้อยู่ = ปิดได้แม้ไม่มีบิล (เหมือนเดิม) · มีรอบที่ปิดอยู่แล้ว = ต้องมีบิลใหม่อย่างน้อย 1 ใบ
/// เลขรอบ = สูงสุด + 1 นับรวมรอบที่ถูกเปิดใหม่ (แถวเดิมยังอยู่เป็นประวัติ) — รอบ 2 ถูกเปิดใหม่ ปิดอีกครั้งได้รอบ 3
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
    // ยอดจริงของช่องทางอื่น (20g) — ไม่ส่ง/เว้นว่าง = ไม่ได้กรอก
    countedTransfer: formData.get("countedTransfer"),
    countedQR: formData.get("countedQR"),
    countedPromptPay: formData.get("countedPromptPay"),
    countedCard: formData.get("countedCard"),
    note: formData.get("note") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { countedCash, countedTransfer, countedQR, countedPromptPay, countedCard, note } = parsed.data
  const optional = (value: number | null) => (value === null ? null : round2(value).toFixed(2))
  const closingDay = parseBusinessDayKey(parsed.data.closingDate)
  if (!closingDay) {
    return {
      ok: false,
      error: "วันที่ปิดรอบไม่ถูกต้อง — เลือกได้เฉพาะวันนี้หรือย้อนหลัง",
      fieldErrors: { closingDate: "เลือกได้เฉพาะวันนี้หรือย้อนหลัง" },
    }
  }
  const { start, end } = businessDayRange(closingDay)
  const closingDate = businessDateOnly(closingDay)
  const openBills = { cashierId: user.id, closingId: null, createdAt: { gte: start, lt: end } }

  try {
    const { gap: difference, roundNo } = await db.$transaction(async (tx) => {
      const last = await tx.cashierClosing.aggregate({
        where: { cashierId: user.id, closingDate },
        _max: { roundNo: true },
      })
      const roundNo = (last._max.roundNo ?? 0) + 1
      const activeRounds = await tx.cashierClosing.count({ where: { cashierId: user.id, closingDate, reopenedAt: null } })
      if (activeRounds > 0 && (await tx.sale.count({ where: openBills })) === 0) {
        throw new ClosingAbort("ไม่มีบิลใหม่หลังปิดรอบล่าสุด — ยังไม่ต้องปิดรอบเพิ่ม")
      }

      // สร้างแถวรอบก่อน (ยอดจริงเติมท้ายทรานแซคชัน) — กดพร้อมกันสองครั้งชน unique ที่นี่ ผ่านได้ครั้งเดียว
      const round = await tx.cashierClosing.create({
        data: {
          storeId,
          cashierId: user.id,
          closingDate,
          roundNo,
          totalSales: "0",
          totalCash: "0",
          totalTransfer: "0",
          totalQR: "0",
          countedCash: round2(countedCash).toFixed(2),
          difference: "0",
        },
        select: { id: true },
      })
      await tx.sale.updateMany({ where: openBills, data: { closingId: round.id } })

      const bills = await tx.sale.findMany({
        where: { closingId: round.id },
        select: { total: true, paymentMethod: true, status: true },
      })
      const completed = bills.filter((b) => b.status === "COMPLETED")
      const voidedCount = bills.length - completed.length

      // แยกถังด้วยตัวเดียวกับหน้าจอ (20g — พร้อมเพย์แยกจากบัตรแล้ว)
      const { totals, totalSales } = bucketByChannel(
        completed.map((sale) => ({ paymentMethod: sale.paymentMethod, total: toNumber(sale.total), bills: 1 })),
      )

      const gap = round2(countedCash - totals.CASH)

      await tx.cashierClosing.update({
        where: { id: round.id },
        data: {
          totalSales: totalSales.toFixed(2),
          totalCash: totals.CASH.toFixed(2),
          totalTransfer: totals.TRANSFER.toFixed(2),
          totalQR: totals.QR.toFixed(2),
          totalPromptPay: totals.PROMPTPAY.toFixed(2),
          totalCard: totals.CARD.toFixed(2),
          billCount: completed.length,
          voidedCount,
          difference: gap.toFixed(2),
          countedTransfer: optional(countedTransfer),
          countedQR: optional(countedQR),
          countedPromptPay: optional(countedPromptPay),
          countedCard: optional(countedCard),
          note,
        },
      })

      return { gap, roundNo }
    })

    revalidatePath("/pos/closing")
    revalidatePath("/pos/history")

    const verdict =
      difference === 0
        ? "เงินสดตรงพอดี"
        : difference > 0
          ? `เงินเกิน ${difference.toFixed(2)} บาท`
          : `เงินขาด ${Math.abs(difference).toFixed(2)} บาท`

    return { ok: true, message: `ปิดยอดรอบที่ ${roundNo} ของวันที่ ${formatBusinessDate(closingDay)} เรียบร้อยแล้ว — ${verdict}` }
  } catch (error) {
    if (error instanceof ClosingAbort) return { ok: false, error: error.reason }
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: "มีการปิดรอบนี้พร้อมกันจากอีกหน้าจอ — รีเฟรชหน้าแล้วตรวจยอดอีกครั้ง" }
    }
    return { ok: false, error: "ปิดยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// เปิดรอบที่ปิดแล้วใหม่ (2026-09-30) — ต้องมีสิทธิ์ POS_CLOSING:EDIT และใส่เหตุผล
///
/// ถอดบิลของรอบนั้นกลับเป็น "ยังไม่ปิดรอบ" (void ได้อีกครั้ง) แล้วแคชเชียร์เจ้าของบิลปิดเป็นรอบถัดไปเอง ·
/// แถวรอบเดิมไม่ลบ ตั้ง reopenedAt/คนเปิด/เหตุผลไว้เป็นประวัติ และไม่ถูกนับในสรุปใดอีก ·
/// เปิดได้เฉพาะรอบล่าสุดที่ยังใช้อยู่ของคนนั้นในวันนั้น (บิลจะได้ไม่สลับลำดับรอบ) ·
/// กดพร้อมกัน = conditional update where reopenedAt null ผ่านได้ครั้งเดียว ·
/// ถ้าแคชเชียร์ปิดรอบถัดไปชนจังหวะเดียวกันพอดี ผลที่แย่ที่สุดคือเปิดรอบที่ไม่ใช่ล่าสุด — บิลที่ถูกถอดไปอยู่รอบถัดไป ไม่หล่นและไม่นับซ้ำ
export async function reopenCashierClosing(formData: FormData): Promise<ActionResult> {
  const guard = await guardAction("POS_CLOSING", "EDIT")
  if (!guard.ok) return { ok: false, error: guard.error }
  const db = forStore(guard.user.storeId)

  const parsed = reopenClosingSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { id, reason } = parsed.data

  try {
    const round = await db.$transaction(async (tx) => {
      const round = await tx.cashierClosing.findUnique({
        where: { id },
        select: { id: true, cashierId: true, closingDate: true, roundNo: true, reopenedAt: true },
      })
      if (!round) throw new ClosingAbort("ไม่พบรอบปิดยอดนี้")
      if (round.reopenedAt) throw new ClosingAbort(`รอบที่ ${round.roundNo} ถูกเปิดใหม่ไปแล้ว`)

      const later = await tx.cashierClosing.findFirst({
        where: { cashierId: round.cashierId, closingDate: round.closingDate, reopenedAt: null, roundNo: { gt: round.roundNo } },
        orderBy: { roundNo: "desc" },
        select: { roundNo: true },
      })
      if (later) throw new ClosingAbort(`เปิดใหม่ได้เฉพาะรอบล่าสุด — รอบล่าสุดของวันนั้นคือรอบที่ ${later.roundNo}`)

      const claimed = await tx.cashierClosing.updateMany({
        where: { id, reopenedAt: null },
        data: { reopenedAt: new Date(), reopenedById: guard.user.id, reopenReason: reason },
      })
      if (claimed.count !== 1) throw new ClosingAbort("รอบนี้ถูกเปิดใหม่จากอีกหน้าจอแล้ว — รีเฟรชหน้าแล้วตรวจอีกครั้ง")

      await tx.sale.updateMany({ where: { closingId: id }, data: { closingId: null } })
      return round
    })

    revalidatePath("/pos/closing")
    revalidatePath("/pos/history")
    return {
      ok: true,
      message: `เปิดรอบที่ ${round.roundNo} ของวันที่ ${formatBusinessDate(round.closingDate)} ใหม่แล้ว — บิลกลับไปรอปิดรอบถัดไป`,
    }
  } catch (error) {
    if (error instanceof ClosingAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "เปิดรอบใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
