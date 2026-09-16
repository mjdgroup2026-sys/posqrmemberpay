import { existsSync } from "node:fs"
import { config as loadEnv } from "dotenv"
import { afterEach } from "vitest"

/// โหลด .env.test ทับเสมอ — กัน integration test ยิงลงฐาน dev โดยไม่ตั้งใจ
if (existsSync(".env.test")) {
  loadEnv({ path: ".env.test", override: true, quiet: true })
}

/// matcher ของ jest-dom ใช้ได้เฉพาะไฟล์ที่ประกาศ environment jsdom
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest")
  const { cleanup } = await import("@testing-library/react")
  afterEach(() => {
    cleanup()
  })
}

/// ค่าเริ่มต้นของ env ที่เทสต้องมีแต่ไม่ควรอยู่ใน .env.test/CI (Phase 15c) — ตั้งเฉพาะเมื่อยังไม่มี
/// · PAYMENT_CONFIG_KEY: กุญแจเข้ารหัส credential ต่อร้าน — ค่าคงที่สำหรับเทสเท่านั้น
/// · SCB_*: credential "ของแพลตฟอร์ม" (sandbox) — การยิงธนาคารถูก mock ในทุกเทส ค่าจึงแค่ต้อง "ครบ" ให้ getStoreScb() มี fallback
///   เหมือน production ร้าน default · เทสที่อยากจำลอง "ไม่มี env" ลบเองใน beforeEach (payment-config.test.ts)
process.env.PAYMENT_CONFIG_KEY ??= "dGVzdC1rZXktMzItYnl0ZXMtZm9yLXZpdGVzdC0wMDE"
process.env.SCB_API_BASE ??= "https://api-sandbox.partners.scb/partners/sandbox"
process.env.SCB_API_KEY ??= "test-platform-key"
process.env.SCB_API_SECRET ??= "test-platform-secret"
process.env.SCB_BILLER_ID ??= "048233443520805"
process.env.SCB_REF3_PREFIX ??= "TST"
