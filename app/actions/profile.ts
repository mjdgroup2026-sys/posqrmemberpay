"use server"

import { revalidatePath } from "next/cache"
// โปรไฟล์เป็นข้อมูล "ของตัวผู้ใช้" ไม่ใช่ของร้าน (ตาราง user ไม่มี storeId) — ไม่ผ่าน forStore() โดยตั้งใจ
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"
import { profileSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  let user
  try {
    user = await requireUser()
  } catch {
    return { ok: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" }
  }

  const parsed = profileSchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  try {
    await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name } })
  } catch {
    return { ok: false, error: "บันทึกโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidatePath("/settings")
  revalidatePath("/users")
  return { ok: true, message: "บันทึกโปรไฟล์เรียบร้อยแล้ว" }
}
