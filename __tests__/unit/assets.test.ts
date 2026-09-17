import { describe, expect, it } from "vitest"
import {
  MAX_ASSET_BYTES,
  assetUrl,
  checkImageBytes,
  parseAssetId,
  sniffImageType,
} from "@/lib/assets"

/// ด่านตรวจไฟล์รูป (Phase 17a) — ชนิดไฟล์ต้องอ่านจากไบต์จริง ไม่ใช่จาก content-type ที่ client ส่งมา
/// มิฉะนั้นใครก็อัปโหลด HTML/SVG ที่มีสคริปต์ แล้วให้ระบบเสิร์ฟจากโดเมนเดียวกับแอปได้

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00)
const WEBP = new Uint8Array([
  ...[0x52, 0x49, 0x46, 0x46], // RIFF
  ...[0x00, 0x00, 0x00, 0x00],
  ...[0x57, 0x45, 0x42, 0x50], // WEBP
])

describe("sniffImageType", () => {
  it("อ่าน JPEG / PNG / WebP จาก magic bytes ได้", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg")
    expect(sniffImageType(PNG)).toBe("image/png")
    expect(sniffImageType(WEBP)).toBe("image/webp")
  })

  it("ปฏิเสธ SVG และไฟล์ที่ไม่ใช่รูป", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(sniffImageType(svg)).toBeNull()
    expect(sniffImageType(new TextEncoder().encode("<!doctype html>"))).toBeNull()
    expect(sniffImageType(bytes(0x00, 0x01))).toBeNull()
  })

  it("RIFF ที่ไม่ใช่ WEBP (เช่นไฟล์เสียง wav) ไม่ผ่าน", () => {
    const wav = new Uint8Array([
      ...[0x52, 0x49, 0x46, 0x46],
      ...[0x00, 0x00, 0x00, 0x00],
      ...[0x57, 0x41, 0x56, 0x45], // WAVE
    ])
    expect(sniffImageType(wav)).toBeNull()
  })
})

describe("checkImageBytes", () => {
  it("รูปปกติผ่านและคืนชนิดที่ตรวจได้จริง", () => {
    const result = checkImageBytes(PNG)
    expect(result).toEqual({ ok: true, contentType: "image/png" })
  })

  it("ไฟล์ว่างไม่ผ่าน", () => {
    const result = checkImageBytes(new Uint8Array())
    expect(result.ok).toBe(false)
  })

  it("ไฟล์ใหญ่เกินเพดานไม่ผ่าน แม้ไบต์ขึ้นต้นจะเป็น JPEG จริง", () => {
    const big = new Uint8Array(MAX_ASSET_BYTES + 1)
    big.set(JPEG, 0)
    const result = checkImageBytes(big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ใหญ่เกินไป")
  })
})

describe("assetUrl / parseAssetId", () => {
  it("ไป-กลับได้ค่าเดิม", () => {
    expect(parseAssetId(assetUrl("abc123"))).toBe("abc123")
  })

  it("ลิงก์ภายนอกหรือค่าว่าง = ไม่ใช่รูปในระบบ (ห้ามไปลบของคนอื่น)", () => {
    expect(parseAssetId("https://example.com/a.jpg")).toBeNull()
    expect(parseAssetId("/menu/pad-thai.jpg")).toBeNull()
    expect(parseAssetId(null)).toBeNull()
    expect(parseAssetId("")).toBeNull()
    expect(parseAssetId("/api/assets/../../etc/passwd")).toBeNull()
  })
})
