import "server-only"
import type { PaymentMode } from "@/generated/prisma/client"
import { forStore } from "@/lib/db"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { isStoreScbReady } from "@/lib/scb-store"
import { isSlipVerificationConfigured } from "@/lib/slip-provider"

/// "ร้านนี้รับชำระด้วย QR ได้ไหม และด้วยวิธีไหน" — กติกาเดียวที่ทุกหน้าต้องใช้ร่วมกัน (Phase 15a: ต่อร้าน)
///
/// ก่อน Phase 15 เช็คจาก env ระดับแพลตฟอร์ม (PROMPTPAY_ID / SCB_*) ทำให้**ทุกร้าน**ในระบบออก QR ของร้าน default
/// ลูกค้าของร้านอื่นจึงจ่ายเข้าบัญชีร้าน default — ตอนนี้อ่านจาก Store.paymentMode + StorePaymentConfig ของร้านนั้นแทน:
///   PROMPTPAY_DIRECT  → QR พร้อมเพย์ของร้านที่สร้างเอง (lib/promptpay.ts) · พนักงานกดยืนยัน
///   PROMPTPAY_SLIP    → เหมือน DIRECT + ลูกค้าแนบสลิปให้ระบบตรวจแล้วปิดบิลเอง (15b — ต้องตั้ง SLIP_PROVIDER ไม่งั้นทำงานเหมือน DIRECT)
///   SCB_BILLER        → ธนาคารออก QR พก ref1 → callback ปิดบิลเอง · credential ของร้านเอง (15c — ต้องผ่านการทดสอบ)
///                       หรือ env ของแพลตฟอร์มเป็น fallback (ร้าน default)
///
/// ⚠️ เคยพลาดมาแล้ว: ตอนต่อ SCB แก้แค่หน้า pay/promptpay แต่ลืมหน้า pay ที่เป็นตัวเลือกวิธีชำระเงิน
/// ผลคือปุ่ม "ชำระด้วยพร้อมเพย์" ถูกปิดทั้งที่ระบบพร้อม · ห้ามเช็ค promptPayId/isScbConfigured() ตรง ๆ ในหน้าใด
/// ให้เรียก getStorePaymentProfile() แล้วดู qrAvailable

export type StorePaymentProfile = {
  mode: PaymentMode
  /// เลขพร้อมเพย์ของร้าน (normalize แล้ว) — null = ยังไม่กรอก
  promptPayId: string | null
  /// ลูกค้ากด "ชำระด้วยพร้อมเพย์" ได้ไหม
  qrAvailable: boolean
  /// ระบบปิดบิลเองได้ไหม (มี callback จากธนาคาร) — false = พนักงานต้องกดยืนยัน
  autoSettle: boolean
  /// ลูกค้าแนบสลิปให้ระบบตรวจแล้วปิดบิลได้ไหม (Phase 15b) — โหมด PROMPTPAY_SLIP + ตั้งผู้ให้บริการแล้ว
  slipVerification: boolean
}

/// ตรรกะล้วน แยกไว้ให้ unit test — `scbConfigured` = ร้านนี้มี credential SCB ที่ใช้ได้ (isStoreScbReady: ของร้านที่ผ่านการทดสอบ หรือ env)
export function resolvePaymentProfile(
  mode: PaymentMode,
  promptPayId: string | null,
  scbConfigured: boolean,
  slipConfigured = false,
): StorePaymentProfile {
  const promptPayReady = Boolean(promptPayId && buildPromptPayPayload(1, promptPayId))
  if (mode === "SCB_BILLER") {
    // ธนาคารล่ม/ยังไม่ตั้ง env → ถอยไปใช้ QR ของร้านเองได้ถ้ามีเลขพร้อมเพย์ (พนักงานกดยืนยันแทน)
    return { mode, promptPayId, qrAvailable: scbConfigured || promptPayReady, autoSettle: scbConfigured, slipVerification: false }
  }
  return {
    mode,
    promptPayId,
    qrAvailable: promptPayReady,
    autoSettle: false,
    slipVerification: mode === "PROMPTPAY_SLIP" && promptPayReady && slipConfigured,
  }
}

export async function getStorePaymentProfile(storeId: string): Promise<StorePaymentProfile> {
  const db = forStore(storeId)
  const [store, config] = await Promise.all([
    db.store.findUnique({ where: { id: storeId }, select: { paymentMode: true } }),
    db.storePaymentConfig.findUnique({ where: { storeId }, select: { promptPayId: true } }),
  ])
  const mode = store?.paymentMode ?? "PROMPTPAY_DIRECT"
  // ถาม credential SCB เฉพาะร้านโหมด SCB — ร้านอื่นไม่ต้องถอดรหัสอะไรเลย
  const scbReady = mode === "SCB_BILLER" ? await isStoreScbReady(storeId) : false
  return resolvePaymentProfile(mode, config?.promptPayId ?? null, scbReady, isSlipVerificationConfigured())
}
