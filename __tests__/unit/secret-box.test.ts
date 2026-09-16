import { afterEach, describe, expect, it } from "vitest"
import { decryptSecret, encryptSecret, isSecretBoxConfigured, maskSecretTail } from "@/lib/secret-box"

/// กล่องเข้ารหัส credential ต่อร้าน (Phase 15c) — ห้ามถอดได้เมื่อกุญแจผิด/ข้อมูลถูกแก้ · iv สุ่มทุกครั้ง
const original = process.env.PAYMENT_CONFIG_KEY

afterEach(() => {
  if (original === undefined) delete process.env.PAYMENT_CONFIG_KEY
  else process.env.PAYMENT_CONFIG_KEY = original
})

describe("secret-box", () => {
  it("เข้ารหัสแล้วถอดกลับได้ตรง · ข้อความเดิมเข้ารหัสสองครั้งได้ผลต่างกัน (iv สุ่ม)", () => {
    expect(isSecretBoxConfigured()).toBe(true)
    const a = encryptSecret("scb-secret-ไทย-1234")
    const b = encryptSecret("scb-secret-ไทย-1234")
    expect(a).not.toBe(b)
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(decryptSecret(a)).toBe("scb-secret-ไทย-1234")
    expect(a).not.toContain("scb-secret")
  })

  it("ข้อมูลถูกแก้ / รูปแบบผิด / กุญแจเปลี่ยน → null ไม่ throw", () => {
    const sealed = encryptSecret("hello")
    const [v, iv, tag, data] = sealed.split(".")
    expect(decryptSecret(`${v}.${iv}.${tag}.${data.slice(0, -2)}AA`)).toBeNull()
    expect(decryptSecret("garbage")).toBeNull()
    expect(decryptSecret("v2.a.b.c")).toBeNull()
    process.env.PAYMENT_CONFIG_KEY = "b3RoZXIta2V5LTMyLWJ5dGVzLWZvci12aXRlc3QtMDAy"
    expect(decryptSecret(sealed)).toBeNull()
  })

  it("ไม่ตั้งกุญแจ / กุญแจยาวผิด → เข้ารหัสไม่ได้ (throw) และถือว่าไม่ configured", () => {
    delete process.env.PAYMENT_CONFIG_KEY
    expect(isSecretBoxConfigured()).toBe(false)
    expect(() => encryptSecret("x")).toThrow("PAYMENT_CONFIG_KEY_MISSING")
    process.env.PAYMENT_CONFIG_KEY = "short"
    expect(isSecretBoxConfigured()).toBe(false)
  })

  it("maskSecretTail โชว์แค่ท้าย", () => {
    expect(maskSecretTail("abcdefghijkl")).toBe("••••••••ijkl")
    expect(maskSecretTail("ab")).toBe("••")
    expect(maskSecretTail(null)).toBeNull()
  })
})
