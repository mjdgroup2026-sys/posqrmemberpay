/// สร้าง payload ของ PromptPay ตามมาตรฐาน EMVCo QR (Thai QR Payment)
///
/// สร้างเองในโปรเจกต์โดยตั้งใจ ไม่ผูกกับผู้ให้บริการรายใดรายหนึ่ง — ตัว payload เป็นมาตรฐานกลาง
/// ที่ทุกแอปธนาคารไทยอ่านได้ ส่วน "การยืนยันว่าจ่ายแล้ว" ต่างหากที่ต้องพึ่ง provider
/// (ดู app/api/payments/webhook/route.ts และปุ่มยืนยันด้วยมือในหน้าปิดบิล)
///
/// เลขผู้รับเงินส่งเข้ามาเป็นพารามิเตอร์เสมอ (Phase 15a — เป็นของร้าน อยู่ที่ StorePaymentConfig.promptPayId ·
/// ค่าใช้งานของแพลตฟอร์มใช้ env PLATFORM_PROMPTPAY_ID) — **ไม่มี default จาก env** เพื่อไม่ให้ร้านไหนเผลอออก QR
/// ด้วยเลขของคนอื่น (env PROMPTPAY_ID เดิมเลิกใช้แล้ว):
///   - เบอร์โทร 10 หลัก เช่น 0812345678
///   - เลขบัตรประชาชน 13 หลัก
///   - เลขนิติบุคคล 13 หลัก
/// ไม่มีเลข = คืน null → หน้าชำระเงินบอกให้ใช้วิธีอื่นแทน

const PAYLOAD_FORMAT = "00"
const POINT_OF_INITIATION = "01"
const MERCHANT_ACCOUNT_PROMPTPAY = "29"
const COUNTRY = "58"
const CURRENCY = "53"
const AMOUNT = "54"
const CRC = "63"

const AID_PROMPTPAY = "A000000677010111"
const TAG_MOBILE = "01"
const TAG_NATIONAL_ID = "02"

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`
}

/// เบอร์โทรต้องแปลงเป็นรูปแบบ 13 หลักขึ้นต้นด้วยรหัสประเทศ (0066…) ตามสเปกของ PromptPay
function normalizeTarget(raw: string): { tag: string; value: string } | null {
  const digits = raw.replace(/[^0-9]/g, "")

  if (digits.length === 10 && digits.startsWith("0")) {
    return { tag: TAG_MOBILE, value: `0066${digits.slice(1)}`.padStart(13, "0") }
  }
  if (digits.length === 13) {
    return { tag: TAG_NATIONAL_ID, value: digits }
  }
  return null
}

/// CRC-16/CCITT-FALSE ตามที่ EMVCo กำหนด (poly 0x1021, init 0xFFFF)
function crc16(input: string): string {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

/// คืน payload string ที่เอาไป render เป็น QR ได้ทันที — คืน null ถ้าเลขผู้รับว่าง/ใช้ไม่ได้
export function buildPromptPayPayload(amount: number, promptPayId: string | null | undefined): string | null {
  if (!promptPayId) return null
  const target = normalizeTarget(promptPayId)
  if (!target) return null

  const merchantAccount = field(MERCHANT_ACCOUNT_PROMPTPAY, [
    field("00", AID_PROMPTPAY),
    field(target.tag, target.value),
  ].join(""))

  const parts = [
    field(PAYLOAD_FORMAT, "01"),
    // 12 = ใช้ได้ครั้งเดียว (ระบุจำนวนเงินมาแล้ว) ต่างจาก 11 ที่สแกนซ้ำได้
    field(POINT_OF_INITIATION, amount > 0 ? "12" : "11"),
    merchantAccount,
    // EMVCo เรียง tag จากน้อยไปมาก: 53 (สกุลเงิน) → 54 (จำนวนเงิน) → 58 (ประเทศ)
    // แอปธนาคารบางตัวอ่านแบบ sequential แล้วหยุดเมื่อเจอ tag ที่ข้ามลำดับ สลับที่กันแล้วสแกนไม่ผ่าน
    field(CURRENCY, "764"),
    ...(amount > 0 ? [field(AMOUNT, amount.toFixed(2))] : []),
    field(COUNTRY, "TH"),
  ]

  const withoutCrc = `${parts.join("")}${CRC}04`
  return `${withoutCrc}${crc16(withoutCrc)}`
}
