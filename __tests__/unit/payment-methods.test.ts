import { describe, expect, it } from "vitest"
import { resolvePaymentProfile } from "@/lib/payment-methods"

/// กันบั๊กที่เคยหลุดขึ้น production มาแล้ว (Phase 10): ตั้ง SCB ครบแต่ปุ่ม "ชำระด้วยพร้อมเพย์" บนหน้าเลือกวิธีจ่าย
/// ยังถูกปิด เพราะหน้านั้นเช็คแค่เลขพร้อมเพย์ตัวเดียว → ลูกค้าจ่ายผ่าน QR ไม่ได้เลยทั้งที่ระบบพร้อม
/// Phase 15a: ตรรกะเดียวกันแต่เป็น "ต่อร้าน" — โหมด + เลขพร้อมเพย์ของร้าน + ผลของ isScbConfigured()

describe("resolvePaymentProfile (Phase 15a)", () => {
  it("PROMPTPAY_DIRECT: ไม่มีเลขพร้อมเพย์ = รับ QR ไม่ได้", () => {
    expect(resolvePaymentProfile("PROMPTPAY_DIRECT", null, true)).toMatchObject({ qrAvailable: false, autoSettle: false })
  })

  it("PROMPTPAY_DIRECT: มีเลขพร้อมเพย์ = รับ QR ได้ แต่พนักงานต้องกดยืนยัน (แม้ SCB ของแพลตฟอร์มจะตั้งอยู่)", () => {
    expect(resolvePaymentProfile("PROMPTPAY_DIRECT", "0812345678", true)).toMatchObject({ qrAvailable: true, autoSettle: false })
  })

  it("PROMPTPAY_DIRECT: เลขพร้อมเพย์รูปแบบผิดต้องไม่นับว่าพร้อม", () => {
    expect(resolvePaymentProfile("PROMPTPAY_DIRECT", "12345", false).qrAvailable).toBe(false)
  })

  it("PROMPTPAY_SLIP ทำงานเหมือน DIRECT จนกว่า 15b จะมา", () => {
    expect(resolvePaymentProfile("PROMPTPAY_SLIP", "0812345678", false)).toMatchObject({ qrAvailable: true, autoSettle: false })
  })

  it("SCB_BILLER + SCB ตั้งครบ (ไม่มีเลขพร้อมเพย์) ต้องรับ QR ได้และปิดบิลเอง ← บั๊กที่เคยหลุด", () => {
    expect(resolvePaymentProfile("SCB_BILLER", null, true)).toMatchObject({ qrAvailable: true, autoSettle: true })
  })

  it("SCB_BILLER แต่ SCB ยังไม่พร้อม (ขาด env) → ถอยไปใช้เลขพร้อมเพย์ของร้านถ้ามี · ไม่มีเลย = รับ QR ไม่ได้", () => {
    expect(resolvePaymentProfile("SCB_BILLER", "0812345678", false)).toMatchObject({ qrAvailable: true, autoSettle: false })
    expect(resolvePaymentProfile("SCB_BILLER", null, false)).toMatchObject({ qrAvailable: false, autoSettle: false })
  })
})
