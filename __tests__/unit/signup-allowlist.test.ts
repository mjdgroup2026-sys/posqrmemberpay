import { describe, expect, it } from "vitest"
import { isSignupAllowed, readSignupPolicy } from "@/lib/signup-allowlist"

/// ส่ง env จำลองเข้าไปตรง ๆ ไม่แตะ process.env จริง — เทสจะได้ไม่รบกวนกันเอง
function env(overrides: Record<string, string | undefined> = {}) {
  return overrides as NodeJS.ProcessEnv
}

describe("allowlist การสมัครสมาชิก (Phase 5)", () => {
  it("ไม่ตั้งค่าอะไรเลย = ปฏิเสธทุกคน (fail closed)", () => {
    const e = env()
    expect(readSignupPolicy(e).unconfigured).toBe(true)
    expect(isSignupAllowed("someone@example.com", e)).toBe(false)
    // แม้แต่อีเมลที่ดูน่าเชื่อถือก็ต้องไม่ผ่าน — พลาดแล้วต้องปลอดภัยไว้ก่อน
    expect(isSignupAllowed("admin@mjdgroup.co.th", e)).toBe(false)
  })

  it("อนุญาตตามรายชื่ออีเมลแบบเป๊ะ ๆ", () => {
    const e = env({ SIGNUP_ALLOWED_EMAILS: "a@example.com, b@example.com" })
    expect(isSignupAllowed("a@example.com", e)).toBe(true)
    expect(isSignupAllowed("b@example.com", e)).toBe(true)
    expect(isSignupAllowed("c@example.com", e)).toBe(false)
  })

  it("อนุญาตตามโดเมน และรับรูปแบบที่มี @ นำหน้าด้วย", () => {
    const e = env({ SIGNUP_ALLOWED_DOMAINS: "example.com, @mjdgroup.co.th" })
    expect(isSignupAllowed("anyone@example.com", e)).toBe(true)
    expect(isSignupAllowed("staff@mjdgroup.co.th", e)).toBe(true)
    expect(isSignupAllowed("staff@other.com", e)).toBe(false)
  })

  it("เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และตัดช่องว่างหัวท้าย", () => {
    const e = env({ SIGNUP_ALLOWED_EMAILS: "Staff@Example.COM" })
    expect(isSignupAllowed("  staff@example.com  ", e)).toBe(true)
    expect(isSignupAllowed("STAFF@EXAMPLE.COM", e)).toBe(true)
  })

  it("โดเมนต้องตรงทั้งตัว — subdomain หรือโดเมนที่ลงท้ายคล้ายกันต้องไม่ผ่าน", () => {
    const e = env({ SIGNUP_ALLOWED_DOMAINS: "example.com" })
    // ★ จุดที่พลาดง่ายที่สุด: ถ้าเขียนเป็น endsWith() ทั้งสามอันนี้จะผ่านหมด
    expect(isSignupAllowed("attacker@evil-example.com", e)).toBe(false)
    expect(isSignupAllowed("attacker@notexample.com", e)).toBe(false)
    expect(isSignupAllowed("attacker@sub.example.com", e)).toBe(false)
  })

  it("อีเมลผิดรูปแบบต้องไม่ผ่าน", () => {
    const e = env({ SIGNUP_ALLOWED_DOMAINS: "example.com" })
    for (const bad of ["", "   ", "example.com", "@example.com", "a@", "a@b@example.com"]) {
      expect(isSignupAllowed(bad, e)).toBe(false)
    }
  })

  it("ตั้งทั้งสองแบบพร้อมกัน — ผ่านทางใดทางหนึ่งก็พอ", () => {
    const e = env({
      SIGNUP_ALLOWED_EMAILS: "contractor@gmail.com",
      SIGNUP_ALLOWED_DOMAINS: "example.com",
    })
    expect(isSignupAllowed("contractor@gmail.com", e)).toBe(true)
    expect(isSignupAllowed("staff@example.com", e)).toBe(true)
    expect(isSignupAllowed("stranger@gmail.com", e)).toBe(false)
  })

  it("ค่าว่างหรือมีแต่คอมมาถือว่ายังไม่ได้ตั้งค่า", () => {
    for (const raw of ["", "  ", ",", " , , "]) {
      const e = env({ SIGNUP_ALLOWED_EMAILS: raw, SIGNUP_ALLOWED_DOMAINS: raw })
      expect(readSignupPolicy(e).unconfigured).toBe(true)
      expect(isSignupAllowed("a@example.com", e)).toBe(false)
    }
  })
})

describe("โหมดเปิดสมัคร SIGNUP_OPEN (Phase 14a)", () => {
  it("SIGNUP_OPEN=true → ใครก็สมัครได้ โดยไม่ต้องมี allowlist", () => {
    const e = env({ SIGNUP_OPEN: "true" })
    expect(readSignupPolicy(e).open).toBe(true)
    expect(readSignupPolicy(e).unconfigured).toBe(false)
    expect(isSignupAllowed("anyone@anywhere.io", e)).toBe(true)
  })

  it("รับค่าแบบไม่สนตัวพิมพ์/ช่องว่าง แต่ค่าอื่นที่ไม่ใช่ true = ไม่เปิด", () => {
    expect(readSignupPolicy(env({ SIGNUP_OPEN: " TRUE " })).open).toBe(true)
    expect(readSignupPolicy(env({ SIGNUP_OPEN: "1" })).open).toBe(false)
    expect(readSignupPolicy(env({ SIGNUP_OPEN: "yes" })).open).toBe(false)
    expect(isSignupAllowed("anyone@anywhere.io", env({ SIGNUP_OPEN: "false" }))).toBe(false)
  })

  it("เปิดสมัครแล้วก็ยังต้องเป็นรูปแบบอีเมลที่มี @ คั่นพอดีหนึ่งตัว", () => {
    const e = env({ SIGNUP_OPEN: "true" })
    expect(isSignupAllowed("not-an-email", e)).toBe(false)
    expect(isSignupAllowed("a@b@c", e)).toBe(false)
    expect(isSignupAllowed("@example.com", e)).toBe(false)
  })

  it("SIGNUP_OPEN ไม่ใช่ true → กลับไปใช้ allowlist เดิมตามปกติ", () => {
    const e = env({ SIGNUP_OPEN: "false", SIGNUP_ALLOWED_DOMAINS: "example.com" })
    expect(isSignupAllowed("x@example.com", e)).toBe(true)
    expect(isSignupAllowed("x@other.com", e)).toBe(false)
  })
})
