"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { toNumber } from "@/lib/format"
import { registerMemberSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import { pointsFor } from "@/lib/points"
import type { ActionResult } from "@/lib/types"

class MemberAbort extends Error {
  constructor(readonly reason: string) {
    super("MEMBER_ABORT")
  }
}

export type RegisterMemberResult = {
  phone: string
  pointBalance: number
  earnedPoints: number
  alreadyMember: boolean
  alreadyAwarded: boolean
}

/// สมัครสมาชิก + รับแต้มจากบิลที่เพิ่งจ่าย บนหน้า payment-success (F22)
///
/// **ไม่เรียก `requireUser()` โดยตั้งใจ** — ลูกค้าไม่มีบัญชีพนักงาน ตัวระบุตัวตนคือ qrToken
/// ที่เดาไม่ได้ บวกกับเงื่อนไขว่าต้องมีบิลที่ปิดแล้วของโต๊ะนั้นจริง
///
/// กติกา §3: เบอร์ซ้ำ = เข้าบัญชีเดิม ไม่สร้างซ้ำ · ให้แต้มอัตโนมัติจากยอดบิล
/// idempotent ด้วย unique `MemberPointTransaction.saleId` — กดสมัครซ้ำบิลเดิมไม่ได้แต้มเพิ่ม
export async function registerMember(formData: FormData): Promise<ActionResult<RegisterMemberResult>> {
  const parsed = registerMemberSchema.safeParse({
    qrToken: formData.get("qrToken") ?? "",
    phone: formData.get("phone") ?? "",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { qrToken, phone } = parsed.data

  try {
    // ร้านของลูกค้า = ร้านเจ้าของ qrToken (Phase 13) — สมาชิก/แต้มผูกรายร้าน ไม่รวมข้ามร้าน
    const store = await findStoreByQrToken(qrToken)
    if (!store) throw new MemberAbort("ไม่พบ QR Code นี้ในระบบ")
    const storeId = store.storeId

    const result = await forStore(storeId).$transaction(async (tx) => {
      const settings = await tx.storeSettings.findUnique({
        where: { storeId },
        select: { crmEnabled: true },
      })
      if (!settings?.crmEnabled) throw new MemberAbort("ร้านนี้ยังไม่ได้เปิดระบบสมาชิก")

      const qr = await tx.qRCode.findUnique({
        where: { token: qrToken },
        select: { tableId: true, table: { select: { primaryTableId: true } } },
      })
      if (!qr) throw new MemberAbort("ไม่พบ QR Code นี้ในระบบ")

      // บิลล่าสุดของโต๊ะนั้น — สมัครได้เฉพาะหลังจ่ายเงินแล้วเท่านั้น (F22 อยู่บนหน้า payment-success)
      const tableId = qr.table.primaryTableId ?? qr.tableId
      const session = await tx.tableSession.findFirst({
        where: { tableId },
        orderBy: { openedAt: "desc" },
        select: { sale: { select: { id: true, total: true } } },
      })
      const sale = session?.sale
      if (!sale) throw new MemberAbort("ยังไม่มีบิลที่ชำระแล้วของโต๊ะนี้")

      const existing = await tx.member.findUnique({ where: { storeId_phone: { storeId, phone } }, select: { id: true } })
      const member = existing ?? (await tx.member.create({ data: { storeId, phone }, select: { id: true } }))

      // saleId เป็น unique — บิลเดียวให้แต้มได้ครั้งเดียว ไม่ว่าใครจะกดสมัครซ้ำกี่รอบ
      const awarded = await tx.memberPointTransaction.findUnique({
        where: { saleId: sale.id },
        select: { points: true },
      })

      let earnedPoints = 0
      if (!awarded) {
        earnedPoints = pointsFor(toNumber(sale.total))
        if (earnedPoints > 0) {
          await tx.memberPointTransaction.create({
            data: { memberId: member.id, saleId: sale.id, points: earnedPoints },
          })
          // pointBalance เป็น denormalized — ต้องอัปเดตในทรานแซคชันเดียวกับ ledger เสมอ
          await tx.member.update({
            where: { id: member.id },
            data: { pointBalance: { increment: earnedPoints } },
          })
        }
      }

      const fresh = await tx.member.findUniqueOrThrow({
        where: { id: member.id },
        select: { pointBalance: true },
      })

      return {
        phone,
        pointBalance: fresh.pointBalance,
        earnedPoints,
        alreadyMember: Boolean(existing),
        alreadyAwarded: Boolean(awarded),
      }
    })

    revalidatePath(`/order/${qrToken}/pay/success`)

    const message = result.alreadyAwarded
      ? `บิลนี้รับแต้มไปแล้ว — แต้มสะสมของคุณคือ ${result.pointBalance} แต้ม`
      : result.alreadyMember
        ? `ยินดีต้อนรับกลับ! ได้รับ ${result.earnedPoints} แต้ม รวมเป็น ${result.pointBalance} แต้ม`
        : `สมัครสมาชิกเรียบร้อย! ได้รับ ${result.earnedPoints} แต้ม รวมเป็น ${result.pointBalance} แต้ม`

    return { ok: true, message, data: result }
  } catch (error) {
    if (error instanceof MemberAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
