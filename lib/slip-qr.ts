/// ตรรกะล้วนเกี่ยวกับ mini-QR บนสลิปโอนเงิน (Phase 15b) — ไม่แตะ DB/เครือข่าย ให้ทั้ง server และ unit test ใช้ร่วมกัน
///
/// สลิปของทุกแอปธนาคารไทยมี QR มุมสลิปเป็น EMV TLV: tag 00 = version, tag 01 = "รหัสรายการโอน"
/// (ข้างในคือ รหัสธนาคารผู้โอน + transRef ที่ผู้ให้บริการตรวจสลิปเอาไปถามระบบกลาง), tag 51 = ประเทศ, tag 91 = CRC
/// เราไม่ตรวจ CRC เอง — ผู้ให้บริการเป็นคนยืนยันความถูกต้อง เราแค่ดึง transRef มาใช้ log/กันซ้ำล่วงหน้า

export type SlipQrInfo = {
  /// รหัสรายการโอนตามที่อยู่ใน QR (ใช้เป็น key กันสลิปซ้ำ)
  transRef: string
  /// รหัสธนาคารผู้โอน 3 หลัก (เช่น 014 = SCB, 004 = KBANK) — ข้อมูลประกอบเท่านั้น
  sendingBankCode: string | null
}

/// payload จำลองสำหรับ provider "mock" (dev/เทส): `MOCK|<transRef>|<amount>|<receiverId>|<minutesAgo>`
/// receiverId = เลขพร้อมเพย์หรือเลขบัญชีของร้านที่ "โอนเข้า" · minutesAgo = สลิปเก่ากี่นาที (ว่าง = ตอนนี้)
export const MOCK_PAYLOAD_PREFIX = "MOCK|"

export type MockSlipPayload = { transRef: string; amount: number; receiverId: string; minutesAgo: number }

export function parseMockPayload(payload: string): MockSlipPayload | null {
  if (!payload.startsWith(MOCK_PAYLOAD_PREFIX)) return null
  const [, transRef = "", amountText = "", receiverId = "", minutesText = ""] = payload.split("|")
  const amount = Number(amountText)
  const minutesAgo = minutesText === "" ? 0 : Number(minutesText)
  if (!transRef || !Number.isFinite(amount) || amount <= 0 || !receiverId || !Number.isFinite(minutesAgo)) return null
  return { transRef: transRef.trim(), amount, receiverId: receiverId.trim(), minutesAgo }
}

/// อ่าน TLV ชั้นนอกของ payload — คืน null ถ้าไม่ใช่รูปแบบ EMV ที่คุ้นเคย
function readTlv(payload: string): Map<string, string> | null {
  const out = new Map<string, string>()
  let i = 0
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2)
    const length = Number(payload.slice(i + 2, i + 4))
    if (!/^\d{2}$/.test(tag) || !Number.isFinite(length)) return null
    const value = payload.slice(i + 4, i + 4 + length)
    if (value.length !== length) return null
    out.set(tag, value)
    i += 4 + length
  }
  return out.size > 0 ? out : null
}

/// ดึง transRef จาก QR บนสลิปจริง — tag 01 ข้างในเป็น TLV ซ้อน: 00 = AID (A000000677010112), 01 = รหัสธนาคาร, 02 = transRef
export function parseSlipQr(payload: string): SlipQrInfo | null {
  const mock = parseMockPayload(payload)
  if (mock) return { transRef: mock.transRef, sendingBankCode: null }

  const outer = readTlv(payload.trim())
  const inner = outer?.get("01") ? readTlv(outer.get("01") as string) : null
  const transRef = inner?.get("02")?.trim()
  if (!transRef) return null
  return { transRef, sendingBankCode: inner?.get("01") ?? null }
}

/// เทียบเลขบัญชี/พร้อมเพย์ที่ผู้ให้บริการ **ปิดบางหลัก** (เช่น "xxx-x-x1234-x", "xxx-xxx-1234") กับเลขเต็มที่ร้านกรอกไว้
/// กติกา: ไล่จากหลังไปหน้าเฉพาะตำแหน่งที่เป็นตัวเลขทั้งสองฝั่ง ต้องตรงทุกตำแหน่ง และต้องมีตัวเลขที่เปิดเผยให้เทียบ ≥ 4 หลัก
/// (ป้องกันสลิปโอนเข้าบัญชีอื่นที่เลขลงท้ายคล้ายกันผ่านได้ด้วยหลักเดียว)
export function maskedAccountMatches(masked: string | null | undefined, full: string | null | undefined): boolean {
  if (!masked || !full) return false
  const m = masked.toLowerCase().replace(/[^0-9x]/g, "")
  const f = full.replace(/\D/g, "")
  if (!m || !f) return false
  let compared = 0
  for (let i = 1; i <= m.length && i <= f.length; i += 1) {
    const a = m[m.length - i]
    const b = f[f.length - i]
    if (a === "x") continue
    if (a !== b) return false
    compared += 1
  }
  return compared >= 4
}
