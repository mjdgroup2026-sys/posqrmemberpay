import { describe, expect, it } from "vitest"
import { buildPromptPayPayload } from "@/lib/promptpay"

/// ค่า CRC ในเทสนี้คำนวณจากตัวเลข payload ที่ประกอบขึ้นมาเอง (ไม่ได้ hardcode จากที่อื่น)
/// จุดสำคัญที่ต้องกันไว้คือ **โครงและลำดับของ tag** — สลับที่แล้วแอปธนาคารบางตัวสแกนไม่ผ่าน
function tlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < payload.length) {
    const id = payload.slice(i, i + 2)
    const length = Number(payload.slice(i + 2, i + 4))
    out[id] = payload.slice(i + 4, i + 4 + length)
    i += 4 + length
  }
  return out
}

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

describe("PromptPay payload (Phase 10)", () => {
  it("ไม่ตั้ง PROMPTPAY_ID = สร้าง payload ไม่ได้", () => {
    expect(buildPromptPayPayload(100, undefined)).toBeNull()
    expect(buildPromptPayPayload(100, "")).toBeNull()
  })

  it("เลขผู้รับเงินที่ยาวไม่ถูกต้องต้องถูกปฏิเสธ ไม่ใช่สร้าง QR ที่โอนผิดบัญชี", () => {
    expect(buildPromptPayPayload(100, "12345")).toBeNull()
    expect(buildPromptPayPayload(100, "081234567890123456")).toBeNull()
  })

  it("เบอร์โทร 10 หลักถูกแปลงเป็นรูปแบบ 0066 ตามสเปกและใส่จำนวนเงินครบ", () => {
    const payload = buildPromptPayPayload(350.5, "0812345678")
    expect(payload).not.toBeNull()

    const fields = tlv(payload as string)
    expect(fields["00"]).toBe("01")
    // 12 = QR ใช้ครั้งเดียว เพราะระบุจำนวนเงินมาแล้ว
    expect(fields["01"]).toBe("12")
    expect(fields["53"]).toBe("764")
    expect(fields["54"]).toBe("350.50")
    expect(fields["58"]).toBe("TH")

    const merchant = tlv(fields["29"])
    expect(merchant["00"]).toBe("A000000677010111")
    expect(merchant["01"]).toBe("0066812345678")
  })

  it("เลขบัตรประชาชน 13 หลักใช้ tag 02 และไม่มีจำนวนเงินเมื่อยอดเป็น 0", () => {
    const payload = buildPromptPayPayload(0, "1234567890123") as string
    const fields = tlv(payload)

    // 11 = สแกนซ้ำได้ ใช้ตอนไม่ระบุจำนวนเงิน
    expect(fields["01"]).toBe("11")
    expect(fields["54"]).toBeUndefined()
    expect(tlv(fields["29"])["02"]).toBe("1234567890123")
  })

  it("tag เรียงจากน้อยไปมาก และ CRC ท้าย payload ตรงกับเนื้อหาข้างหน้า", () => {
    const payload = buildPromptPayPayload(120, "0812345678") as string

    const order: string[] = []
    let i = 0
    while (i < payload.length) {
      const id = payload.slice(i, i + 2)
      order.push(id)
      i += 4 + Number(payload.slice(i + 2, i + 4))
    }
    expect(order).toEqual(["00", "01", "29", "53", "54", "58", "63"])

    const body = payload.slice(0, -4)
    expect(body.endsWith("6304")).toBe(true)
    expect(payload.slice(-4)).toBe(crc16(body))
  })
})
