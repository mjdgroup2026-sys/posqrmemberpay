"use server"

import { revalidatePath } from "next/cache"
// ค่าตั้งของแพลตฟอร์มไม่มี storeId (ข้อมูลอ้างอิงของแพลตฟอร์ม) — ไม่มี forStore() ให้ใช้
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { requirePlatformAdmin, storeErrorMessage } from "@/lib/session"
import { PLATFORM_SETTING_ID } from "@/lib/platform-settings"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { firstIssueMessage, platformPromptPaySchema, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// ผู้ดูแลแพลตฟอร์มตั้งพร้อมเพย์ที่ร้านโอนค่าใช้งานเข้า (2026-10-05) — เลขนี้กำหนดว่าเงินค่าใช้งานของทุกร้านเข้าบัญชีไหน
/// จึงบันทึกผู้แก้ล่าสุดไว้เสมอ · เก็บเป็นตัวเลขล้วน · ตรวจว่าสร้าง QR ได้จริงก่อนบันทึก · ช่องเลขว่าง = กลับไปใช้ env เดิม
export async function updatePlatformPromptPay(formData: FormData): Promise<ActionResult> {
  let admin: { id: string }
  try {
    admin = await requirePlatformAdmin()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = platformPromptPaySchema.safeParse({
    promptPayId: formData.get("promptPayId") ?? "",
    promptPayName: formData.get("promptPayName") ?? "",
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  const digits = parsed.data.promptPayId.replace(/[^0-9]/g, "")
  if (digits && !buildPromptPayPayload(1, digits)) {
    const error = "เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน/นิติบุคคล 13 หลัก"
    return { ok: false, error, fieldErrors: { promptPayId: error } }
  }
  if (digits && !parsed.data.promptPayName) {
    const error = "กรุณากรอกชื่อบัญชีผู้รับ ให้ร้านเทียบกับชื่อในแอปธนาคารก่อนโอน"
    return { ok: false, error, fieldErrors: { promptPayName: error } }
  }

  const data = {
    promptPayId: digits || null,
    promptPayName: digits ? parsed.data.promptPayName : null,
    updatedById: admin.id,
  }
  await prisma.platformSetting.upsert({
    where: { id: PLATFORM_SETTING_ID },
    create: { id: PLATFORM_SETTING_ID, ...data },
    update: data,
  })

  revalidatePath("/admin/settings")
  revalidatePath("/billing")
  revalidatePath("/brand/billing")
  return { ok: true, message: digits ? "บันทึกพร้อมเพย์ของแพลตฟอร์มแล้ว" : "ล้างเลขแล้ว — กลับไปใช้ค่าจากเซิร์ฟเวอร์ (ถ้ามี)" }
}
