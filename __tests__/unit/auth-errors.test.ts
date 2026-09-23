import { describe, expect, it } from "vitest"
import { authErrorMessage } from "@/lib/auth-errors"
import { resolveTrustedOrigins } from "@/lib/auth-origins"

/// ข้อความ error ของการล็อกอิน/ออกจากระบบ — เดิมหน้า /login เดาจาก status จนบอกสาเหตุผิด
/// (403 INVALID_ORIGIN ถูกบอกว่า "ยังไม่ยืนยันอีเมล" · 429 ถูกบอกว่า "รหัสผ่านผิด")
describe("lib/auth-errors — แปล error ของ Better Auth เป็นข้อความไทย", () => {
  it("ยังไม่ยืนยันอีเมล ดูจาก code เท่านั้น", () => {
    expect(authErrorMessage({ code: "EMAIL_NOT_VERIFIED", status: 403 }, "sign-in")).toContain("ยังไม่ได้ยืนยันอีเมล")
  })

  it("403 INVALID_ORIGIN ต้องไม่ถูกบอกว่ายังไม่ยืนยันอีเมล", () => {
    const message = authErrorMessage({ code: "INVALID_ORIGIN", status: 403 }, "sign-in")
    expect(message).not.toContain("ยืนยันอีเมล")
    expect(message).toContain("ที่อยู่เว็บ")
  })

  it("429 บอกให้รอ ไม่ใช่บอกว่ารหัสผ่านผิด", () => {
    const message = authErrorMessage({ status: 429, message: "Too many requests" }, "sign-in")
    expect(message).not.toContain("รหัสผ่าน")
    expect(message).toContain("รอ")
  })

  it("รหัสผ่านผิด", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "sign-in")).toBe("อีเมลหรือรหัสผ่านไม่ถูกต้อง")
  })

  it("error ที่ไม่รู้จักแนบ code/status ไว้ให้ตามสาเหตุได้ · ออกจากระบบใช้ข้อความของตัวเอง", () => {
    expect(authErrorMessage({ code: "SOMETHING_NEW", status: 500 }, "sign-in")).toContain("SOMETHING_NEW")
    expect(authErrorMessage({ status: 502 }, "sign-out")).toBe("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง (HTTP 502)")
    expect(authErrorMessage(null, "sign-out")).toContain("เชื่อมต่อไม่ได้")
  })
})

describe("lib/auth-origins — trustedOrigins ของ Better Auth", () => {
  it("production ไม่เดา origin ให้เอง — ไม่ตั้ง env = ว่าง (เฉพาะ BETTER_AUTH_URL)", () => {
    expect(resolveTrustedOrigins({ NODE_ENV: "production", BETTER_AUTH_URL: "https://posqr.jayjayservices.com" })).toEqual([])
  })

  it("production อ่านรายการจาก env คั่น comma ตัด / ท้าย", () => {
    expect(
      resolveTrustedOrigins({ NODE_ENV: "production", BETTER_AUTH_TRUSTED_ORIGINS: " https://a.example.com/ ,https://b.example.com,," }),
    ).toEqual(["https://a.example.com", "https://b.example.com"])
  })

  it("dev ยอม localhost และ 127.0.0.1 พอร์ตเดียวกับ BETTER_AUTH_URL", () => {
    expect(resolveTrustedOrigins({ NODE_ENV: "development", BETTER_AUTH_URL: "http://localhost:3001" })).toEqual([
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ])
  })
})
