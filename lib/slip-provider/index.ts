import "server-only"
import { verifyWithMock } from "@/lib/slip-provider/mock"
import { verifyWithEasySlip } from "@/lib/slip-provider/easyslip"
import { verifyWithSlipOk } from "@/lib/slip-provider/slipok"

/// ตัวตรวจสลิปโอนเงิน (Phase 15b — โหมด ก+) · interface กลาง สลับผู้ให้บริการด้วย env ไม่ต้องแก้ตรรกะปิดบิล
///
/// env:
///   SLIP_PROVIDER         mock | easyslip | slipok — ไม่ตั้ง = ปิดโหมดตรวจสลิป (ร้านเลือก PROMPTPAY_SLIP ไม่ได้)
///   SLIP_API_KEY          key ของผู้ให้บริการ (mock ไม่ต้องใช้)
///   SLIP_API_BRANCH_ID    เฉพาะ SlipOK (branch id ใน URL)
///   SLIP_MAX_AGE_MINUTES  สลิปเก่ากว่านี้ไม่รับ (ค่าเริ่มต้น 30)
///
/// ทุกผู้ให้บริการทำงานเหมือนกัน: รับ payload ของ mini-QR บนสลิป → ถามระบบกลางของธนาคาร → คืนว่ารายการมีจริงไหม
/// ใครโอน เข้าบัญชีไหน กี่บาท เมื่อไหร่ · เลขบัญชีที่คืนมามัก**ปิดบางหลัก** — เทียบด้วย maskedAccountMatches() ใน lib/slip-qr.ts
/// · "mock" ใช้พัฒนา/เทสโดยไม่เสียโควตา: รับ payload รูปแบบ MOCK|… (ดู parseMockPayload) แล้วตอบตามนั้น
/// · ผู้ให้บริการไม่เก็บสลิปให้ — การกันสลิปซ้ำเป็นหน้าที่เรา (Sale.paymentReference unique) แม้บางเจ้าจะมี dedupe ในตัว

export type SlipProviderName = "mock" | "easyslip" | "slipok"

export type VerifiedSlip = {
  transRef: string
  amount: number
  transferredAt: Date
  /// ผู้รับ — ค่าที่คืนมาอาจปิดบางหลัก · proxy = พร้อมเพย์ (เบอร์/บัตร/e-wallet) · account = เลขบัญชีธนาคาร
  receiver: { proxy: string | null; account: string | null; name: string | null; bank: string | null }
  sender: { name: string | null; bank: string | null }
  provider: SlipProviderName
}

export type SlipFailureCode =
  /// payload ไม่ใช่สลิป / รายการไม่มีจริง / ปลอม
  | "INVALID"
  /// ผู้ให้บริการบอกว่าสลิปนี้เคยถูกตรวจแล้ว (เจ้าที่มี dedupe ในตัว)
  | "DUPLICATE"
  /// ติดต่อผู้ให้บริการไม่ได้ / โควตาหมด / key ผิด → ถอยไปให้พนักงานปิดมือ
  | "PROVIDER_DOWN"
  | "NOT_CONFIGURED"

export type SlipVerification = { ok: true; data: VerifiedSlip } | { ok: false; code: SlipFailureCode; error: string }

export function slipProviderName(): SlipProviderName | null {
  const name = process.env.SLIP_PROVIDER?.trim().toLowerCase()
  if (name === "mock" || name === "easyslip" || name === "slipok") return name
  return null
}

/// ร้านเปิดโหมด PROMPTPAY_SLIP ได้ไหม — ต้องมีผู้ให้บริการ (และ key ถ้าไม่ใช่ mock)
export function isSlipVerificationConfigured(): boolean {
  const name = slipProviderName()
  if (!name) return false
  if (name === "mock") return true
  return Boolean(process.env.SLIP_API_KEY?.trim())
}

export function slipMaxAgeMinutes(): number {
  const value = Number(process.env.SLIP_MAX_AGE_MINUTES)
  return Number.isFinite(value) && value > 0 ? value : 30
}

export async function verifySlip(payload: string): Promise<SlipVerification> {
  const name = slipProviderName()
  if (!name || !isSlipVerificationConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", error: "ร้านยังไม่ได้เปิดใช้การตรวจสลิปอัตโนมัติ" }
  }
  try {
    switch (name) {
      case "mock":
        return verifyWithMock(payload)
      case "easyslip":
        return await verifyWithEasySlip(payload, process.env.SLIP_API_KEY as string)
      case "slipok":
        return await verifyWithSlipOk(payload, process.env.SLIP_API_KEY as string, process.env.SLIP_API_BRANCH_ID?.trim() ?? "")
    }
  } catch (error) {
    // เครือข่ายล่ม/timeout — ไม่ใช่ความผิดของสลิป ให้ตกไปปิดมือ
    console.error(`[slip:${name}] เรียกผู้ให้บริการไม่สำเร็จ:`, error)
    return { ok: false, code: "PROVIDER_DOWN", error: "ติดต่อระบบตรวจสลิปไม่ได้ในขณะนี้" }
  }
}
