/// origin ที่ยอมให้ล็อกอิน/ออกจากระบบได้นอกเหนือจาก BETTER_AUTH_URL (Better Auth `trustedOrigins`)
///
/// ค่าเริ่มต้นของ Better Auth ยอมเฉพาะ origin ของ BETTER_AUTH_URL เป๊ะ ๆ — เปิด dev ด้วย 127.0.0.1 แทน localhost
/// (หรือ IP ในวง LAN ตอนทดสอบกับมือถือ) จะได้ 403 INVALID_ORIGIN ทั้ง sign-in และ sign-out
/// · dev/test: ยอม localhost/127.0.0.1 พอร์ตเดียวกับ BETTER_AUTH_URL ให้เอง
/// · production: เฉพาะที่ระบุใน env BETTER_AUTH_TRUSTED_ORIGINS (คั่นด้วย comma) ไม่ตั้ง = เข้มเท่าเดิม —
///   ห้ามเดา origin ให้ production เพราะนี่คือด่านกัน CSRF ของการล็อกอิน
export function resolveTrustedOrigins(env: Record<string, string | undefined>): string[] {
  const extra = (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
  if (env.NODE_ENV === "production") return extra

  let port = "3001"
  try {
    port = new URL(env.BETTER_AUTH_URL ?? "http://localhost:3001").port || port
  } catch {
    // BETTER_AUTH_URL ผิดรูปแบบ — ใช้พอร์ต dev มาตรฐาน
  }
  return [...extra, `http://localhost:${port}`, `http://127.0.0.1:${port}`]
}
