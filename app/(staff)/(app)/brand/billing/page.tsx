import QRCode from "qrcode"
import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { getBrandOverview } from "@/lib/brand-queries"
import { listActivePlans } from "@/lib/plan-queries"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { BrandBillingForm } from "@/components/brand-billing-form"
import { IconBack, IconCard } from "@/components/icons"

export const metadata = { title: "จ่ายค่าใช้งานรวม" }

/// ใบจ่ายค่าใช้งานรวมหลายสาขาของแบรนด์ (Phase 14c) — เฉพาะเจ้าของแบรนด์ (getBrandOverview กรอง brand.ownerId)
/// QR พร้อมเพย์ของแพลตฟอร์ม render ฝั่ง server ด้วยยอดรวมของใบ — วิธีเดียวกับ /billing
export default async function BrandBillingPage() {
  const session = await getSession()
  if (!session?.user) redirect("/login?callbackUrl=%2Fbrand%2Fbilling")

  const [overview, plans] = await Promise.all([getBrandOverview(session.user.id), listActivePlans()])
  if (!overview.brand) redirect("/brand")

  let pendingQr: string | null = null
  const platformPromptPay = process.env.PLATFORM_PROMPTPAY_ID?.trim() || null
  if (overview.pendingBatch && platformPromptPay) {
    const payload = buildPromptPayPayload(overview.pendingBatch.amount, platformPromptPay)
    if (payload) pendingQr = await QRCode.toDataURL(payload, { margin: 1, width: 240 })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href="/brand" className="row" style={{ gap: 4, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden /> {overview.brand.name}
            </Link>
          </p>
          <h1 className="t-h1">
            <IconCard size={22} aria-hidden /> จ่ายค่าใช้งานรวม
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            เลือกแพ็กเกจให้หลายสาขาในครั้งเดียว → โอนใบเดียว → ผู้ดูแลยืนยันครั้งเดียวมีผลทุกสาขาพร้อมกัน
          </p>
        </div>
      </div>

      {overview.stores.length === 0 ? (
        <div className="alert-banner info">
          ยังไม่มีสาขาใต้แบรนด์ — <Link href="/brand">ดึงร้านเข้าแบรนด์</Link> ก่อนจึงจะจ่ายรวมได้
        </div>
      ) : (
        <BrandBillingForm
          stores={overview.stores}
          plans={plans}
          pendingBatch={overview.pendingBatch}
          batches={overview.batches}
          pendingQr={pendingQr}
          platformPromptPay={platformPromptPay}
          now={new Date()}
        />
      )}
    </>
  )
}
