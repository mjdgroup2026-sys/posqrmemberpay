/// แปล error ที่ Better Auth client คืนมา (`{ error: { code, status, message } }`) เป็นข้อความภาษาไทย
///
/// เดิมหน้า /login เดาจาก status อย่างเดียว — 403 ทุกตัวถูกบอกว่า "ยังไม่ได้ยืนยันอีเมล" (รวม INVALID_ORIGIN)
/// และ 429 ถูกบอกว่า "รหัสผ่านไม่ถูกต้อง" ผู้ใช้จึงไล่แก้ผิดจุด · ใช้ code ก่อนเสมอ status เป็นแค่ทางสำรอง
export type AuthClientError = { code?: string | null; status?: number | null; message?: string | null }

export function authErrorMessage(error: AuthClientError | null | undefined, action: "sign-in" | "sign-out"): string {
  const code = error?.code ?? ""
  const status = error?.status ?? 0

  if (code === "EMAIL_NOT_VERIFIED") {
    return "บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณากดลิงก์ในอีเมลที่ส่งไปให้ก่อนเข้าสู่ระบบ"
  }
  if (code === "INVALID_ORIGIN" || code === "MISSING_OR_NULL_ORIGIN") {
    return "เปิดระบบจากที่อยู่เว็บที่ไม่ได้รับอนุญาต กรุณาเข้าผ่านที่อยู่หลักของระบบแล้วลองใหม่"
  }
  if (status === 429) {
    return action === "sign-in"
      ? "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอประมาณ 10 วินาทีแล้วลองใหม่"
      : "ทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD" || status === 401) {
    return "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
  }

  // ไม่รู้จัก — แนบ code/status ไว้ท้ายข้อความ ครั้งหน้าที่ผู้ใช้แจ้งจะรู้สาเหตุทันทีโดยไม่ต้องเดา
  const detail = code || (status ? `HTTP ${status}` : "เชื่อมต่อไม่ได้")
  return action === "sign-in"
    ? `เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง (${detail})`
    : `ออกจากระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง (${detail})`
}
