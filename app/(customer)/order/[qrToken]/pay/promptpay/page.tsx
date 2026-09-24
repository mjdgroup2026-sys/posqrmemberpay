import { redirect } from "next/navigation"
import QRCode from "qrcode"
import { getCustomerPaymentStatus, getStoreSettings } from "@/lib/queries"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { issuePaymentIntent } from "@/lib/payment-intent"
import { createQrCode } from "@/lib/payment-provider/scb"
import { getStoreScb } from "@/lib/scb-store"
import { getStorePaymentProfile } from "@/lib/payment-methods"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { PromptPayView } from "@/components/customer/promptpay-view"
import { SlipUpload } from "@/components/customer/slip-upload"
import { slipProviderName } from "@/lib/slip-provider"

export const metadata = { title: "ชำระด้วยพร้อมเพย์" }

export default async function PromptPayPage({ params }: PageProps<"/order/[qrToken]/pay/promptpay">) {
  const { qrToken } = await params
  const [status, store] = await Promise.all([getCustomerPaymentStatus(qrToken), findStoreByQrToken(qrToken)])
  const settings = store ? await getStoreSettings(store.storeId) : null

  if (status.state === "PAID") redirect(`/order/${qrToken}/pay/success`)
  // ห้องหลายบิล (20e) — ห้ามออก QR ให้บิลที่เดาเอา หน้า /pay บอกให้ไปจ่ายที่พนักงาน
  if (status.state === "UNKNOWN" || status.total <= 0 || status.sharedRoom) redirect(`/order/${qrToken}/pay`)

  // payload สร้างสดทุกครั้งที่เข้าหน้า — ยอดจึงตรงกับบิลปัจจุบันเสมอแม้ลูกค้าสั่งเพิ่มระหว่างทาง
  //
  // วิธีรับเงินเป็นของร้าน (Phase 15a): โหมด SCB_BILLER = ให้ SCB ออก QR ให้ เพราะใบนั้นพก ref1 ติดไปกับรายการ
  // ธนาคารจึงบอกกลับมาได้ว่าเงินก้อนนี้เป็นของโต๊ะไหน แล้วปิดบิลอัตโนมัติได้ · โหมดพร้อมเพย์ตรง (หรือธนาคารล่ม)
  // ใช้ QR พร้อมเพย์ของร้านที่สร้างเองซึ่งจ่ายได้เหมือนกัน เพียงแต่ต้องให้พนักงานกดยืนยันเอง — ซึ่ง
  // startCustomerPayment() แจ้งพนักงานไว้ให้แล้วตั้งแต่ลูกค้ากดเลือกวิธีชำระเงิน
  const payment = await getStorePaymentProfile(status.storeId)
  let payload: string | null = null

  const scb = payment.autoSettle ? await getStoreScb(status.storeId) : null
  if (scb) {
    const intent = await issuePaymentIntent(status.storeId, status.sessionId, status.total)
    const issued = await createQrCode(scb.creds, { amount: status.total, ref1: intent.ref1 })
    if (issued.ok) {
      payload = issued.data
    } else {
      console.error("[scb] ออก QR ผ่านธนาคารไม่สำเร็จ ถอยไปใช้พร้อมเพย์ที่สร้างเอง:", issued.error)
    }
  }

  payload ??= buildPromptPayPayload(status.total, payment.promptPayId)

  if (!payload) {
    return (
      <CustomerNotice
        title="ยังใช้พร้อมเพย์ไม่ได้"
        description="ร้านยังไม่ได้ตั้งค่าบัญชีพร้อมเพย์ กรุณาชำระเงินกับพนักงานที่เคาน์เตอร์"
      />
    )
  }

  const imageDataUrl = await QRCode.toDataURL(payload, {
    width: 512,
    margin: 1,
    errorCorrectionLevel: "M",
  })

  return (
    <CustomerShell
      storeName={settings?.storeName ?? "MJD Mobile Order"}
      tableCode={status.tableCode}
      backHref={`/order/${qrToken}/pay`}
      title="ชำระด้วยพร้อมเพย์"
    >
      <PromptPayView qrToken={qrToken} total={status.total} imageDataUrl={imageDataUrl} autoSettle={payment.autoSettle} />
      {/* โหมด ก+ (Phase 15b) — ลูกค้าแนบสลิปให้ระบบตรวจแล้วปิดบิลเอง ไม่ต้องรอพนักงาน */}
      {payment.slipVerification ? <SlipUpload qrToken={qrToken} mockMode={slipProviderName() === "mock"} /> : null}
    </CustomerShell>
  )
}
