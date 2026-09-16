import { describe, expect, it } from "vitest"
import { maskedAccountMatches, parseMockPayload, parseSlipQr } from "@/lib/slip-qr"

/// ตรรกะล้วนของ Phase 15b — อ่าน mini-QR บนสลิป และเทียบเลขบัญชีที่ผู้ให้บริการปิดบางหลัก

/// payload จริงตามโครง EMV: 00 02 01 | 01 46 [ 00 16 A000000677010112 | 01 03 014 | 02 15 <transRef 15 ตัว> ] | 51 02 TH | 91 04 XXXX
const REAL = "0002010146" + "0016A000000677010112" + "0103014" + "0215202609161234567" + "5102TH" + "9104ABCD"

describe("parseSlipQr", () => {
  it("ดึง transRef และรหัสธนาคารผู้โอนจาก QR สลิปจริง", () => {
    expect(parseSlipQr(REAL)).toEqual({ transRef: "202609161234567", sendingBankCode: "014" })
  })

  it("payload ขยะ/สั้น/ไม่ใช่ TLV → null", () => {
    expect(parseSlipQr("hello world")).toBeNull()
    expect(parseSlipQr("")).toBeNull()
    expect(parseSlipQr("0002019999")).toBeNull()
  })

  it("payload จำลอง MOCK|… ให้ transRef เดียวกับที่ parseMockPayload อ่าน", () => {
    expect(parseSlipQr("MOCK|TX-1|120|0812345678|0")).toEqual({ transRef: "TX-1", sendingBankCode: null })
    expect(parseMockPayload("MOCK|TX-1|120.50|0812345678|5")).toEqual({ transRef: "TX-1", amount: 120.5, receiverId: "0812345678", minutesAgo: 5 })
    expect(parseMockPayload("MOCK|TX-1|abc|0812345678")).toBeNull()
    expect(parseMockPayload("MOCK|TX-1|120|")).toBeNull()
  })
})

describe("maskedAccountMatches", () => {
  it("เลขปิดบางหลักแบบธนาคาร/พร้อมเพย์ ต้องเทียบหลักที่เปิดเผยจากท้ายให้ตรงทุกตำแหน่ง", () => {
    expect(maskedAccountMatches("xxx-x-x1234-x", "1234598765")).toBe(false)
    expect(maskedAccountMatches("xxx-x-x2345-6", "12345123457")).toBe(false)
    expect(maskedAccountMatches("xxx-x-x2345-6", "123452345-6")).toBe(true)
    expect(maskedAccountMatches("xxx-xxx-5678", "0812345678")).toBe(true)
    expect(maskedAccountMatches("xxx-xxx-5679", "0812345678")).toBe(false)
    expect(maskedAccountMatches("XXX-XXX-5678", "081-234-5678")).toBe(true)
  })

  it("mock คืนเลขเต็ม → ต้องตรงทั้งเลข", () => {
    expect(maskedAccountMatches("0812345678", "0812345678")).toBe(true)
    expect(maskedAccountMatches("0812345678", "0899995678")).toBe(false)
  })

  it("เปิดเผยน้อยกว่า 4 หลัก หรือค่าว่าง → ไม่ผ่าน (กันเดาหลักเดียวแล้วผ่าน)", () => {
    expect(maskedAccountMatches("xxxxxx678", "0812345678")).toBe(false)
    expect(maskedAccountMatches(null, "0812345678")).toBe(false)
    expect(maskedAccountMatches("xxx-xxx-5678", null)).toBe(false)
    expect(maskedAccountMatches("xxxxxxxxxx", "0812345678")).toBe(false)
  })
})
