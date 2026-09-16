import "server-only"
import type { SlipVerification } from "@/lib/slip-provider"

/// EasySlip Developer API v1 (Phase 15b) — https://developer.easyslip.com
/// POST /api/v1/verify · Authorization: Bearer <key> · body { payload }
/// เขียนตามเอกสารสาธารณะ **ยังไม่ได้ทดสอบกับ key จริง** — เปิดใช้ครั้งแรกต้องลองด้วยสลิปจริง 1 บาทก่อน
///
/// รูปแบบตอบ (200): { status: 200, data: { transRef, date (ISO), amount: { amount }, sender: { bank: { short }, account:
/// { name: { th }, bank: { account }, proxy: { account } } }, receiver: {…เหมือน sender…} } }
/// รหัสผิดพลาด: 400 invalid_payload · 404 slip_not_found · 409 duplicate_slip · 401/403 key · 429 quota_exceeded

const ENDPOINT = "https://developer.easyslip.com/api/v1/verify"

type EasySlipParty = {
  bank?: { short?: string; name?: string }
  account?: { name?: { th?: string; en?: string }; bank?: { account?: string }; proxy?: { account?: string } }
}
type EasySlipResponse = {
  status?: number
  message?: string
  data?: { transRef?: string; date?: string; amount?: { amount?: number }; sender?: EasySlipParty; receiver?: EasySlipParty }
}

export async function verifyWithEasySlip(payload: string, apiKey: string): Promise<SlipVerification> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ payload }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await response.json().catch(() => ({}))) as EasySlipResponse

  if (response.status === 200 && body.data?.transRef) {
    const d = body.data
    const at = d.date ? new Date(d.date) : new Date(NaN)
    return {
      ok: true,
      data: {
        transRef: d.transRef as string,
        amount: Number(d.amount?.amount ?? 0),
        transferredAt: Number.isNaN(at.getTime()) ? new Date() : at,
        receiver: {
          proxy: d.receiver?.account?.proxy?.account ?? null,
          account: d.receiver?.account?.bank?.account ?? null,
          name: d.receiver?.account?.name?.th ?? d.receiver?.account?.name?.en ?? null,
          bank: d.receiver?.bank?.short ?? d.receiver?.bank?.name ?? null,
        },
        sender: { name: d.sender?.account?.name?.th ?? null, bank: d.sender?.bank?.short ?? null },
        provider: "easyslip",
      },
    }
  }
  if (response.status === 409) return { ok: false, code: "DUPLICATE", error: "สลิปนี้ถูกใช้ไปแล้ว" }
  if (response.status === 400 || response.status === 404) {
    return { ok: false, code: "INVALID", error: "ไม่พบรายการโอนตามสลิปนี้ กรุณาตรวจสอบสลิปหรือแจ้งพนักงาน" }
  }
  console.error("[slip:easyslip] ตอบผิดปกติ", { status: response.status, message: body.message })
  return { ok: false, code: "PROVIDER_DOWN", error: "ติดต่อระบบตรวจสลิปไม่ได้ในขณะนี้" }
}
