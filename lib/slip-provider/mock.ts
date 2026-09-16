import "server-only"
import { parseMockPayload, parseSlipQr } from "@/lib/slip-qr"
import type { SlipVerification } from "@/lib/slip-provider"

/// ผู้ให้บริการจำลอง (Phase 15b) — dev/เทส · ไม่ยิงเครือข่าย ไม่เสียโควตา
/// รับเฉพาะ payload รูปแบบ `MOCK|<transRef>|<amount>|<receiverId>|<minutesAgo>` แล้วตอบตามที่บอก
/// · transRef ขึ้นต้น "DOWN" = จำลองผู้ให้บริการล่ม · ขึ้นต้น "DUP" = จำลองเจ้าที่มี dedupe ในตัวตอบว่าซ้ำ
/// · payload ของสลิปจริง (EMV) → ตอบ INVALID พร้อมบอกว่า mock ตรวจของจริงไม่ได้ (กันเผลอเปิด mock บน production)
export function verifyWithMock(payload: string): SlipVerification {
  const mock = parseMockPayload(payload)
  if (!mock) {
    const real = parseSlipQr(payload)
    return {
      ok: false,
      code: "INVALID",
      error: real
        ? "ระบบตรวจสลิปอยู่ในโหมดจำลอง — ตรวจสลิปจริงไม่ได้ กรุณาแจ้งพนักงาน"
        : "อ่าน QR บนสลิปไม่ได้ กรุณาถ่ายสลิปให้ชัดหรือแจ้งพนักงาน",
    }
  }
  if (mock.transRef.startsWith("DOWN")) return { ok: false, code: "PROVIDER_DOWN", error: "ติดต่อระบบตรวจสลิปไม่ได้ในขณะนี้" }
  if (mock.transRef.startsWith("DUP")) return { ok: false, code: "DUPLICATE", error: "สลิปนี้ถูกใช้ไปแล้ว" }

  return {
    ok: true,
    data: {
      transRef: mock.transRef,
      amount: mock.amount,
      transferredAt: new Date(Date.now() - mock.minutesAgo * 60_000),
      receiver: { proxy: mock.receiverId, account: mock.receiverId, name: null, bank: null },
      sender: { name: "ผู้โอนจำลอง", bank: null },
      provider: "mock",
    },
  }
}
