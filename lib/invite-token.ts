import { createHash, randomBytes } from "node:crypto"

/// token ของคำเชิญเข้าร้าน (Phase 14a)
///
/// token ดิบอยู่แค่ใน URL ที่ส่งไปทางอีเมล — ฐานเก็บแค่ SHA-256 (หลุดจากฐานแล้วใช้ไม่ได้)
/// แยกไฟล์ออกมาเพราะทั้ง lib/queries.ts (อ่าน), app/actions (เขียน) และเทส ต้องใช้ตัวเดียวกัน

/// อายุลิงก์เชิญ 7 วัน — ยาวพอให้พนักงานเปิดอีเมลทัน สั้นพอไม่ให้ลิงก์ค้างในกล่องจดหมายเป็นเดือน
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function newInviteToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
