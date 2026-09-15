/// รหัสจาก requireStore()/requireOwner()/requirePlatformAdmin() → ข้อความไทยที่ผู้ใช้เห็น
/// แยกจาก lib/session.ts เพราะไม่แตะ server-only/next/headers — เทสและ mock ใช้ตัวจริงตัวเดียวกันได้

export type StoreContextReason = "UNAUTHENTICATED" | "NO_STORE" | "STORE_SUSPENDED"

/// แปลงรหัสจาก requireStore()/requireOwner() เป็นข้อความที่ผู้ใช้เห็น
export function storeErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : ""
  switch (code) {
    case "UNAUTHENTICATED":
      return "กรุณาเข้าสู่ระบบก่อนทำรายการ"
    case "NO_STORE":
      return "บัญชีของคุณยังไม่ได้อยู่ในร้านใด กรุณาติดต่อเจ้าของร้านเพื่อขอเข้าร่วม"
    case "STORE_SUSPENDED":
      return "ร้านนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ"
    case "NOT_OWNER":
      return "เฉพาะเจ้าของร้านเท่านั้นที่ทำรายการนี้ได้"
    case "NOT_PLATFORM_ADMIN":
      return "เฉพาะผู้ดูแลระบบเท่านั้นที่ทำรายการนี้ได้"
    default:
      return "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
  }
}
