"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { requireOwner, storeErrorMessage, type StoreContext } from "@/lib/session"
import { normalizePromptPayId } from "@/lib/subscription"
import { isSlipVerificationConfigured } from "@/lib/slip-provider"
import { getStoreScb } from "@/lib/scb-store"
import { firstIssueMessage, paymentConfigSchema, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// ตั้งค่ารับเงินของร้าน (Phase 15a) — เฉพาะเจ้าของร้าน · เงินเข้าบัญชีร้านโดยตรงทุกโหมด
///
/// เจ้าของเลือกได้ PROMPTPAY_DIRECT (ก) และ PROMPTPAY_SLIP (ก+ — เมื่อแพลตฟอร์มตั้ง SLIP_PROVIDER แล้ว, Phase 15b) ·
/// SCB_BILLER (ข — Phase 15c): เจ้าของเลือกเองได้เมื่อ credential SCB **ของร้าน** ผ่านการทดสอบแล้ว (scbVerifiedAt) ·
/// ร้านที่ใช้ env ของแพลตฟอร์ม (ร้าน default) ยังต้องให้ผู้ดูแลตั้ง (app/actions/admin.ts) และเปลี่ยนโหมดเองไม่ได้
/// · ร้านโหมด SCB บันทึกเลขพร้อมเพย์ต่อได้ (เป็น fallback ตอนธนาคารล่ม)

function revalidatePaymentPages() {
  revalidatePath("/mobile-order/settings")
  revalidatePath("/billing")
  revalidatePath("/admin/stores")
  // หน้าลูกค้าตัดสินใจจากโหมด/เลขพร้อมเพย์ของร้าน
  revalidatePath("/order", "layout")
}

export async function updatePaymentConfig(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = paymentConfigSchema.safeParse({
    paymentMode: formData.get("paymentMode"),
    promptPayId: formData.get("promptPayId") ?? "",
    accountName: formData.get("accountName") ?? "",
    bankAccountNumber: formData.get("bankAccountNumber") ?? "",
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { paymentMode, promptPayId, accountName, bankAccountNumber } = parsed.data

  let normalized: string | null = null
  if (promptPayId !== "") {
    normalized = normalizePromptPayId(promptPayId)
    if (!normalized) {
      return {
        ok: false,
        error: "รูปแบบเลขพร้อมเพย์ไม่ถูกต้อง — ใช้เบอร์โทร 10 หลัก เลขบัตรประชาชน 13 หลัก หรือ e-Wallet 15 หลัก",
        fieldErrors: { promptPayId: "รูปแบบไม่ถูกต้อง" },
      }
    }
  }

  const db = forStore(ctx.storeId)
  const store = await db.store.findUniqueOrThrow({ where: { id: ctx.storeId }, select: { paymentMode: true } })

  if (paymentMode !== store.paymentMode) {
    if (paymentMode === "PROMPTPAY_SLIP" && !isSlipVerificationConfigured()) {
      return { ok: false, error: "ระบบตรวจสลิปอัตโนมัติยังไม่เปิดให้ใช้ — เลือกพร้อมเพย์ตรงไปก่อน", fieldErrors: { paymentMode: "ยังไม่เปิดให้ใช้" } }
    }
    if (paymentMode === "SCB_BILLER" || store.paymentMode === "SCB_BILLER") {
      // เปลี่ยนเข้า/ออกโหมด SCB เองได้เฉพาะร้านที่มี credential ของตัวเองผ่านการทดสอบแล้ว — ร้านที่พึ่ง env ต้องให้ผู้ดูแล
      const scb = await getStoreScb(ctx.storeId)
      if (!scb || scb.source !== "store") {
        return {
          ok: false,
          error:
            paymentMode === "SCB_BILLER"
              ? "เปิดโหมด SCB ได้เมื่อกรอก credential SCB ของร้านและผ่าน “ทดสอบการเชื่อมต่อ” แล้ว (หรือให้ผู้ดูแลระบบตั้งให้)"
              : "โหมด SCB ของร้านนี้ตั้งโดยผู้ดูแลระบบ — ติดต่อผู้ดูแลเพื่อเปลี่ยน",
          fieldErrors: { paymentMode: "ยังเปลี่ยนไม่ได้" },
        }
      }
    }
  }
  if ((paymentMode === "PROMPTPAY_DIRECT" || paymentMode === "PROMPTPAY_SLIP") && !normalized) {
    return { ok: false, error: "โหมดพร้อมเพย์ต้องมีเลขพร้อมเพย์ของร้าน", fieldErrors: { promptPayId: "กรุณากรอกเลขพร้อมเพย์" } }
  }

  await db.$transaction(async (tx) => {
    await tx.storePaymentConfig.upsert({
      where: { storeId: ctx.storeId },
      update: { promptPayId: normalized, accountName: accountName || null, bankAccountNumber: bankAccountNumber || null, updatedById: ctx.user.id },
      create: {
        storeId: ctx.storeId,
        promptPayId: normalized,
        accountName: accountName || null,
        bankAccountNumber: bankAccountNumber || null,
        updatedById: ctx.user.id,
      },
    })
    if (paymentMode !== store.paymentMode) {
      await tx.store.update({ where: { id: ctx.storeId }, data: { paymentMode } })
    }
  })

  revalidatePaymentPages()
  return { ok: true, message: "บันทึกการตั้งค่ารับเงินแล้ว" }
}
