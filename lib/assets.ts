/// รูปภาพที่ร้านอัปโหลดเอง (Phase 17a) — ตรวจชนิดไฟล์และขนาดที่เดียว
///
/// ไม่ import "server-only" โดยตั้งใจ: ค่าคงที่ MAX_ASSET_BYTES/ACCEPT_ATTRIBUTE ถูกใช้ฝั่ง client
/// ด้วย (ตัวย่อรูปใน components/image-picker.tsx) ส่วนการอ่าน/เขียนฐานอยู่ใน action กับ route handler

/// เพดานขนาดไฟล์หลังย่อแล้ว — ฝั่ง client ย่อให้ ≤ 800px ก่อนส่งเสมอ ค่านี้คือด่านฝั่ง server
/// ที่ไม่เชื่อ client · 300KB × เมนูหลักร้อยรายการ ยังอยู่ในระดับที่ pg_dump รับไหว
export const MAX_ASSET_BYTES = 300_000

/// ด้านยาวสุดหลังย่อ และคุณภาพ JPEG ที่ใช้ตอนย่อในเบราว์เซอร์
export const MAX_ASSET_EDGE = 800
export const ASSET_JPEG_QUALITY = 0.8

/// ชนิดที่รับ — **ไม่มี SVG โดยตั้งใจ** เพราะ SVG ฝัง <script> ได้ ถ้าเสิร์ฟจากโดเมนเดียวกัน
/// = ช่อง XSS ที่ร้านไหนก็ยิงใส่ลูกค้าตัวเองได้
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

/// ค่า accept ของ <input type="file"> — คู่กับ ALLOWED_IMAGE_TYPES
export const ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_TYPES.join(",")

/// อ่านชนิดไฟล์จาก **ไบต์จริง** ไม่ใช่ค่า file.type ที่เบราว์เซอร์ส่งมา (ปลอมได้ตรง ๆ)
/// คืน null = ไม่ใช่รูปในชุดที่รับ
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png"

  // WebP: "RIFF" .... "WEBP"
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (riff === "RIFF" && webp === "WEBP") return "image/webp"
  }

  return null
}

export type AssetCheck = { ok: true; contentType: AllowedImageType } | { ok: false; error: string }

/// ด่านเดียวที่ตัดสินว่าไฟล์ที่อัปโหลดมาใช้ได้ไหม — action เรียกตัวนี้ ห้ามตรวจเองซ้ำที่อื่น
export function checkImageBytes(bytes: Uint8Array): AssetCheck {
  if (bytes.length === 0) return { ok: false, error: "ไฟล์รูปว่างเปล่า กรุณาเลือกรูปใหม่" }
  if (bytes.length > MAX_ASSET_BYTES) {
    return { ok: false, error: `ไฟล์รูปใหญ่เกินไป (สูงสุด ${Math.round(MAX_ASSET_BYTES / 1000)} KB)` }
  }

  const contentType = sniffImageType(bytes)
  if (!contentType) return { ok: false, error: "รองรับเฉพาะไฟล์ JPG, PNG และ WebP เท่านั้น" }

  return { ok: true, contentType }
}

/// URL ที่เก็บลง MenuItem.imageUrl / StoreSettings.logoUrl — เป็น path ภายในเว็บ
/// (ผ่าน regex ของ imageUrl ใน lib/validation.ts ที่ยอมรับค่าขึ้นต้นด้วย "/")
export function assetUrl(id: string): string {
  return `/api/assets/${id}`
}

/// ถอด id กลับจาก URL — ใช้ตอนลบรูปเก่าเมื่อร้านเปลี่ยนรูป · คืน null ถ้าไม่ใช่รูปที่เก็บในระบบ
/// (เช่น ลิงก์ภายนอกที่ร้านวางเอง — ห้ามไปยุ่งกับของนอกระบบ)
export function parseAssetId(url: string | null | undefined): string | null {
  if (!url) return null
  const match = /^\/api\/assets\/([A-Za-z0-9_-]{1,64})$/.exec(url.trim())
  return match ? match[1] : null
}
