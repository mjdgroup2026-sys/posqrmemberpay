"use server"

import { forStore } from "@/lib/db"
import { requireStoreAccess } from "@/lib/permissions"
import { storeErrorMessage } from "@/lib/store-errors"
import { assetUrl, checkImageBytes, parseAssetId } from "@/lib/assets"
import type { ActionResult } from "@/lib/types"

/// อัปโหลดรูปของร้าน (Phase 17a) — รับ File ตรงจาก Server Action ไม่ต้องทำ route multipart เอง
///
/// ด่านสิทธิ์: จัดการเมนู (MO_MENU:ADD/EDIT) — OWNER ได้ทุก resource อยู่แล้วจึงใช้ตัวเดียวกันนี้
/// กับรูปโลโก้/ปกในหน้าตั้งค่าร้าน (หน้านั้นเป็น OWNER-only อยู่แล้ว)
export async function uploadStoreAsset(formData: FormData): Promise<ActionResult<{ url: string }>> {
  let storeId: string
  let userId: string
  try {
    const context = await requireStoreAccess(["MO_MENU", "ADD"], ["MO_MENU", "EDIT"])
    storeId = context.storeId
    userId = context.user.id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const file = formData.get("file")
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์รูปที่อัปโหลด กรุณาเลือกรูปใหม่" }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const checked = checkImageBytes(bytes)
  if (!checked.ok) return { ok: false, error: checked.error }

  try {
    const asset = await forStore(storeId).storeAsset.create({
      data: {
        storeId,
        contentType: checked.contentType,
        byteSize: bytes.byteLength,
        data: Buffer.from(bytes),
        uploadedById: userId,
      },
      select: { id: true },
    })
    return { ok: true, message: "อัปโหลดรูปเรียบร้อยแล้ว", data: { url: assetUrl(asset.id) } }
  } catch {
    return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ลบรูปที่เพิ่งอัปโหลดแล้วผู้ใช้เปลี่ยนใจ **ก่อนกดบันทึก** (ImagePicker เรียกเฉพาะรูปที่ตัวเองเพิ่งอัปในรอบนั้น
/// จึงไม่มีทางไปลบรูปที่บันทึกไว้แล้ว) — ส่วนรูปเก่าที่ถูกแทนที่ตอนกดบันทึก ถูกลบในทรานแซคชันเดียวกับการบันทึก
/// ที่ action ของแต่ละฟอร์ม (saveMenuItem / deleteMenuItem / updateStoreSettings)
export async function deleteStoreAsset(formData: FormData): Promise<ActionResult> {
  let storeId: string
  try {
    const context = await requireStoreAccess(["MO_MENU", "ADD"], ["MO_MENU", "EDIT"])
    storeId = context.storeId
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const id = parseAssetId(String(formData.get("url") ?? ""))
  if (!id) return { ok: false, error: "ไม่พบรูปที่ต้องการลบ" }

  try {
    // deleteMany + extension ของ forStore() = ลบได้เฉพาะรูปของร้านตัวเอง (id ของร้านอื่นได้ count 0)
    const removed = await forStore(storeId).storeAsset.deleteMany({ where: { id } })
    if (removed.count === 0) return { ok: false, error: "ไม่พบรูปที่ต้องการลบ" }
    return { ok: true, message: "ลบรูปเรียบร้อยแล้ว" }
  } catch {
    return { ok: false, error: "ลบรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
