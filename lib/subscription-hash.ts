import { createHash } from "node:crypto"

/// SHA-256 ของเลขพร้อมเพย์ที่ normalize แล้ว — TrialClaim เก็บแค่ค่านี้ ไม่เก็บเลขดิบ (Phase 14b)
/// แยกจาก lib/subscription.ts เพราะไฟล์นั้นถูก Client Component import และ node:crypto ไม่มีในเบราว์เซอร์
export function hashPromptPayId(normalized: string): string {
  return createHash("sha256").update(`promptpay:${normalized}`).digest("hex")
}
