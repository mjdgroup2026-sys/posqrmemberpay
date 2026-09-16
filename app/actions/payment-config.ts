"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { requireOwner, storeErrorMessage, type StoreContext } from "@/lib/session"
import { normalizePromptPayId } from "@/lib/subscription"
import { firstIssueMessage, paymentConfigSchema, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// ตั้งค่ารับเงินของร้าน (Phase 15a) — เฉพาะเจ้าของร้าน · เงินเข้าบัญชีร้านโดยตรงทุกโหมด
///
/// เจ้าของเลือกได้แค่ PROMPTPAY_DIRECT (ก) ในเฟสนี้: PROMPTPAY_SLIP รอผู้ให้บริการตรวจสลิป (15b) ·
/// SCB_BILLER ตั้งได้เฉพาะผู้ดูแลแพลตฟอร์ม (app/actions/admin.ts) เพราะ 15a ยังใช้ credential SCB จาก env
/// ของแพลตฟอร์ม — ปล่อยให้ร้านเลือกเอง = ลูกค้าของร้านนั้นจ่ายเข้าบัญชี SCB ของร้าน default
/// · ร้านที่ผู้ดูแลตั้งเป็น SCB_BILLER ไว้แล้ว บันทึกเลขพร้อมเพย์ต่อได้ (เป็น fallback ตอนธนาคารล่ม) แต่เปลี่ยนโหมดเองไม่ได้

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
    if (paymentMode === "PROMPTPAY_SLIP") {
      return { ok: false, error: "โหมดตรวจสลิปอัตโนมัติยังไม่เปิดให้ใช้ — เลือกพร้อมเพย์ตรงไปก่อน", fieldErrors: { paymentMode: "ยังไม่เปิดให้ใช้" } }
    }
    if (paymentMode === "SCB_BILLER" || store.paymentMode === "SCB_BILLER") {
      return {
        ok: false,
        error: "โหมดรับเงินผ่าน SCB ตั้งโดยผู้ดูแลระบบเท่านั้น — ติดต่อผู้ดูแลเพื่อเปิด/ปิด",
        fieldErrors: { paymentMode: "ติดต่อผู้ดูแลระบบ" },
      }
    }
  }
  if (paymentMode === "PROMPTPAY_DIRECT" && !normalized) {
    return { ok: false, error: "โหมดพร้อมเพย์ตรงต้องมีเลขพร้อมเพย์ของร้าน", fieldErrors: { promptPayId: "กรุณากรอกเลขพร้อมเพย์" } }
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
