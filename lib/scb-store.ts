import "server-only"
import { forStore } from "@/lib/db"
import { scbCredentialsFromEnv, type ScbCredentials } from "@/lib/payment-provider/scb"
import { decryptSecret } from "@/lib/secret-box"

/// credential SCB "ของร้านนี้" (Phase 15c) — จุดเดียวที่ตัดสินว่าจะเรียกธนาคารในนามใคร
///
/// ลำดับ: ① ร้านผูกเอง (StorePaymentConfig.scb* ถอดรหัสได้ครบ) — ใช้ได้ต่อเมื่อ **ผ่านการทดสอบแล้ว** (scbVerifiedAt)
/// เว้นแต่ผู้เรียกขอ \`allowUnverified\` (ปุ่มทดสอบการเชื่อมต่อเท่านั้น) · ② ไม่มี → env ของแพลตฟอร์ม (ร้าน default ที่ยังไม่ย้าย)
/// · ถอดรหัสไม่ได้ (กุญแจเปลี่ยน/ข้อมูลเสีย) = ถือว่าไม่มี ห้ามเดา ห้ามยิงธนาคารด้วยค่าครึ่ง ๆ กลาง ๆ

export type StoreScbSource = "store" | "env"

export type StoreScb = {
  creds: ScbCredentials
  source: StoreScbSource
  /// ผ่านการทดสอบ callback 1 บาทเมื่อไหร่ (env = ถือว่าผ่านมาแล้วตั้งแต่ Phase 10)
  verifiedAt: Date | null
}

type ScbColumns = {
  scbApiBase: string | null
  scbApiKeyEnc: string | null
  scbApiSecretEnc: string | null
  scbBillerId: string | null
  scbRef3Prefix: string | null
  scbVerifiedAt: Date | null
}

/// ถอด credential จากแถว config — คืน null ถ้าไม่ครบหรือถอดไม่ได้
export function decodeStoreScb(row: ScbColumns | null): { creds: ScbCredentials; verifiedAt: Date | null } | null {
  if (!row?.scbApiBase || !row.scbApiKeyEnc || !row.scbApiSecretEnc || !row.scbBillerId || !row.scbRef3Prefix) return null
  const key = decryptSecret(row.scbApiKeyEnc)
  const secret = decryptSecret(row.scbApiSecretEnc)
  if (!key || !secret) return null
  return {
    creds: { base: row.scbApiBase.replace(/\/+$/, ""), key, secret, billerId: row.scbBillerId, ref3Prefix: row.scbRef3Prefix },
    verifiedAt: row.scbVerifiedAt,
  }
}

export async function getStoreScb(storeId: string, options: { allowUnverified?: boolean } = {}): Promise<StoreScb | null> {
  const row = await forStore(storeId).storePaymentConfig.findUnique({
    where: { storeId },
    select: { scbApiBase: true, scbApiKeyEnc: true, scbApiSecretEnc: true, scbBillerId: true, scbRef3Prefix: true, scbVerifiedAt: true },
  })
  const own = decodeStoreScb(row)
  if (own && (own.verifiedAt || options.allowUnverified)) return { creds: own.creds, source: "store", verifiedAt: own.verifiedAt }

  const env = scbCredentialsFromEnv()
  if (env) return { creds: env, source: "env", verifiedAt: null }
  return null
}

/// "ร้านนี้ปิดบิลอัตโนมัติผ่าน SCB ได้ไหม" — ใช้ใน lib/payment-methods.ts
export async function isStoreScbReady(storeId: string): Promise<boolean> {
  return (await getStoreScb(storeId)) !== null
}
