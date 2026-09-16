import "server-only"
import type { SlipVerification } from "@/lib/slip-provider"

/// SlipOK API (Phase 15b) — https://slipok.com/api
/// POST https://api.slipok.com/api/line/apikey/<branchId> · header x-authorization: <key> · body { data: payload, log: true }
/// เขียนตามเอกสารสาธารณะ **ยังไม่ได้ทดสอบกับ key จริง** — เปิดใช้ครั้งแรกต้องลองด้วยสลิปจริง 1 บาทก่อน
///
/// รูปแบบตอบ: { success: true, data: { transRef, transDate "YYYYMMDD", transTime "HH:mm:ss", amount, sendingBank, receivingBank,
/// sender: { displayName, name, account: { value } }, receiver: { displayName, name, proxy: { value }, account: { value } } } }
/// ผิดพลาด: { success: false, code, message } — 1002 payload ไม่ถูกต้อง · 1012 สลิปซ้ำ · 1013/1014 โควตา/สิทธิ์

type SlipOkParty = { displayName?: string; name?: string; proxy?: { value?: string }; account?: { value?: string } }
type SlipOkResponse = {
  success?: boolean
  code?: number
  message?: string
  data?: {
    transRef?: string
    transDate?: string
    transTime?: string
    amount?: number
    sendingBank?: string
    receivingBank?: string
    sender?: SlipOkParty
    receiver?: SlipOkParty
  }
}

function parseSlipOkDate(date?: string, time?: string): Date {
  if (!date || !/^\d{8}$/.test(date)) return new Date()
  const clock = time && /^\d{2}:\d{2}:\d{2}$/.test(time) ? time : "00:00:00"
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${clock}+07:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

export async function verifyWithSlipOk(payload: string, apiKey: string, branchId: string): Promise<SlipVerification> {
  if (!branchId) return { ok: false, code: "NOT_CONFIGURED", error: "ยังไม่ได้ตั้ง SLIP_API_BRANCH_ID ของ SlipOK" }
  const response = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(branchId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-authorization": apiKey },
    body: JSON.stringify({ data: payload, log: true }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await response.json().catch(() => ({}))) as SlipOkResponse

  if (response.ok && body.success && body.data?.transRef) {
    const d = body.data
    return {
      ok: true,
      data: {
        transRef: d.transRef as string,
        amount: Number(d.amount ?? 0),
        transferredAt: parseSlipOkDate(d.transDate, d.transTime),
        receiver: {
          proxy: d.receiver?.proxy?.value ?? null,
          account: d.receiver?.account?.value ?? null,
          name: d.receiver?.displayName ?? d.receiver?.name ?? null,
          bank: d.receivingBank ?? null,
        },
        sender: { name: d.sender?.displayName ?? d.sender?.name ?? null, bank: d.sendingBank ?? null },
        provider: "slipok",
      },
    }
  }
  if (body.code === 1012) return { ok: false, code: "DUPLICATE", error: "สลิปนี้ถูกใช้ไปแล้ว" }
  if (body.code === 1002 || response.status === 400 || response.status === 404) {
    return { ok: false, code: "INVALID", error: "ไม่พบรายการโอนตามสลิปนี้ กรุณาตรวจสอบสลิปหรือแจ้งพนักงาน" }
  }
  console.error("[slip:slipok] ตอบผิดปกติ", { status: response.status, code: body.code, message: body.message })
  return { ok: false, code: "PROVIDER_DOWN", error: "ติดต่อระบบตรวจสลิปไม่ได้ในขณะนี้" }
}
