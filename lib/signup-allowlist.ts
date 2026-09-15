/// นโยบายการสมัครสมาชิกเอง (Phase 5 allowlist → Phase 14a เปิดสมัครได้)
///
/// **ประวัติ**: v1 ไม่มีระบบสิทธิ์ ใครสมัครสำเร็จก็เป็นพนักงานเต็มตัวของร้านเดียวทันที จึงต้องมี allowlist
/// กันคนนอก · ตั้งแต่ Phase 13 ผู้สมัครใหม่ไม่มี `StoreMember` → เห็นได้แค่ `/no-store`/`/onboarding`/`/settings`
/// การเปิดสมัครจึงปลอดภัย: ได้แค่ร้านเปล่าของตัวเอง ไม่ได้เข้าหลังร้านของใคร
///
/// โหมด (เรียงตามลำดับที่ตรวจ):
///   SIGNUP_OPEN=true                         → ใครก็สมัครได้ (แพลตฟอร์ม Phase 14a)
///   SIGNUP_ALLOWED_EMAILS / _DOMAINS         → เฉพาะรายชื่อ (โหมดเดิม — ใช้เมื่อ SIGNUP_OPEN ไม่ใช่ true)
///   ไม่ตั้งอะไรเลย                              → ปฏิเสธทุกคน (fail closed) — production ที่ยังไม่ตั้ง env ใหม่
///                                               จึงไม่เปิดรับคนทั้งโลกโดยไม่รู้ตัว

function parseList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

export type SignupPolicy = {
  /// SIGNUP_OPEN=true — ข้าม allowlist ทั้งหมด
  open: boolean
  emails: string[]
  domains: string[]
  /// ไม่ได้ตั้งค่าอะไรเลย (ไม่เปิด และไม่มี allowlist) — สมัครไม่ได้สักคน
  unconfigured: boolean
}

export function readSignupPolicy(env: NodeJS.ProcessEnv = process.env): SignupPolicy {
  const open = (env.SIGNUP_OPEN ?? "").trim().toLowerCase() === "true"
  const emails = parseList(env.SIGNUP_ALLOWED_EMAILS)
  // ตัด "@" นำหน้าให้ด้วย เผื่อคนตั้งเป็น "@example.com" ตามสัญชาตญาณ
  const domains = parseList(env.SIGNUP_ALLOWED_DOMAINS).map((d) => d.replace(/^@/, ""))
  return { open, emails, domains, unconfigured: !open && emails.length === 0 && domains.length === 0 }
}

/// อีเมลนี้สมัครเองได้ไหม — เทียบแบบ case-insensitive และตัดช่องว่างหัวท้ายทิ้งก่อนเสมอ
export function isSignupAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const policy = readSignupPolicy(env)
  if (policy.unconfigured) return false

  const normalized = email.trim().toLowerCase()
  // ต้องมี @ และมีอะไรอยู่ทั้งสองฝั่งพอดีหนึ่งตัว — กัน "a@b@c" เล็ดลอดไปเทียบโดเมนผิดตัว
  // (โหมดเปิดก็ยังต้องผ่านด่านรูปแบบนี้ ส่วนความถูกต้องจริงของอีเมลพิสูจน์ด้วยการยืนยันอีเมล)
  const parts = normalized.split("@")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false

  if (policy.open) return true
  if (policy.emails.includes(normalized)) return true
  return policy.domains.includes(parts[1])
}
