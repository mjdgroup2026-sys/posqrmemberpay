import QRCode from "qrcode"
import { redirect } from "next/navigation"
import { resolveStoreContext } from "@/lib/session"
import { redirectForMissingStore } from "@/lib/permissions"
import { getBillingOverview, listSubscriptionHistory } from "@/lib/queries"
import { listActivePlans, listStoresWithTrialClaim } from "@/lib/plan-queries"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { BillingPanel } from "@/components/billing-panel"

export const metadata = { title: "ค่าใช้งาน" }

/// ค่าใช้งานแบบต่ออายุของร้าน (Phase 14b) — เฉพาะเจ้าของร้าน
/// QR พร้อมเพย์ของแพลตฟอร์ม (env PLATFORM_PROMPTPAY_ID) render ฝั่ง server ตอนมีคำขอค้าง — ยอดตายตัวตามคำขอ
export default async function BillingPage() {
  const result = await resolveStoreContext()
  if (!result.ok) redirectForMissingStore(result.reason)
  const ctx = result.context
  if (ctx.role !== "OWNER") redirect("/access-denied?resource=BILLING")

  // ร้านอื่นของเจ้าของคนนี้ที่รับทดลองไปแล้ว — บอกให้ชัดว่าใช้เลขพร้อมเพย์เดิมรับซ้ำไม่ได้ ก่อนกดแล้วเจอ error (2026-09-17)
  const otherOwnedIds = ctx.memberships.filter((m) => m.role === "OWNER" && m.storeId !== ctx.storeId).map((m) => m.storeId)
  const [overview, history, plans, trialUsedIds] = await Promise.all([
    getBillingOverview(ctx.storeId),
    listSubscriptionHistory(ctx.storeId),
    listActivePlans(),
    listStoresWithTrialClaim(otherOwnedIds),
  ])
  const trialUsedAt = ctx.memberships.filter((m) => trialUsedIds.includes(m.storeId)).map((m) => m.name)

  let pendingQr: string | null = null
  const platformPromptPay = process.env.PLATFORM_PROMPTPAY_ID?.trim() || null
  if (overview.pending && platformPromptPay) {
    const payload = buildPromptPayPayload(overview.pending.amount, platformPromptPay)
    if (payload) pendingQr = await QRCode.toDataURL(payload, { margin: 1, width: 240 })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ร้าน {ctx.store.name}</p>
          <h1 className="t-h1">ค่าใช้งาน</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            คิดเป็นวันตามจำนวนโต๊ะ (tier) — ต่ออายุล่วงหน้าได้ วันที่เหลือไม่หาย · ยิ่งซื้อนานยิ่งลด
          </p>
        </div>
      </div>

      <BillingPanel
        overview={overview}
        history={history}
        plans={plans}
        pendingQr={pendingQr}
        platformPromptPay={platformPromptPay}
        now={new Date()}
        trialUsedAt={trialUsedAt}
      />
    </>
  )
}
